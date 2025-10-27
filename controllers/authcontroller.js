const { OAuth2Client } = require('google-auth-library');
const { supabase } = require('../config/supabase');
const jwt = require('jsonwebtoken');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// verifying googleToken
const verifyGoogleToken= async(req,res)=>{
    // token from frontend
const { credentials }= req.body;
// google authentication function
const ticket =await client.verifyIdToken({
idToken:credentials,
audience:process.env.GOOGLE_CLIENT_ID,
});
// payload a method that extracts the data
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;
}
const data=await supabase