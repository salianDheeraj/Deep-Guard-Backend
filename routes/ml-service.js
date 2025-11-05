// routes/ml-service.js - Call FastAPI directly
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const { connectDB,supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

router.post('/:analysisId', authMiddleware, async (req, res) => {
  let mlResponse;

  try {
    console.log(`\n🔴 ML ROUTE HIT: ${req.method} ${req.path}`);
    
    const { analysisId } = req.params;
    const userId = req.user?.id;
    const { total_frames, frames_to_analyze } = req.body;

    console.log('userId:', userId);
    console.log('analysisId:', analysisId);

    if (!userId) {
      console.error('❌ userId is missing');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Get analysis record
    const { data: analysis, error: selectError } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .eq('user_id', userId)
      .single();

    if (selectError || !analysis) {
      console.error('❌ Analysis not found:', selectError);
      return res.status(404).json({ message: 'Analysis not found' });
    }

    console.log(`✅ Found analysis`);

    // Update status
    await supabaseAdmin
      .from('analyses')
      .update({ status: 'processing' })
      .eq('id', analysisId);

    console.log(`⏳ Status: processing`);

    // Download video
    console.log(`\n📥 DOWNLOADING VIDEO:`);
    const videoDataResponse = await supabaseAdmin
      .storage
      .from(analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses')
      .download(analysis.file_path);

    const videoData = videoDataResponse?.data || videoDataResponse;

    if (!videoData || !(videoData instanceof Blob)) {
      throw new Error('Invalid video data from Supabase');
    }

    const videoBuffer = Buffer.from(await videoData.arrayBuffer());
    console.log(`✅ Downloaded: ${videoBuffer.length} bytes`);

    if (!videoBuffer || videoBuffer.length === 0) {
      throw new Error('Video buffer is empty!');
    }

    // Send to FastAPI ML endpoint
    const formData = new FormData();
    formData.append('file', videoBuffer, {
      filename: analysis.filename,
      contentType: 'video/mp4'
    });

    const framesToSend = frames_to_analyze || 50;

    console.log(`\n📤 SENDING TO FASTAPI:`);
    console.log(`📤 URL: ${ML_API_URL}/detect/deepfake/video?frames=${framesToSend}`);

    mlResponse = await axios.post(
      `${ML_API_URL}/detect/deepfake/video?frames=${framesToSend}`,
      formData,
      {
        headers: formData.getHeaders(),
        timeout: 600000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        responseType: 'arraybuffer'
      }
    );

    console.log(`\n✅ FastAPI Response received, status: ${mlResponse.status}`);

    // Extract ML metadata from headers
    const confidenceScore = parseFloat(mlResponse.headers['x-average-confidence'] || mlResponse.headers['x-average-score'] || 0);
    const framesAnalyzed = parseInt(mlResponse.headers['x-frames-analyzed'] || frames_to_analyze || 0);
    const videoId = mlResponse.headers['x-video-id'] || '';
    const isDeepfake = confidenceScore >= 0.5;

    // Extract frame-wise confidences
    let frameWiseConfidences = [];
    if (mlResponse.headers['x-frame-confidences']) {
      try {
        frameWiseConfidences = JSON.parse(mlResponse.headers['x-frame-confidences']);
        console.log(`✅ Frame-wise confidences: ${frameWiseConfidences.length} frames`);
      } catch (e) {
        console.warn('Could not parse frame confidences');
      }
    }

    console.log(`✅ Extracted ML data:`, { is_deepfake: isDeepfake, confidence_score: confidenceScore });

    // ✅ CREATE JSON REPORT
    console.log(`\n📋 CREATING REPORT:`);
    const report = {
      analysis_id: analysisId,
      filename: analysis.filename,
      total_frames: analysis.total_frames || total_frames || 0,
      frames_analyzed: framesAnalyzed,
      video_id: videoId,
      is_deepfake: isDeepfake,
      average_confidence: confidenceScore,
      confidence_score: confidenceScore,
      confidence_percentage: (confidenceScore * 100).toFixed(2),
      frame_wise_confidences: frameWiseConfidences,
      created_at: new Date().toISOString(),
      status: 'completed'
    };

    // ✅ Save ZIP as is (NOT modifying it)
    const zipBuffer = mlResponse.data;
    const zipPath = `${userId}/${analysisId}/annotated_frames.zip`;

    console.log(`\n💾 SAVING ZIP FILE:`);
    try {
      await supabaseAdmin
        .storage
        .from(analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses')
        .upload(zipPath, zipBuffer, {
          contentType: 'application/zip',
          upsert: true
        });
      
      console.log(`✅ ZIP uploaded: ${zipPath} (${zipBuffer.length} bytes)`);
    } catch (zipError) {
      console.error(`⚠️ Warning: Could not save ZIP:`, zipError.message);
    }

    // ✅ Save to database
    const { error: updateError } = await supabaseAdmin
      .from('analyses')
      .update({
        status: 'completed',
        is_deepfake: isDeepfake,
        confidence_score: confidenceScore,
        frames_to_analyze: framesAnalyzed,
        annotated_frames_path: zipPath,
        analysis_result: report
      })
      .eq('id', analysisId)
      .eq('user_id', userId);

    if (updateError) throw updateError;

    console.log(`✅ Analysis COMPLETE\n`);

    res.json({ 
      success: true, 
      data: {
        analysis_id: analysisId,
        is_deepfake: isDeepfake,
        average_confidence: confidenceScore,
        confidence_score: confidenceScore,
        confidence_percentage: (confidenceScore * 100).toFixed(2),
        frames_analyzed: framesAnalyzed,
        total_frames: analysis.total_frames || total_frames || 0,
        frame_wise_confidences: frameWiseConfidences,
        filename: analysis.filename,
        annotated_frames_path: zipPath,
        created_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}\n`);

    if (error.response) {
      console.error(`❌ FastAPI Error Status: ${error.response.status}`);
    }

    await supabaseAdmin
      .from('analyses')
      .update({ status: 'failed', error_message: error.message })
      .eq('id', req.params.analysisId)
      .catch(err => console.error('Failed to update status:', err));

    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
