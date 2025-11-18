const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { supabase } = require("../config/supabase");
const nodemailer = require("nodemailer");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const createAccessToken = (userId, email) =>
  jwt.sign({ userId, email }, process.env.JWT_SECRET, { expiresIn: "15m" });

const createRefreshToken = (userId, email) =>
  jwt.sign({ userId, email }, process.env.JWT_REFRESH_SECRET, { expiresIn: "7d" });

const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
};

const formatUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  profilePicture:
    user.profile_picture ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`,
});

exports.signup = async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existing)
      return res.status(400).json({ message: "User already exists" });

    const hash = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        email,
        name: name || email.split("@")[0],
        password_hash: hash,
      })
      .select()
      .single();

    if (error) throw error;

    const access = createAccessToken(user.id, user.email);
    const refresh = createRefreshToken(user.id, user.email);
    setAuthCookies(res, access, refresh);

    res.status(201).json({ user: formatUser(user) });
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (!user || !user.password_hash)
      return res.status(401).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ message: "Invalid credentials" });

    const access = createAccessToken(user.id, user.email);
    const refresh = createRefreshToken(user.id, user.email);
    setAuthCookies(res, access, refresh);

    res.json({ user: formatUser(user) });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.googleLogin = async (req, res) => {
  try {
    const { credentials } = req.body;
    if (!credentials)
      return res.status(400).json({ message: "Google token required" });

    const ticket = await googleClient.verifyIdToken({
      idToken: credentials,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    const { data: existing } = await supabase
      .from("users")
      .select("*")
      .eq("google_id", googleId)
      .single();

    let user = existing;

    if (!existing) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({
          google_id: googleId,
          email,
          name,
          profile_picture: picture,
        })
        .select()
        .single();

      if (error) throw error;

      user = newUser;
    }

    const access = createAccessToken(user.id, user.email);
    const refresh = createRefreshToken(user.id, user.email);
    setAuthCookies(res, access, refresh);

    res.json({ user: formatUser(user) });
  } catch (err) {
    console.error("Google Auth Error:", err);
    res.status(401).json({ message: "Invalid Google token" });
  }
};

exports.refresh = (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken)
      return res.status(401).json({ message: "Missing refresh token" });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const newAccess = createAccessToken(decoded.userId, decoded.email);

    res.cookie("accessToken", newAccess, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });

    res.json({ message: "Access token refreshed" });
  } catch (err) {
    console.error("Refresh Error:", err);
    res.status(401).json({ message: "Invalid refresh token" });
  }
};

exports.getMe = async (req, res) => {
  try {
    res.json(formatUser(req.user));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
exports.sendResetOtp = async (req, res) => {
  try {
    let email;

    if (!req.body || Object.keys(req.body).length === 0) {
      if (req.rawBody) {
        try {
          const parsedRaw = JSON.parse(req.rawBody);
          email = parsedRaw.email;
        } catch (err) {
          return res.status(400).json({ message: "Invalid JSON format received." });
        }
      }
    } else {
      email = req.body.email;
    }

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, name, password_hash, reset_otp_sent_at")
      .eq("email", email)
      .single();

    // Avoid email enumeration
    if (userError || !user) {
      return res.json({ success: true, message: "If the account exists, a reset code has been sent." });
    }

    if (!user.password_hash) {
      return res.json({ success: true, message: "If the account exists, a reset code has been sent." });
    }

    // ============================
    //  RESEND COOLDOWN — 60 sec
    // ============================
    const now = Date.now();
    if (user.reset_otp_sent_at) {
      const lastSent = new Date(user.reset_otp_sent_at).getTime();
      if (now - lastSent < 60 * 1000) {
        const wait = Math.ceil((60 * 1000 - (now - lastSent)) / 1000);
        return res.status(429).json({
          message: `Please wait ${wait}s before requesting another OTP.`,
        });
      }
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash OTP BEFORE saving
    const hashedOtp = await bcrypt.hash(otp, 10);

    // 2-minute expiry
    const otpExpiry = new Date(now + 2 * 60 * 1000);

    // Update DB
    const { error: updateError } = await supabase
      .from("users")
      .update({
        reset_otp: hashedOtp,
        reset_otp_expiry: otpExpiry.toISOString(),
        reset_otp_sent_at: new Date().toISOString()
      })
      .eq("id", user.id);

    if (updateError) throw updateError;

    // Send Email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      socketTimeout: 10000,
    });

    const mailOptions = {
      from: `"Deep Guard" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset OTP",
      html: `
        <h2>Password Reset Request</h2>
        <p>Hi ${user.name || "User"},</p>
        <p>Your OTP to reset your password is:</p>
        <h1 style="color: #4F46E5; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
        <p>This OTP will expire in 2 minutes.</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: "OTP sent to your email" });
  } catch (err) {
    console.error("Send Reset OTP Error:", err);
    res.status(500).json({ message: err.message });
  }
};
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        message: "Email, OTP, and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, password_hash, reset_otp, reset_otp_expiry")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.password_hash) {
      return res.status(400).json({
        message: "This account uses Google login. Password reset via OTP is not available.",
      });
    }

    // Compare entered OTP with hashed OTP
    const validOtp = await bcrypt.compare(otp, user.reset_otp);
    if (!validOtp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Check expiry
    if (new Date(user.reset_otp_expiry) < new Date()) {
      return res.status(400).json({ message: "OTP has expired" });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: hashedPassword,
        reset_otp: null,
        reset_otp_expiry: null,
      })
      .eq("id", user.id);

    if (updateError) throw updateError;

    res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ message: err.message });
  }
};

