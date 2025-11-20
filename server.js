const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");
const authMiddleware=require("./middleware/auth")
dotenv.config();

/* ---------------------- ROUTES ---------------------- */
const authRoutes = require("./routes/auth");              // ✔ Fixed
const accountRoutes = require("./routes/update_profile");  // ✔ Fixed (update profile, change password, delete)
const mlServices = require("./routes/ml-service");
const analysisRouter = require("./routes/analysis");
const mlServiceImagesRoutes = require('./routes/ml-service-images'); 
/* ---------------------------------------------------- */

const app = express();

/* ------------------ GLOBAL MIDDLEWARE ------------------ */


app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,   // ✔ allows cookies
  })
);
app.use(logger);
app.use(cookieParser());    // ✔ required for auth cookies
app.use(express.json({
    // Add a verify function to capture the raw body for debugging
    verify: (req, res, buf) => {
      
        if (buf && buf.length) {
            req.rawBody = buf.toString();
        }
    }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------- ROUTES ---------------------- */

// AUTH (Login, Signup, Google Auth, Refresh, Me)
app.use("/auth", authRoutes);              // ✔ main auth route

// ACCOUNT ROUTES (update profile, change password, delete)
app.use("/api/account",authMiddleware, accountRoutes);    // ✔ updated path

// ANALYSIS ROUTES (upload + results)
app.use("/api/analysis",authMiddleware, analysisRouter);
app.use('/ml-service-images',authMiddleware, mlServiceImagesRoutes); // NEW
// ML SERVICE ROUTE
app.use("/api/ml/analyze",authMiddleware, mlServices);


// SERVER HEALTH CHECK
app.get("/", (req, res) => {
  res.json({ status: "Backend running 🚀" });
});

// ERROR HANDLER
app.use(errorHandler);

/* --------------------- START SERVER --------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
