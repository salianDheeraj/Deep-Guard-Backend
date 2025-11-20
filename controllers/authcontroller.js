const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");
const { supabase } = require("../config/supabase");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// -------------------------------
// TOKEN + SESSION HELPERS
// -------------------------------
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createAccessToken = (userId, email, tokenVersion) =>
  jwt.sign(
    { userId, email, tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

const createRefreshToken = (userId, email, tokenVersion) =>
  jwt.sign(
    { userId, email, tokenVersion },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "30d" }
  );

const setAuthCookies = (res, access, refresh) => {
  res.cookie("accessToken", access, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });

  res.cookie("refreshToken", refresh, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
};

const createSession = async (req, user, refreshToken) => {
  const hashedRT = hashToken(refreshToken);

  await supabase.from("sessions").insert({
    user_id: user.id,
    refresh_token_hash: hashedRT,
    token_version_snapshot: user.token_version,
    user_agent: req.headers["user-agent"],
    ip_address: req.ip,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
};

// -------------------------------
// EMAIL HELPERS
// -------------------------------
const mailer = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
});

// -------------------------------
// FORMAT USER
// -------------------------------
const formatUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  profilePicture:
    user.profile_picture ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`,
});

// -------------------------------
// OTP STORE (Signup Only)
// -------------------------------
const signupOtpStore = new Map();
const SIGNUP_OTP_EXPIRY_MS = 5 * 60 * 1000;

// -------------------------------
// SEND SIGNUP OTP
// -------------------------------
exports.sendSignupOtp = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const normalized = email.toLowerCase().trim();

    const { data: exists } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalized)
      .single();

    if (exists) return res.status(400).json({ message: "User already exists" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashed = await bcrypt.hash(otp, 10);

    signupOtpStore.set(normalized, {
      hashedOtp: hashed,
      expiresAt: Date.now() + SIGNUP_OTP_EXPIRY_MS,
      name,
    });

    await mailer.sendMail({
      from: `"Deep Guard" <${process.env.EMAIL_USER}>`,
      to: normalized,
      subject: "Verify your Deep Guard account",
      html: `<h1>${otp}</h1>`,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("OTP error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

// -------------------------------
// SIGNUP
// -------------------------------
exports.signup = async (req, res) => {
  try {
    const { email, password, name, otp } = req.body;
    const normalized = email.toLowerCase().trim();

    const entry = signupOtpStore.get(normalized);
    if (!entry) return res.status(400).json({ message: "OTP not requested" });

    if (Date.now() > entry.expiresAt) {
      signupOtpStore.delete(normalized);
      return res.status(400).json({ message: "OTP expired" });
    }

    const validOtp = await bcrypt.compare(otp, entry.hashedOtp);
    if (!validOtp) return res.status(400).json({ message: "Invalid OTP" });

    const hash = await bcrypt.hash(password, 10);

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        email: normalized,
        name: name || normalized.split("@")[0],
        password_hash: hash,
        token_version: 1,
      })
      .select()
      .single();

    if (error) throw error;

    signupOtpStore.delete(normalized);

    const access = createAccessToken(user.id, user.email, user.token_version);
    const refresh = createRefreshToken(user.id, user.email, user.token_version);

    await createSession(req, user, refresh);

    setAuthCookies(res, access, refresh);

    res.status(201).json({ user: formatUser(user) });
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

// -------------------------------
// LOGIN
// -------------------------------
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalized = email.toLowerCase().trim();

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", normalized)
      .single();

    if (!user || !user.password_hash)
      return res.status(401).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ message: "Invalid credentials" });

    const access = createAccessToken(user.id, user.email, user.token_version);
    const refresh = createRefreshToken(user.id, user.email, user.token_version);

    await createSession(req, user, refresh);

    setAuthCookies(res, access, refresh);

    res.json({ user: formatUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

// -------------------------------
// GOOGLE LOGIN
// -------------------------------
exports.googleLogin = async (req, res) => {
  try {
    const { credentials } = req.body;

    const ticket = await googleClient.verifyIdToken({
      idToken: credentials,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("google_id", googleId)
      .single();

    if (!user) {
      const insert = await supabase
        .from("users")
        .insert({
          google_id: googleId,
          email,
          name,
          profile_picture: picture,
          token_version: 1,
        })
        .select()
        .single();

      user = insert.data;
    }

    const access = createAccessToken(user.id, user.email, user.token_version);
    const refresh = createRefreshToken(user.id, user.email, user.token_version);

    await createSession(req, user, refresh);
    setAuthCookies(res, access, refresh);

    res.json({ user: formatUser(user) });
  } catch (err) {
    console.error("Google Auth Error:", err);
    res.status(401).json({ message: "Invalid Google token" });
  }
};

// -------------------------------
// REFRESH ENDPOINT DISABLED
// -------------------------------
exports.refresh = (req, res) => {
  return res.status(400).json({
    message: "Refresh handled automatically by middleware",
  });
};

// -------------------------------
// GET ME
// -------------------------------
exports.getMe = (req, res) => {
  return res.json(formatUser(req.user));
};

// -------------------------------
// LOGOUT (current session only)
// -------------------------------
exports.logout = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const hashedRT = hashToken(refreshToken);
      await supabase
        .from("sessions")
        .delete()
        .eq("refresh_token_hash", hashedRT);
    }

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");

    return res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout Error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};

// -------------------------------
// LOGOUT ALL DEVICES
// -------------------------------
exports.logoutAllDevices = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: updated, error } = await supabase
      .from("users")
      .update({ token_version: req.user.tokenVersion + 1 })
      .eq("id", userId)
      .select("token_version")
      .single();

    if (error) throw error;

    await supabase
      .from("sessions")
      .delete()
      .eq("user_id", userId);

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");

    return res.json({
      success: true,
      message: "Logged out from all devices",
    });
  } catch (err) {
    console.error("Logout-All Error:", err);
    res.status(500).json({ message: "Internal error" });
  }
};
