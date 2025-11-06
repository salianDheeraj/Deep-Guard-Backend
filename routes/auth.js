const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');
const { maskSensitive } = require('../utils/logger');

const router = express.Router();

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

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log(`🔐 Login: ${email} | Pass: ${maskSensitive(password)}`);

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = createToken(user.id, user.email);

    console.log(`✅ Login success: ${user.email}`);

    res.json({ 
      token, 
      user: formatUserResponse(user)
    });

  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({ message: 'Login failed' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    
    console.log(`📝 Signup: ${email} | Pass: ${maskSensitive(password)}`);
    
    if (!email || !password) {
      console.log('❌ Missing fields');
      return res.status(400).json({ message: 'Email and password required' });
    }

    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (existing) {
      console.log(`❌ User exists: ${email}`);
      return res.status(400).json({ message: 'User already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const { data, error } = await supabase
      .from('users')
      .insert({ 
        name: name || email.split('@')[0], 
        email, 
        password_hash: hash 
      })
      .select()
      .single();

    if (error) {
      console.log('❌ DB error:', error.message);
      throw error;
    }

    const token = createToken(data.id, data.email);
    console.log(`✅ Signup success: ${data.email}`);
    
    res.status(201).json({ 
      token, 
      user: formatUserResponse(data) 
    });
  } catch (err) {
    console.error('❌ Signup error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    console.log(`👤 Get: ${req.user.email}`);
    res.json(req.user);
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
