const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { supabase } = require('../config/supabase');

const router = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ===== HELPERS =====
const formatUserResponse = (user) => ({
  id: user.id,
  name: user.name || 'User',
  email: user.email,
  profilePicture: user.profile_picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`,
});

const createToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '30d' }
  );
};

// ===== LOGIN (LOCAL) =====
router.post('/login', async (req, res) => {
  try {
    console.log('🔓 LOCAL LOGIN REQUEST');
    const { email, password } = req.body || {};
    
    if (!email || !password) {
      console.log('❌ Missing email or password');
      return res.status(400).json({ message: 'Email and password required' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      console.log('❌ User not found');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ message: 'No local password for user' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      console.log('❌ Password mismatch');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = createToken(user.id);
    console.log('✅ LOCAL LOGIN SUCCESS');
    return res.json({ token, user: formatUserResponse(user) });
  } catch (err) {
    console.error('❌ LOGIN ERROR:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

// ===== SIGNUP (LOCAL) =====
router.post('/signup', async (req, res) => {
  try {
    console.log('📝 SIGNUP REQUEST');
    const { email, password, name } = req.body || {};
    
    if (!email || !password) {
      console.log('❌ Missing email or password');
      return res.status(400).json({ message: 'Email and password required' });
    }

    const { data: existing, error: checkError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (checkError === null && existing) {
      console.log('❌ User already exists');
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const { data, error } = await supabase
      .from('users')
      .insert({ name: name || email.split('@')[0], email, password_hash: hash })
      .select()
      .single();

    if (error) {
      console.log('❌ Supabase error:', error.message);
      throw error;
    }

    const token = createToken(data.id);
    console.log('✅ SIGNUP SUCCESS');
    return res.status(201).json({ token, user: formatUserResponse(data) });
  } catch (err) {
    console.error('❌ SIGNUP ERROR:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

// ===== GOOGLE AUTH =====
router.post('/google', async (req, res) => {
  try {
    console.log('🔐 GOOGLE AUTH REQUEST');
    const { credentials } = req.body;

    if (!credentials) {
      return res.status(400).json({ message: 'Google token required' });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: credentials,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Check if user exists
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
      // Create new user with Google ID
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
      console.log('✅ NEW USER CREATED VIA GOOGLE');
    } else {
      // Update last login
      const { data, error } = await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('google_id', googleId)
        .select()
        .single();

      if (error) throw error;
      user = data;
      console.log('✅ EXISTING USER LOGGED IN VIA GOOGLE');
    }

    // Create JWT token with userId (same format as local auth)
    const token = createToken(user.id);

    return res.json({ 
      token, 
      user: formatUserResponse(user) 
    });
  } catch (error) {
    console.error('❌ GOOGLE AUTH ERROR:', error.message);
    return res.status(401).json({ message: 'Invalid Google token' });
  }
});

// ===== GET ME =====
router.get('/me', require('../middleware/auth').protect, async (req, res) => {
  try {
    console.log('👤 GET ME:', req.user.id);
    res.json(formatUserResponse(req.user));
  } catch (err) {
    console.error('❌ GET ME ERROR:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
