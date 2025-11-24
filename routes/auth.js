// routes/auth.js
const express = require("express");
const authController = require("../controllers/authcontroller");
const authMiddleware = require("../middleware/auth");
const router = express.Router();

// PUBLIC AUTH ROUTES
router.post("/signup/send-otp", authController.sendSignupOtp);
router.post("/signup", authController.signup);
router.post("/login", authController.login);
router.post("/google", authController.googleLogin);

// PASSWORD RESET ROUTES
router.post("/send-reset-otp", authController.sendResetOtp);
router.post("/reset-password", authController.resetPassword);

// AUTHENTICATED USER ROUTES
router.get("/me", authMiddleware, authController.getMe);
router.post("/logout", authMiddleware, authController.logout);
router.post("/logout-all", authMiddleware, authController.logoutAllDevices);

// NO /refresh HERE – refresh is handled inside authMiddleware

module.exports = router;
