const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Helpers
const formatUserResponse = (user) => ({
  id: user.id,
  name: user.name || 'User',
  email: user.email,
  profilePicture: user.profile_picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`,
});

const createToken = (userId, email) => {
  return jwt.sign(
    { userId, email },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '30d' }
  );
};

// LOGIN
router.post('/login', async (req, res) => {
  try {
    console.log('🔓 LOGIN REQUEST:', req.body);
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

    const token = createToken(user.id, user.email);
    console.log('✅ LOGIN SUCCESS');
    return res.json({ token, user: formatUserResponse(user) });
  } catch (err) {
    console.error('❌ LOGIN ERROR:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

// SIGNUP
router.post('/signup', async (req, res) => {
  try {
    console.log('📝 SIGNUP REQUEST:', req.body);
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

    const token = createToken(data.id, data.email);
    console.log('✅ SIGNUP SUCCESS');
    return res.status(201).json({ token, user: formatUserResponse(data) });
  } catch (err) {
    console.error('❌ SIGNUP ERROR:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

// GET ME
router.get('/me', protect, async (req, res) => {
  try {
    console.log('👤 GET ME:', req.user.id);
    res.json(req.user);
  } catch (err) {
    console.error('❌ GET ME ERROR:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

// ✅ MUST EXPORT
module.exports = router;
