const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const authMiddleware= require('./middleware/auth');
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const mlRoutes = require('./routes/ml-service');
// ✅ IMPORT SUPABASE
const { connectDB } = require('./config/supabase');

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


// ✅ CONNECT TO SUPABASE
connectDB()
  .then(() => console.log('✅ Database connected'))
  .catch(err => console.error('❌ DB connection failed:', err.message));

const app = express();

// ============ MIDDLEWARE (BEFORE routes) ============

// Logger - logs all requests
app.use(logger);

// CORS
app.use(cors({
  origin: 'http://localhost:3000', 
}));



// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ============ ROUTES ============

// Auth routes (no protect middleware)
if (authRoutes) {
  app.use('/auth', authRoutes);
} else {
  console.error('⚠️ Auth routes not loaded!');
}


app.use('/api/analysis', authMiddleware, analysisRouter);

app.use('/api/ml', mlRoutes);
// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Backend running' });
});

// ============ ERROR HANDLER (MUST be LAST) ============
app.use(errorHandler);




// ============ START SERVER ============
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});