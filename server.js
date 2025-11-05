const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const authMiddleware = require('./middleware/auth');
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const mlServices = require('./routes/ml-service');
const { connectDB,supabaseAdmin } = require('./config/supabase');

const userRoutes = require('./routes/userRoutes');
const analysisRouter = require('./routes/analysis');

// Load env vars
dotenv.config();

// Import auth routes
let authRoutes;
try {
  authRoutes = require('./routes/auth');
  console.log('✅ Auth routes loaded');
} catch (err) {
  console.error('❌ Auth routes error:', err.message);
}

// Connect to Supabase
connectDB()
  .then(() => console.log('✅ Database connected'))
  .catch(err => console.error('❌ DB connection failed:', err.message));

const app = express();

// ============ MIDDLEWARE ============
app.use(logger);
app.use(cors({
  origin: 'http://localhost:3000', 
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============ ROUTES ============

// Auth (no auth needed)
if (authRoutes) {
  app.use('/auth', authRoutes);
} else {
  console.error('⚠️ Auth routes not loaded!');
}

// Analysis upload (protected)
app.use('/api/analysis', authMiddleware, analysisRouter);

// ✅ ML routes (protected) - ONLY ONE!
app.use('/api/ml/analyze',authMiddleware, mlServices);
  // ✅ CORRECT - no middleware here


// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Backend running' });
});

// ============ ERROR HANDLER ============
app.use(errorHandler);

// ============ START SERVER ============
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
