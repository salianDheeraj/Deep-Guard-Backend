const express = require('express');
const router = express.Router();
const axios = require('axios');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

// ✅ ML endpoint URL
const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

// ✅ Backend endpoint that frontend calls
router.post('/analyze/:analysisId', authMiddleware, async (req, res) => {
  try {
    const { analysisId } = req.params;
    const userId = req.user?.id;

    console.log(`🔍 Analysis triggered: ${analysisId}`);

    // Get file info from DB
    const { data: analysis } = await supabaseAdmin
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .eq('user_id', userId)
      .single();

    if (!analysis) {
      return res.status(404).json({ message: 'Not found' });
    }

    // Update status
    await supabaseAdmin
      .from('analyses')
      .update({ status: 'processing' })
      .eq('id', analysisId);

    console.log(`📤 Calling ML endpoint: ${ML_API_URL}/analyze`);

    // ✅ CALL ML ENDPOINT
    const mlResponse = await axios.post(
      `${ML_API_URL}/analyze`,  // ML endpoint
      {
        file_path: analysis.file_path,
        bucket: analysis.bucket,
        analysis_id: analysisId,
      },
      { timeout: 600000 }
    );

    console.log(`✅ ML response:`, mlResponse.data);

    // Save results
    await supabaseAdmin
      .from('analyses')
      .update({
        status: 'completed',
        is_deepfake: mlResponse.data.is_deepfake,
        confidence_score: mlResponse.data.confidence_score,
        frames_analyzed: mlResponse.data.frames_analyzed,
      })
      .eq('id', analysisId);

    res.json({ success: true, data: mlResponse.data });

  } catch (error) {
    console.error('❌ Error:', error.message);

    await supabaseAdmin
      .from('analyses')
      .update({ status: 'failed', error: error.message })
      .eq('id', req.params.analysisId);

    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
