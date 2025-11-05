const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');

const authMiddleware = async (req, res, next) => {
  let token;

  // ✅ CHECK AUTHORIZATION HEADER
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // ✅ EXTRACT TOKEN
      token = req.headers.authorization.split(' ')[1];
      console.log('🔑 Token found, verifying...');

      // ✅ VERIFY JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      console.log('✅ Token verified, userId:', decoded.userId || decoded.id);

      // ✅ QUERY SUPABASE FOR USER
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', decoded.userId || decoded.id)  // Support both userId and id
        .single();

      if (error) {
        console.error('❌ Supabase error:', error.message);
        return res.status(401).json({ message: 'User query failed' });
      }

      if (!user) {
        console.error('❌ User not found in database');
        return res.status(401).json({ message: 'User not found' });
      }

      // ✅ ATTACH USER TO REQUEST
      req.user = user;
      console.log('✅ Auth successful, user:', user.email);
      next();

    } catch (error) {
      console.error('❌ Auth error:', error.message);
      return res.status(401).json({ 
        message: 'Not authorized, token failed',
        error: error.message 
      });
    }
  } else {
    console.error('❌ No Bearer token in headers');
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

module.exports = authMiddleware;
