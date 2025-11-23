const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");
const authMiddleware = require("./middleware/auth");
dotenv.config();

/* ---------------------- ROUTES ---------------------- */
const authRoutes = require("./routes/auth");
const accountRoutes = require("./routes/update_profile");
const mlServices = require("./routes/ml-service");
const analysisRouter = require("./routes/analysis");
const imageAnalysisRoutes = require("./routes/analysis-image-upload");
const mlServiceImagesRoutes = require("./routes/ml-service-images");

const app = express();

/* ------------------ GLOBAL MIDDLEWARE ------------------ */
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

app.use(logger);
app.use(cookieParser());
app.use("/api/analysis/image", authMiddleware, imageAnalysisRoutes);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------- ROUTES ---------------------- */

// AUTH (no auth middleware here)
app.use("/auth", authRoutes);

// ACCOUNT ROUTES
app.use("/api/account", authMiddleware, accountRoutes);

// IMAGE UPLOAD (NOT ML)
app.use("/api/analysis/image", authMiddleware, imageAnalysisRoutes);

// ANALYSIS ROUTES (video upload)
app.use("/api/analysis", authMiddleware, analysisRouter);

// ************* IMPORTANT ORDER ************* //
// IMAGE ML must come before VIDEO ML
app.use("/api/ml/images", authMiddleware, mlServiceImagesRoutes);
app.use("/api/ml/analyze", authMiddleware, mlServices);
// ******************************************* //

app.get("/", (req, res) => {
  res.json({ status: "Backend running 🚀" });
});

app.use(errorHandler);

/* --------------------- START SERVER --------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
