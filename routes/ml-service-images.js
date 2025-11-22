// routes/ml-service-images.js
// Handles single or multiple image uploads (up to 10). Sends images (single file or zipped images) to FastAPI
// Expects ZIP response with annotated images + confidence_report.json OR headers like x-average-confidence

const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const AdmZip = require('adm-zip');
const multer = require('multer');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 10 } });

console.log('✅ ML-SERVICE-IMAGES ROUTES LOADED');

// POST /ml-service-images/:analysisId
// Accepts:
// - single file in field 'file' OR
// - multiple files in field 'files' (max 10)
// Behavior:
// - If multiple files provided, create a ZIP and send as single 'file' field
// - If single file provided, send it directly
// - Receive ZIP (arraybuffer) from FastAPI, extract confidence_report.json OR read headers
// - Save annotated_images.zip to Supabase and update analyses table

router.post('/:analysisId', authMiddleware, upload.any(), async (req, res) => {
  let mlResponse;

  try {
    console.log(`\n🔴 ML-IMAGES ROUTE HIT: ${req.method} ${req.path}`);
    const { analysisId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      console.error('❌ userId is missing');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Fetch analysis record
    const { data: analysis, error: selectError } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .eq('user_id', userId)
      .single();

    if (selectError || !analysis) {
      console.error('❌ Analysis not found:', selectError?.message);
      return res.status(404).json({ message: 'Analysis not found' });
    }

    console.log('✅ Found analysis');

    // Update status to processing
    const { error: statusError } = await supabaseAdmin
      .from('analyses')
      .update({ status: 'processing' })
      .eq('id', analysisId);

    if (statusError) console.warn('⚠️ Status update warning:', statusError.message);

    // Prepare payload for ML service
    // Prefer files from multer: req.files
    const files = req.files || [];

    if (files.length === 0 && !req.body._skip_upload) {
      // If no files were uploaded in this request, we can try to use the file already stored in Supabase (analysis.file_path)
      // This mirrors the video flow where the ML service downloads file from storage
      if (!analysis.file_path) {
        return res.status(400).json({ message: 'No files provided and no stored file found' });
      }

      // Download stored file from Supabase
      console.log('📥 No files in request - downloading stored input from Supabase...');
      const { data: storedFile, error: downloadError } = await supabaseAdmin
        .storage
        .from(analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses')
        .download(analysis.file_path);

      if (downloadError) throw downloadError;

      const fileBuffer = Buffer.from(await storedFile.arrayBuffer());

      // Send stored file directly to ML (assume it is an image or zip per your storage flow)
      const formData = new FormData();
      formData.append('file', fileBuffer, { filename: analysis.filename || 'upload', contentType: analysis.file_type || 'application/octet-stream' });

      console.log(`\n📤 SENDING STORED FILE TO FASTAPI:`);
      console.log(`📤 URL: ${ML_API_URL}/detect/deepfake/images`);

      mlResponse = await axios.post(
        `${ML_API_URL}/detect/deepfake/images`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 600000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          responseType: 'arraybuffer'
        }
      );

    } else {
      // We have uploaded files in the request
      console.log(`📦 Received ${files.length} uploaded file(s)`);

      if (files.length > 10) {
        return res.status(400).json({ message: 'Maximum 10 files allowed' });
      }

      // If more than 1 file, create a ZIP to send
      let sendBuffer;
      let sendFilename;
      if (files.length === 1) {
        sendBuffer = files[0].buffer;
        sendFilename = files[0].originalname || 'image';
      } else {
        const zip = new AdmZip();
        files.forEach((f) => {
          // use originalname as entry name to keep extensions
          zip.addFile(f.originalname || `image_${Date.now()}`, f.buffer);
        });
        sendBuffer = zip.toBuffer();
        sendFilename = `images_${Date.now()}.zip`;
      }

      const formData = new FormData();
      formData.append('file', sendBuffer, { filename: sendFilename, contentType: 'application/zip' });

      console.log(`\n📤 SENDING TO FASTAPI:`);
      console.log(`📤 URL: ${ML_API_URL}/detect/deepfake/images`);

      mlResponse = await axios.post(
        `${ML_API_URL}/detect/deepfake/images`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: 600000,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          responseType: 'arraybuffer'
        }
      );
    }

    console.log(`\n✅ FastAPI Response received, status: ${mlResponse.status}`);

    // Try to parse ZIP response and extract confidence_report.json
    let confidenceReport = null;
    const zipBuffer = mlResponse.data;

    try {
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();

      console.log(`📦 ZIP contains ${zipEntries.length} files`);

      for (const entry of zipEntries) {
        if (entry.entryName === 'confidence_report.json') {
          try {
            const jsonContent = entry.getData().toString('utf8');
            console.log('📄 Raw JSON:', jsonContent.substring(0, 500));
            confidenceReport = JSON.parse(jsonContent);
            break;
          } catch (parseErr) {
            console.warn('⚠️ Failed to parse confidence_report.json:', parseErr.message);
          }
        }
      }

      if (!confidenceReport) {
        // Fallback to headers
        console.warn('⚠️ confidence_report.json not found - falling back to headers');
        const avg = parseFloat(mlResponse.headers['x-average-confidence']) || 0;
        const imagesAnalyzed = parseInt(mlResponse.headers['x-images-analyzed'] || files.length || 0);

        confidenceReport = {
          batch_id: mlResponse.headers['x-batch-id'] || '',
          total_images: imagesAnalyzed,
          images_analyzed: imagesAnalyzed,
          average_confidence: avg,
          preprocessing_errors: parseInt(mlResponse.headers['x-preprocessing-errors'] || 0),
          frame_wise_confidences: []
        };
      }
    } catch (zipError) {
      console.warn('⚠️ Could not extract from ZIP:', zipError.message);
      // Try to create a minimal report from headers
      const avg = parseFloat(mlResponse.headers['x-average-confidence']) || 0;
      const imagesAnalyzed = parseInt(mlResponse.headers['x-images-analyzed'] || files.length || 0);

      confidenceReport = {
        batch_id: mlResponse.headers['x-batch-id'] || '',
        total_images: imagesAnalyzed,
        images_analyzed: imagesAnalyzed,
        average_confidence: avg,
        preprocessing_errors: parseInt(mlResponse.headers['x-preprocessing-errors'] || 0),
        frame_wise_confidences: []
      };
    }

    // Determine deepfake (using same 0.5 threshold as video)
    const confidenceScore = confidenceReport.average_confidence || 0;
    const imagesAnalyzed = confidenceReport.images_analyzed || confidenceReport.total_images || 0;
    const isDeepfake = confidenceScore >= 0.5;

    console.log(`\n✅ FINAL VERDICT:`);
    console.log(`   Confidence Score: ${(confidenceScore * 100).toFixed(2)}%`);
    console.log(`   Is Deepfake: ${isDeepfake ? 'YES' : 'NO'}`);
    console.log(`   Images: ${imagesAnalyzed}`);

    // Save ZIP to Supabase storage
    const zipPath = `${userId}/${analysisId}/annotated_images.zip`;

    console.log(`\n💾 SAVING ZIP FILE TO STORAGE: ${zipPath}`);
    try {
      await supabaseAdmin
        .storage
        .from(analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses')
        .upload(zipPath, zipBuffer, {
          contentType: 'application/zip',
          upsert: true
        });

      console.log('✅ ZIP uploaded');
    } catch (zipErr) {
      console.error('⚠️ Could not save ZIP:', zipErr.message);
    }

    // Update analysis record in DB - include image-specific fields
    console.log('\n📊 UPDATING DATABASE:');
    const updatePayload = {
      status: 'completed',
      is_deepfake: isDeepfake,
      confidence_score: confidenceScore,
      frames_to_analyze: imagesAnalyzed, // reuse field but contains images count
      annotated_frames_path: zipPath, // keep backward compatibility
      annotated_images_path: zipPath, // new field for clarity (if your DB supports it)
      analysis_result: confidenceReport,
      updated_at: new Date().toISOString()
    };

    const { error: updateError } = await supabaseAdmin
      .from('analyses')
      .update(updatePayload)
      .eq('id', analysisId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('❌ Database update error:', updateError);
      throw updateError;
    }

    console.log('✅ Database updated');

    res.json({
      success: true,
      data: {
        analysis_id: analysisId,
        is_deepfake: isDeepfake,
        confidence_score: confidenceScore,
        images_analyzed: imagesAnalyzed,
        confidence_report: confidenceReport,
        annotated_images_path: zipPath,
        created_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}\n`);

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ success: false, message: 'ML service unavailable', debug: ML_API_URL });
    }

    // Try to set analysis status to failed
    try {
      await supabaseAdmin
        .from('analyses')
        .update({ status: 'failed' })
        .eq('id', req.params.analysisId);
    } catch (updateErr) {
      console.error('Failed to update failed status:', updateErr.message);
    }

    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;


// -----------------------------------------------------------------------------
// routes/analysis.js (UPDATED)
// Changes: download route now supports annotated_frames_path OR annotated_images_path
// Update route accepts annotated_images_path and images-specific metadata

const express2 = require('express');
const router2 = express2.Router();
const multer2 = require('multer');
const { v4: uuidv42 } = require('uuid');
const { supabaseAdmin: supabaseAdmin2 } = require('../config/supabase');
const authMiddleware2 = require('../middleware/auth');

const upload2 = multer2({ storage: multer2.memoryStorage() });

// DOWNLOAD route - support images or frames ZIP
router.get('/:id/download', authMiddleware2, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    console.log(`\n📥 DOWNLOAD REPORT: ${req.method} ${req.path}`);

    if (!userId) return res.status(401).json({ message: 'User not authenticated' });

    const { data: analysis, error } = await supabaseAdmin2
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !analysis) {
      console.error('❌ Analysis or ZIP not found');
      return res.status(404).json({ message: 'Report not found' });
    }

    // Support both fields for backward compatibility
    const annotatedPath = analysis.annotated_frames_path || analysis.annotated_images_path;
    if (!annotatedPath) {
      console.error('❌ No annotated ZIP path on analysis');
      return res.status(404).json({ message: 'Report not found' });
    }

    console.log('✅ Found analysis, downloading ZIP...');

    const { data: zipData, error: downloadError } = await supabaseAdmin2
      .storage
      .from(analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses')
      .download(annotatedPath);

    if (downloadError) throw downloadError;

    const zipBuffer = Buffer.from(await zipData.arrayBuffer());
    console.log(`✅ Downloaded ZIP: ${zipBuffer.length} bytes`);

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="analysis_${id}_report.zip"`);
    res.send(zipBuffer);

  } catch (error) {
    console.error('❌ Download error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// (The rest of analysis.js remains unchanged from your existing file — upload, get, delete, update, etc.)
// The important compatibility changes are above: download uses annotated_images_path OR annotated_frames_path,
// and update should accept annotated_images_path if provided.

module.exports = router;
