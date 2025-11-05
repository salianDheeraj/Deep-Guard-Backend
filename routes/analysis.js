const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const userId = req.user?.id;

    console.log('📝 Upload request');
    console.log('👤 User ID:', userId);
    console.log('📁 File:', req.file?.originalname);

    if (!userId) {
      console.error('❌ No user ID');
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!req.file) {
      console.error('❌ No file');
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const analysisId = uuidv4();
    const fileName = `${userId}/${analysisId}/${req.file.originalname}`;

    console.log('📤 Uploading to Supabase storage...');

    // ✅ CHANGE: videos → video_analyses
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('video_analyses')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (uploadError) {
      console.error('❌ Storage error:', uploadError.message);
      return res.status(500).json({ message: 'Storage upload failed', error: uploadError.message });
    }

    console.log('✅ File stored:', fileName);
    console.log('💾 Inserting to database...');

    const { data: analysis, error: dbError } = await supabase
      .from('analyses')
      .insert([{
        id: analysisId,
        user_id: userId,
        filename: req.file.originalname,
        file_path: fileName,
        bucket: 'video_analyses',  // ✅ CHANGE: videos → video_analyses
        file_size: req.file.size,
        file_type: req.file.mimetype,
        status: 'pending',
      }])
      .select();

    if (dbError) {
      console.error('❌ Database error:', dbError.message);
      console.error('📊 Error details:', dbError);
      return res.status(500).json({ message: 'Database insert failed', error: dbError.message });
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
    res.status(500).json({ message: 'Upload failed', error: error.message });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;

    console.log('📋 Fetching analyses for user:', userId);

    const { data: analyses, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Fetch error:', error);
      return res.status(500).json({ message: 'Failed to fetch analyses' });
    }

    console.log('✅ Found analyses:', analyses?.length || 0);
    res.json({ data: analyses });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ message: 'Error fetching analyses' });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    console.log('🔍 Fetching analysis:', id);

    const { data: analysis, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !analysis) {
      console.error('❌ Not found:', error);
      return res.status(404).json({ message: 'Analysis not found' });
    }

    console.log('✅ Found analysis:', id);
    res.json({ data: analysis });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ message: 'Error fetching analysis' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    console.log('🗑️ Deleting analysis:', id);

    const { data: analysis } = await supabase
      .from('analyses')
      .select('file_path')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!analysis) {
      console.error('❌ Analysis not found');
      return res.status(404).json({ message: 'Analysis not found' });
    }

    if (analysis.file_path) {
      console.log('🗑️ Deleting file from storage:', analysis.file_path);
      // ✅ CHANGE: videos → video_analyses
      await supabase.storage.from('video_analyses').remove([analysis.file_path]);
    }

    const { error } = await supabase
      .from('analyses')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('❌ Delete error:', error);
      return res.status(500).json({ message: 'Delete failed' });
    }

    console.log('✅ Analysis deleted:', id);
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ message: 'Error deleting' });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const { status, confidence_score, is_deepfake, analysis_result } = req.body;

    console.log('✏️ Updating analysis:', id);

    const { data: analysis, error: updateError } = await supabase
      .from('analyses')
      .update({
        status,
        confidence_score,
        is_deepfake,
        analysis_result,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Update error:', updateError);
      return res.status(500).json({ message: 'Update failed' });
    }

    console.log('✅ Analysis updated:', id);
    res.json({ data: analysis });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ message: 'Error updating' });
  }
});

module.exports = router;
