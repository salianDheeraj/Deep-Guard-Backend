const express = require("express");
const authController = require("../controllers/authcontroller");
const authMiddleware = require("../middleware/auth");
const router = express.Router();

router.post("/signup/send-otp", authController.sendSignupOtp);
router.post("/signup", authController.signup);
router.post("/login", authController.login);
router.post("/google", authController.googleLogin);

// REMOVE THESE (they do not exist anymore)
 router.post("/send-reset-otp", authController.sendResetOtp);
router.post("/reset-password", authController.resetPassword);

router.get("/me", authMiddleware, authController.getMe);
/* router.post("/refresh", authController.refresh); */

router.post("/logout", authMiddleware, authController.logout);
router.post("/logout-all", authMiddleware, authController.logoutAllDevices);

module.exports = router;
