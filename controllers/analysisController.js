const { OAuth2Client } = require('google-auth-library');
const { supabase } = require('../config/supabase');
const jwt = require('jsonwebtoken');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ===== UPLOAD FILE =====
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: 'No file provided' 
      });
    }

    const userId = req.user.id;
    const fileName = req.file.originalname;
    const fileSize = req.file.size;

    console.log(`[Upload] 📥 File received`);
    console.log(`[Upload] User: ${userId}`);
    console.log(`[Upload] File: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

    // Save metadata to database
    const { data, error } = await supabase
      .from('analyses')
      .insert({
        user_id: userId,
        filename: fileName,
        file_size: fileSize,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`[Upload] ✅ Analysis saved: ${data.id}`);

    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      analysis: {
        id: data.id,
        filename: fileName,
        file_size: fileSize,
        status: 'pending',
      },
    });

  } catch (error) {
    console.error(`[Upload] ❌ Error:`, error.message);
    return res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
};

// ===== GET ALL ANALYSES =====
const getAnalyses = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, analyses: data || [] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ===== GET SINGLE ANALYSIS =====
const getAnalysisById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Analysis not found' });
    }

    return res.json({ success: true, analysis: data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ===== DELETE ANALYSIS =====
const deleteAnalysis = async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('analyses')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    return res.json({ success: true, message: 'Analysis deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ===== VERIFY GOOGLE TOKEN =====
const verifyGoogleToken = async (req, res) => {
  try {
    // token from frontend
    const { credentials } = req.body;

    // google authentication function
    const ticket = await client.verifyIdToken({
      idToken: credentials,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    // payload extracts the data
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      throw selectError;
    }

    let user;

    if (!existingUser) {
      const { data, error } = await supabase
        .from('users')
        .insert({
          google_id: googleId,
          email,
          name,
          profile_picture: picture,
        })
        .select()
        .single();

      if (error) throw error;
      user = data;
    } else {
      const { data, error } = await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('google_id', googleId)
        .select()
        .single();

      if (error) throw error;
      user = data;
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '30d',
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profilePicture: user.profile_picture,
      },
    });
  } catch (error) {
    console.error('verifyGoogleToken error:', error);
    return res.status(401).json({ message: 'Invalid Google token' });
  }
};

// ===== GET CURRENT USER =====
const getCurrentUser = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error('getCurrentUser error:', error);
    return res.status(404).json({ message: 'User not found' });
  }
};

// ✅ EXPORT ALL
module.exports = { uploadFile, getAnalyses, getAnalysisById, deleteAnalysis, verifyGoogleToken, getCurrentUser };
