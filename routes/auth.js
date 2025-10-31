const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { verifyGoogleToken, getCurrentUser } = require('../controllers/authcontroller');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Helper to format user response
const formatUserResponse = (user) => ({
  id: user.id,
  name: user.name || 'User',
  email: user.email,
  profilePicture: user.profile_picture || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`,
});

// Helper to create JWT token
const createToken = (userId, email) => {
  return jwt.sign(
    { userId, email },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '30d' }
  );
};

// Google verify
router.post('/google/verify', verifyGoogleToken);

// Get current user
router.get('/me', protect, getCurrentUser);

// Signup with email/password
router.post('/signup', async (req, res) => {
  try {
    console.log('📝 Signup:', req.body);
    const { name, email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    // Check existing user
    const { data: existing, error: selErr } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    if (selErr == null && existing) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    // Insert user
    const { data, error } = await supabase
      .from('users')
      .insert({ name, email, password_hash: hash })
      .select()
      .single();

    if (error) throw error;

    // Create token
    const token = createToken(data.id, data.email);

    console.log('✅ Signup success');
    return res.status(201).json({ token, user: formatUserResponse(data) });
  } catch (err) {
    console.error('❌ Signup error:', err.message);
    return res.status(500).json({ message: err.message || 'Signup failed' });
  }
});

// Login with email/password
router.post('/login', async (req, res) => {
  try {
    console.log('🔓 Login:', req.body);
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    // Find user
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ message: 'No local password for user' });
    }

    // Compare password
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Create token
    const token = createToken(user.id, user.email);

    console.log('✅ Login success');
    return res.json({ token, user: formatUserResponse(user) });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    return res.status(500).json({ message: err.message || 'Login failed' });
  }
});
// In your routes/auth.js file

router.post('/manual-login', async (req, res) => {
  try {
    console.log('🔓 Manual Login:', req.body);
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    // Find user in database
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
      console.log('❌ No password hash for user');
      return res.status(401).json({ message: 'No local password for user' });
    }

    // Compare password with stored hash
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      console.log('❌ Password mismatch');
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Create JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '30d' }
    );

    console.log('✅ Manual Login success');
    return res.json({ token, user: formatUserResponse(user) });
  } catch (err) {
    console.error('❌ Manual Login error:', err.message);
    return res.status(500).json({ message: err.message || 'Login failed' });
  }
});

module.exports = router;
