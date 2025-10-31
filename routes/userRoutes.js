const express = require('express');
const { supabase } = require('../config/supabase');

const router = express.Router();

// GET all users
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    console.error('GET /api/users error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST create user
router.post('/', async (req, res) => {
  try {
    const { name, email, google_id, profile_picture } = req.body;
    const { data, error } = await supabase
      .from('users')
      .insert({ name, email, google_id, profile_picture })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json(data);
  } catch (err) {
    console.error('POST /api/users error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Simple search endpoint
router.get('/api/search', (req, res) => {
  const query = req.query.q;
  console.log('Search query:', query);
  return res.json({ results: [`Result for ${query}`] });
});

module.exports = router;
