const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const authenticateToken = require('../middleware/authenticateToken');

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SERVICE_ROLE_KEY);

// GET /api/account - fetch current user profile
router.get('/api/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, profile_pic')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Supabase fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch user profile' });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/account - update current user profile
router.put('/api/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, profile_pic } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({ name, email, profile_pic })
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Supabase update error:', error);
      return res.status(500).json({ error: 'Failed to update user profile' });
    }

    res.status(200).json({ message: 'Profile updated successfully', user: data });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/account/change-password - change user password
router.post('/api/account/change-password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { current_password, new_password } = req.body;

    // Verify current password
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return res.status(500).json({ error: 'Failed to verify user' });
    }

    // TODO: Validate current_password (bcrypt etc.)

    // Update password (hash new_password before store)
    const hashedPassword = new_password; // Replace with real hashing

    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: hashedPassword })
      .eq('id', userId);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update password' });
    }

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/account/delete-analyses - delete all user analyses
router.delete('/api/account/delete-analyses', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { error } = await supabase
      .from('analyses')
      .delete()
      .eq('user_id', userId);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete analyses' });
    }

    res.status(200).json({ message: 'All analyses deleted successfully' });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/account/delete-account - delete user account and data
router.delete('/api/account/delete-account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    await supabase.from('analyses').delete().eq('user_id', userId);

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete account' });
    }

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
