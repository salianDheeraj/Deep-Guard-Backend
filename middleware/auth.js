const jwt = require("jsonwebtoken");
const { supabase } = require("../config/supabase");
const crypto = require("crypto");

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const authMiddleware = async (req, res, next) => {
  console.log("Cookies received:", req.cookies);

  try {
    const accessToken = req.cookies.accessToken || null;
    const refreshToken = req.cookies.refreshToken || null;

    if (!accessToken && !refreshToken) {
      return res.status(401).json({ code: "NO_TOKENS", message: "Not authorized" });
    }

    let decoded = null;

    // -------------------------------------------------
    // 1. Try ACCESS TOKEN
    // -------------------------------------------------
    if (accessToken) {
      try {
        decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      } catch (err) {
        if (err.name !== "TokenExpiredError") {
          return res.status(401).json({ code: "INVALID_ACCESS", message: "Invalid token" });
        }
      }
    }

    // -------------------------------------------------
    // 2. If no access token → try REFRESH TOKEN
    // -------------------------------------------------
    if (!decoded && refreshToken) {
      let refreshDecoded;

      try {
        refreshDecoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET
        );
      } catch (err) {
        return res.status(401).json({
          code: "INVALID_REFRESH",
          message: "Session expired, please login again",
        });
      }

      // 2A: Validate refresh token in sessions table
      const hashedRT = hashToken(refreshToken);

      const { data: session } = await supabase
        .from("sessions")
        .select("*")
        .eq("refresh_token_hash", hashedRT)
        .eq("user_id", refreshDecoded.userId)
        .single();

      if (!session) {
        return res.status(401).json({
          code: "REFRESH_NOT_FOUND",
          message: "Session expired, login again",
        });
      }

      // 2B: Skip strict UA check (Chrome updates its UA frequently)
      // (Intentionally disabled)

      // 2C: Confirm token version is still valid
      const { data: userData } = await supabase
        .from("users")
        .select("token_version")
        .eq("id", refreshDecoded.userId)
        .single();

      if (userData.token_version !== refreshDecoded.tokenVersion) {
        return res.status(401).json({
          code: "TOKEN_VERSION_MISMATCH",
          message: "Session invalidated",
        });
      }

      // 2D: Rotate refresh token
      const newRefreshToken = jwt.sign(
        {
          userId: refreshDecoded.userId,
          email: refreshDecoded.email,
          tokenVersion: userData.token_version,
        },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: "30d" }
      );

      const newRefreshHash = hashToken(newRefreshToken);

      await supabase
        .from("sessions")
        .update({
          refresh_token_hash: newRefreshHash,
          user_agent: req.headers["user-agent"],
          ip_address: req.ip,
        })
        .eq("id", session.id);

      res.cookie("refreshToken", newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: "/",
      });

      // 2E: Issue new access token
      const newAccessToken = jwt.sign(
        {
          userId: refreshDecoded.userId,
          email: refreshDecoded.email,
          tokenVersion: userData.token_version,
        },
        process.env.JWT_SECRET,
        { expiresIn: "15m" }
      );

      res.cookie("accessToken", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 15 * 60 * 1000,
        path: "/",
      });

      decoded = refreshDecoded;
    }

    if (!decoded) {
      return res.status(401).json({ code: "AUTH_FAILED", message: "Not authorized" });
    }

    // -------------------------------------------------
    // 3. Fetch user FROM DATABASE
    // FIXED: correct column name "profile_picture"
    // -------------------------------------------------
    const { data: user } = await supabase
      .from("users")
      .select("id, name, email, profile_picture, token_version")
      .eq("id", decoded.userId)
      .single();

    if (!user) {
      return res.status(401).json({ code: "USER_NOT_FOUND", message: "User not found" });
    }

    // -------------------------------------------------
    // 4. Token version validation
    // -------------------------------------------------
    if (user.token_version !== decoded.tokenVersion) {
      return res.status(401).json({
        code: "TOKEN_VERSION_MISMATCH",
        message: "Session invalidated",
      });
    }

    // -------------------------------------------------
    // 5. Attach sanitized user object
    // -------------------------------------------------
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      profile_pic: user.profile_picture, // mapped correctly
      tokenVersion: user.token_version,
    };

    next();
  } catch (err) {
    console.error("Middleware Error:", err);
    return res.status(401).json({
      code: "SERVER_ERROR",
      message: "Not authorized",
    });
  }
};

module.exports = authMiddleware;
