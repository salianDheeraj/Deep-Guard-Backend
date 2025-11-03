const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const { protect } = require('./middleware/auth');

// Load env vars
dotenv.config();

// Import routes with error handling
let authRoutes;
try {
  authRoutes = require('./routes/auth');
  console.log('✅ Auth routes loaded');
} catch (err) {
  console.error('❌ Auth routes error:', err.message);
}

const userRoutes = require('./routes/userRoutes');
const analysisRouter = require('./routes/analysis');
const newchats = require('./routes/newchat');

// Import DB connection
const { connectDB } = require('./config/supabase');

// Try connecting
connectDB().catch(err => console.log('DB connection warning:', err));

const app = express();

// Middleware (BEFORE routes)
app.use(cors({
  origin: 'http://localhost:3000', 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
if (authRoutes) {
  app.use('/auth', authRoutes); // No protect middleware here
} else {
  console.error('⚠️ Auth routes not loaded!');
}

// Protected routes
app.use('/api/users', protect, userRoutes);
app.use('/api/analysis', protect, analysisRouter);
app.use('/api/newchat', protect, newchats);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Backend running' });
});

// Error handler (MUST be last)
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
