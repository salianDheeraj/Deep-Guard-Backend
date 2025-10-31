const { OAuth2Client } = require('google-auth-library');
const { supabase } = require('../config/supabase');
const jwt = require('jsonwebtoken');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// verifying googleToken
const verifyGoogleToken = async (req, res) => {
  try {
    // token from frontend
    const { credentials } = req.body;

    // google authentication function
    const ticket = await client.verifyIdToken({
      idToken: credentials,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    // payload extracts the data
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 or similar may represent not found; but surface other errors
      throw selectError;
    }

    let user;

    if (!existingUser) {
      const { data, error } = await supabase
        .from('users')
        .insert({
          google_id: googleId,
          email,
          name,
          profile_picture: picture,
        })
        .select()
        .single();

      if (error) throw error;
      user = data;
    } else {
      const { data, error } = await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('google_id', googleId)
        .select()
        .single();

      if (error) throw error;
      user = data;
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', {
      expiresIn: '30d',
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profilePicture: user.profile_picture,
      },
    });
  } catch (error) {
    console.error('verifyGoogleToken error:', error);
    return res.status(401).json({ message: 'Invalid Google token' });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error('getCurrentUser error:', error);
    return res.status(404).json({ message: 'User not found' });
  }
};

module.exports = { verifyGoogleToken, getCurrentUser };
