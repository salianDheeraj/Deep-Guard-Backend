const express = require('express');

const router = express.Router();
const Chat = require('../models/userRoutes');
// GET all users
router.get('/', async (req, res) => {
  const users = await user.find();
  res.json(users);
});

// POST create user
router.post('/', async (req, res) => {

  const { name, email } = req.body;
  const user = new User({ name, email });
  await user.save();
  res.status(201).json(user);
});
router.get('/api/search', (req, res) => {
    const query = req.query.q;
    console.log("Search query:", query);
    res.json({ results: [`Result for ${query}`] });
});

module.exports = router;
