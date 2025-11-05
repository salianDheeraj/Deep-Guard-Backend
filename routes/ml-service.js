// routes/ml-service.js - Call FastAPI directly
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const AdmZip = require('adm-zip');
const { supabaseAdmin } = require('../config/supabase');
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

    // Update status to processing
    const { error: statusError1 } = await supabaseAdmin
      .from('analyses')
      .update({ status: 'processing' })
      .eq('id', analysisId);

    if (statusError1) console.warn('⚠️ Status update warning:', statusError1.message);
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

    // Extract frame-wise confidences from ZIP
    let frameWiseConfidences = [];
    try {
      const zipBuffer = mlResponse.data;
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();

      console.log(`📦 ZIP contains ${zipEntries.length} files`);

      zipEntries.forEach(entry => {
        if (entry.entryName.endsWith('.json')) {
          const jsonContent = entry.getData().toString('utf8');
          const analysisData = JSON.parse(jsonContent);
          frameWiseConfidences = analysisData.frame_wise_confidences || [];
          console.log(`✅ Extracted ${frameWiseConfidences.length} frame confidences from ZIP`);
        }
      });
    } catch (zipError) {
      console.warn('⚠️ Could not extract ZIP JSON:', zipError.message);
      frameWiseConfidences = [];
    }

    console.log(`✅ Extracted ML data:`, { is_deepfake: isDeepfake, confidence_score: confidenceScore });

    // Create JSON report
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

    // Save ZIP file
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

    // ✅ FIXED: Save to database WITHOUT .catch()
    console.log(`\n📊 SAVING TO DATABASE:`);
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

    if (updateError) {
      console.error('❌ Database update error:', updateError);
      throw updateError;
    }

    console.log(`✅ Database updated\n`);
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
        zip_file_size: zipBuffer.length,
        filename: analysis.filename,
        annotated_frames_path: zipPath,
        created_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}\n`);
    console.error(`❌ Full error:`, error);

    if (error.response) {
      console.error(`❌ FastAPI Error Status: ${error.response.status}`);
      console.error(`❌ FastAPI Error Data:`, error.response.data);
    }

    if (error.code === 'ECONNREFUSED') {
      console.error('❌ ECONNREFUSED: FastAPI not running at:', ML_API_URL);
      return res.status(503).json({ 
        success: false, 
        message: 'ML service unavailable',
        debug: ML_API_URL
      });
    }

    // ✅ FIXED: Update failed status WITHOUT .catch()
    try {
      await supabaseAdmin
        .from('analyses')
        .update({ 
          status: 'failed', 
          error_message: error.message 
        })
        .eq('id', req.params.analysisId);
    } catch (updateErr) {
      console.error('Failed to update failed status:', updateErr.message);
    }

    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
