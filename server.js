const express = require('express');
const dotenv = require('dotenv');
const { connectDB } = require('./config/supabase');
const userRoutes = require('./routes/userRoutes');
const cors = require('cors');
const analysisRouter = require('./routes/analysis');
const authRoutes = require('./routes/auth');
const newchats = require('./routes/newchat');



// Load env vars
dotenv.config();

// DB Connection
connectDB();

const app = express();
app.use(cors({
  origin: 'http://localhost:3000', 
}));
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analysis', analysisRouter); 
app.use('/api/newchat', newchats)
// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
