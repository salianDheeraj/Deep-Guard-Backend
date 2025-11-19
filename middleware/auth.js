const jwt = require("jsonwebtoken");
const { supabase } = require("../config/supabase");

const authMiddleware = async (req, res, next) => {
  try {
    const accessToken = req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;

    // -------------------------------------------------------------
    // 1) No token at all → reject
    // -------------------------------------------------------------
    if (!accessToken && !refreshToken) {
      return res.status(401).json({ message: "Not authorized, no token provided" });
    }

    let decoded = null;

    // -------------------------------------------------------------
    // 2) Try ACCESS TOKEN first
    // -------------------------------------------------------------
    if (accessToken) {
      try {
        decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
        console.log("🔐 Access token valid");
      } catch (err) {
        console.log("⚠️ Access token expired:", err.message);
      }
    }

    // -------------------------------------------------------------
    // 3) If access token invalid → try REFRESH TOKEN
    // -------------------------------------------------------------
    if (!decoded && refreshToken) {
      try {
        const refreshDecoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET
        );

        console.log("🔁 Refresh token valid → issuing new access token…");

        // Issue a NEW 15-min access token
        const newAccessToken = jwt.sign(
          { userId: refreshDecoded.userId, email: refreshDecoded.email },
          process.env.JWT_SECRET,
          { expiresIn: "15m" }
        );

        // Set in cookie
        res.cookie("accessToken", newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 15 * 60 * 1000,
          path: "/",
        });

        decoded = refreshDecoded; // Treat refresh as valid session
      } catch (err) {
        console.log("❌ Refresh token invalid:", err.message);

        return res.status(401).json({
          message: "Session expired, please login again",
        });
      }
    }

    // -------------------------------------------------------------
    // 4) If still no decoded token → unauthorized
    // -------------------------------------------------------------
    if (!decoded) {
      return res.status(401).json({ message: "Not authorized" });
    }

    console.log("👤 Authenticated User ID:", decoded.userId);

    // -------------------------------------------------------------
    // 5) Fetch actual user from Supabase
    // -------------------------------------------------------------
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", decoded.userId)
      .single();

    if (error || !user) {
      console.error("❌ User not found in DB:", error?.message);
      return res.status(401).json({ message: "User not found" });
    }

    // Attach full user object to req
    req.user = user;

    next();
  } catch (err) {
    console.error("❌ Middleware failure:", err.message);
    return res.status(401).json({
      message: "Not authorized",
      error: err.message,
    });
  }
};

module.exports = authMiddleware;
