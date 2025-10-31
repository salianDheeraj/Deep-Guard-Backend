const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { verifyGoogleToken, getCurrentUser } = require('../controllers/authcontroller');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Google verify (existing)
router.post('auth/google/verify', verifyGoogleToken);

// Get current user
router.get('/me', protect, getCurrentUser);

// Signup with email/password
router.post('/signup', async (req, res) => {
	try {
		const { name, email, password } = req.body;
		if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

		// check existing
		const { data: existing, error: selErr } = await supabase.from('users').select('*').eq('email', email).single();
		if (selErr == null && existing) {
			return res.status(400).json({ message: 'User already exists' });
		}

		const salt = await bcrypt.genSalt(10);
		const hash = await bcrypt.hash(password, salt);

		const { data, error } = await supabase
			.from('users')
			.insert({ name, email, password_hash: hash })
			.select()
			.single();

		if (error) throw error;

		const token = jwt.sign({ id: data.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
		return res.status(201).json({ token, user: data });
	} catch (err) {
		console.error('POST /auth/signup error:', err);
		return res.status(500).json({ message: err.message || 'Signup failed' });
	}
});

// Login with email/password
router.post('/login', async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

		const { data: user, error } = await supabase.from('users').select('*').eq('email', email).single();
		if (error || !user) return res.status(401).json({ message: 'Invalid credentials' });

		if (!user.password_hash) return res.status(401).json({ message: 'No local password for user' });

		const match = await bcrypt.compare(password, user.password_hash);
		if (!match) return res.status(401).json({ message: 'Invalid credentials' });

		const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
		return res.json({ token, user });
	} catch (err) {
		console.error('POST /auth/login error:', err);
		return res.status(500).json({ message: err.message || 'Login failed' });
	}
});

module.exports = router;
