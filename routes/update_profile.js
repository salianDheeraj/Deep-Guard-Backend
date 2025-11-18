/**
 *  AUTH ROUTES (Final Version)
 *  Supports:
 *   - Signup / Login
 *   - Google OAuth Redirect + Callback
 *   - Me (Get user)
 *   - Update Profile
 *   - Change Password
 *   - Delete Analyses
 *   - Delete Account
 *   - Refresh Token
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");
const requireAuth = require("../middleware/auth");

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SERVICE_ROLE_KEY
);

// ---------------- TOKEN HELPERS ---------------- //
const createAccessToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "15m",
  });

const createRefreshToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: "7d",
  });

const setCookies = (res, access, refresh) => {
  res.cookie("accessToken", access, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    maxAge: 15 * 60 * 1000,
    path: "/",
  });

  res.cookie("refreshToken", refresh, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
};

// ---------------- FORMAT USER ---------------- //
const cleanUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  profile_pic:
    u.profile_pic ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.email}`,
});

// ============================================================
// GOOGLE OAUTH REDIRECT
// ============================================================
router.get("/google", (req, res) => {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.SERVER_URL}/auth/google/callback`
  );

  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["profile", "email"],
  });

  return res.redirect(url);
});

// ============================================================
// GOOGLE OAUTH CALLBACK
// ============================================================
router.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code;

    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.SERVER_URL}/auth/google/callback`
    );

    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);

    const oauth2 = google.oauth2("v2");
    const { data: profile } = await oauth2.userinfo.get({ auth: oauth });

    const { id: googleId, email, name, picture } = profile;

    // Check if user exists
    const { data: existing } = await supabase
      .from("users")
      .select("*")
      .eq("google_id", googleId)
      .single();

    let user;
    if (!existing) {
      const { data, error } = await supabase
        .from("users")
        .insert({
          google_id: googleId,
          email,
          name,
          profile_pic: picture,
        })
        .select()
        .single();
      if (error) throw error;
      user = data;
    } else {
      user = existing;
    }

    const access = createAccessToken(user.id);
    const refresh = createRefreshToken(user.id);

    setCookies(res, access, refresh);

    return res.redirect(`${process.env.CLIENT_URL}/dashboard`);
  } catch (err) {
    console.error("GOOGLE CALLBACK ERROR:", err.message);
    return res.redirect(`${process.env.CLIENT_URL}/login?error=google`);
  }
});

// ============================================================
// SIGNUP
// ============================================================
router.post("/signup", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const { data: exists } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("users")
      .insert({
        email,
        name,
        password_hash: hash,
      })
      .select()
      .single();

    if (error) throw error;

    const access = createAccessToken(data.id);
    const refresh = createRefreshToken(data.id);

    setCookies(res, access, refresh);

    res.json({ user: cleanUser(data) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// LOGIN
// ============================================================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    if (!user.password_hash)
      return res.status(401).json({ message: "Google account detected" });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    const access = createAccessToken(user.id);
    const refresh = createRefreshToken(user.id);

    setCookies(res, access, refresh);

    res.json({ user: cleanUser(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// GET PROFILE
// ============================================================
router.get("/me", requireAuth, async (req, res) => {
  res.json(cleanUser(req.user));
});

// ============================================================
// UPDATE PROFILE
// ============================================================
router.put("/update-profile", requireAuth, async (req, res) => {
  try {
    const { name, profile_pic } = req.body;

    const { data, error } = await supabase
      .from("users")
      .update({ name, profile_pic })
      .eq("id", req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ message: "Updated", user: cleanUser(data) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// CHANGE PASSWORD
// ============================================================
router.post("/change-password", requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    const valid = await bcrypt.compare(
      current_password,
      req.user.password_hash
    );

    if (!valid) {
      return res.status(401).json({ message: "Incorrect password" });
    }

    const hashed = await bcrypt.hash(new_password, 10);

    await supabase
      .from("users")
      .update({ password_hash: hashed })
      .eq("id", req.user.id);

    res.json({ message: "Password updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============================================================
// DELETE ANALYSES
// ============================================================
router.delete("/delete-analyses", requireAuth, async (req, res) => {
  await supabase.from("analyses").delete().eq("user_id", req.user.id);
  res.json({ message: "All analyses deleted" });
});

// ============================================================
// DELETE ACCOUNT
// ============================================================
router.delete("/delete-account", requireAuth, async (req, res) => {
  await supabase.from("analyses").delete().eq("user_id", req.user.id);
  await supabase.from("users").delete().eq("id", req.user.id);

  res.clearCookie("accessToken", { path: "/" });
  res.clearCookie("refreshToken", { path: "/" });

  res.json({ message: "Account deleted" });
});

// ============================================================
// REFRESH TOKEN
// ============================================================
router.post("/refresh", (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ message: "No refresh token" });

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    const newAccess = createAccessToken(decoded.userId);

    res.cookie("accessToken", newAccess, {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      maxAge: 15 * 60 * 1000,
    });

    res.json({ message: "Refreshed" });
  } catch (err) {
    res.status(401).json({ message: "Invalid refresh token" });
  }
});

module.exports = router;
