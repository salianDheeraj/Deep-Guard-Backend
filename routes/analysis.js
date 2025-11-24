// routes/analysis.js - COMPLETE with download
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// ✅ DOWNLOAD route - MOST SPECIFIC - FIRST
router.get('/:id/download', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    console.log(`\n📥 DOWNLOAD REPORT: ${req.method} ${req.path}`);
    console.log('analysisId:', id);
    console.log('userId:', userId);

    if (!userId) {
      console.error('❌ userId is missing');
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Get analysis record
    const { data: analysis, error } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !analysis || !analysis.annotated_frames_path) {
      console.error('❌ Analysis or ZIP not found');
      return res.status(404).json({ message: 'Report not found' });
    }

    console.log(`✅ Found analysis, downloading ZIP...`);

    // Download the ZIP file from Supabase
    const { data: zipData, error: downloadError } = await supabaseAdmin
      .storage
      .from(analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses')
      .download(analysis.annotated_frames_path);

    if (downloadError) {
      throw downloadError;
    }

    const zipBuffer = Buffer.from(await zipData.arrayBuffer());
    console.log(`✅ Downloaded ZIP: ${zipBuffer.length} bytes`);

    // Return ZIP to frontend
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="analysis_${id}_report.zip"`);
    res.send(zipBuffer);

  } catch (error) {
    console.error('❌ Download error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ✅ UPLOAD route
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const userId = req.user?.id;

    console.log('📝 Upload request');
    console.log('👤 User ID:', userId);
    console.log('📁 File:', req.file?.originalname);

    if (!userId) {
      console.error('❌ No user ID');
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!req.file) {
      console.error('❌ No file');
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const analysisId = uuidv4();
    const fileName = `${userId}/${analysisId}/${req.file.originalname}`;

    console.log('📤 Uploading to Supabase storage...');

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('video_analyses')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error('❌ Storage error:', uploadError.message);
      return res.status(500).json({ success: false, message: 'Storage upload failed', error: uploadError.message });
    }

    console.log('✅ File stored:', fileName);
    console.log('💾 Inserting to database...');

    const { data: analysis, error: dbError } = await supabaseAdmin
      .from('analyses')
      .insert([{
        id: analysisId,
        user_id: userId,
        filename: req.file.originalname,
        file_path: fileName,
        bucket: 'video_analyses',
        file_size: req.file.size,
        file_type: req.file.mimetype,
        status: 'pending'
      }])
      .select()
      .single();

    if (dbError) {
      console.error('❌ Database error:', dbError.message);
      try {
        await supabaseAdmin.storage.from('video_analyses').remove([fileName]);
        console.log('🧹 Cleaned up uploaded file');
      } catch (cleanupErr) {
        console.warn('⚠️ Cleanup failed:', cleanupErr.message);
      }
      return res.status(500).json({ success: false, message: 'Database insert failed', error: dbError.message });
    }

    console.log('✅ Analysis record created:', analysisId);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        analysis_id: analysisId,
        filename: req.file.originalname,
        file_path: fileName,
      }
    });

  } catch (error) {
    console.error('❌ Upload error:', error.message);
    res.status(500).json({ success: false, message: 'Upload failed', error: error.message });
  }
});

// ✅ GET all analyses
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    console.log('📋 Fetching analyses for user:', userId);

    const { data: analyses, error } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('❌ Fetch error:', error);
      return res.status(500).json({ success: false, message: 'Failed to fetch analyses' });
    }

    console.log('✅ Found analyses:', analyses?.length || 0);
    res.json({ success: true, data: analyses, count: analyses?.length || 0 });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching analyses' });
  }
});

// ✅ GET single analysis - LAST
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    console.log('🔍 Fetching analysis:', id);

    const { data: analysis, error } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !analysis) {
      console.error('❌ Not found:', error?.message);
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }

    console.log('✅ Found analysis:', id);
    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching analysis' });
  }
});

// ✅ DELETE analysis
router.delete('/:id', authMiddleware, async (req, res) => {
  let analysisId;
  let userId;

  try {
    analysisId = req.params.id;
    userId = req.user?.id;

    console.log(`\n🗑️ DELETE REQUEST: ${req.method} ${req.path}`);
    console.log('analysisId:', analysisId);
    console.log('userId:', userId);

    if (!userId) {
      console.error('❌ userId is missing');
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    if (!analysisId) {
      console.error('❌ analysisId is missing');
      return res.status(400).json({ success: false, message: 'Analysis ID is required' });
    }

    console.log(`\n📊 FETCHING ANALYSIS RECORD:`);
    const { data: analysis, error: selectError } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .eq('user_id', userId)
      .single();

    if (selectError || !analysis) {
      console.error('❌ Analysis not found:', selectError?.message);
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }

    console.log(`✅ Found analysis:`, {
      id: analysis.id,
      filename: analysis.filename,
      file_path: analysis.file_path,
      annotated_frames_path: analysis.annotated_frames_path
    });

    const bucketName = analysis.bucket || process.env.SUPABASE_BUCKET_NAME || 'video_analyses';
    const filesToDelete = [];

    if (analysis.file_path) {
      filesToDelete.push(analysis.file_path);
      console.log(`\n📝 Will delete video: ${analysis.file_path}`);
    }

    if (analysis.annotated_frames_path) {
      filesToDelete.push(analysis.annotated_frames_path);
      console.log(`📝 Will delete ZIP: ${analysis.annotated_frames_path}`);
    }

    if (filesToDelete.length > 0) {
      console.log(`\n🗑️ DELETING FILES FROM STORAGE:`);
      try {
        const { error: deleteError } = await supabaseAdmin
          .storage
          .from(bucketName)
          .remove(filesToDelete);

        if (deleteError) {
          console.warn(`⚠️ Warning deleting files:`, deleteError.message);
        } else {
          console.log(`✅ Successfully deleted ${filesToDelete.length} file(s) from storage`);
        }
      } catch (storageErr) {
        console.warn(`⚠️ Storage deletion error:`, storageErr.message);
      }
    }

    console.log(`\n📊 DELETING DATABASE RECORD:`);
    const { error: deleteDbError } = await supabaseAdmin
      .from('analyses')
      .delete()
      .eq('id', analysisId)
      .eq('user_id', userId);

    if (deleteDbError) {
      console.error('❌ Database delete error:', deleteDbError);
      throw deleteDbError;
    }

    console.log(`✅ Database record deleted\n`);

    res.json({ 
      success: true, 
      message: 'Analysis and all associated files deleted successfully',
      data: { 
        analysisId,
        filesDeleted: filesToDelete.length,
        deletedFiles: filesToDelete
      }
    });

  } catch (error) {
    console.error(`\n❌ DELETE ERROR: ${error.message}\n`);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to delete analysis'
    });
  }
});

// ✅ UPDATE analysis
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const { 
      status, 
      confidence_score, 
      is_deepfake, 
      analysis_result,
      frames_to_analyze,
      annotated_frames_path
    } = req.body;

    console.log('✏️ Updating analysis:', id);

    const updatePayload = { updated_at: new Date().toISOString() };

    if (status !== undefined) updatePayload.status = status;
    if (confidence_score !== undefined) updatePayload.confidence_score = confidence_score;
    if (is_deepfake !== undefined) updatePayload.is_deepfake = is_deepfake;
    if (analysis_result !== undefined) updatePayload.analysis_result = analysis_result;
    if (frames_to_analyze !== undefined) updatePayload.frames_to_analyze = frames_to_analyze;
    if (annotated_frames_path !== undefined) updatePayload.annotated_frames_path = annotated_frames_path;

    const { data: analysis, error: updateError } = await supabaseAdmin
      .from('analyses')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Update error:', updateError);
      return res.status(500).json({ success: false, message: 'Update failed' });
    }

    console.log('✅ Analysis updated:', id);
    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ success: false, message: 'Error updating analysis' });
  }
});

module.exports = router;
