const express = require('express');
const router = express.Router();

// Placeholder new chat route
router.post('/', async (req, res) => {
  const { message } = req.body;
  // For now, echo back
  return res.json({ reply: `Received: ${message || ''}` });
});

module.exports = router;
