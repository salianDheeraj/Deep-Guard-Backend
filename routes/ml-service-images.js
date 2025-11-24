// routes/ml-service-images.js
const express = require("express");
const router = express.Router();
const axios = require("axios");
const FormData = require("form-data");
const AdmZip = require("adm-zip");
const multer = require("multer");
const { supabaseAdmin } = require("../config/supabase");
const authMiddleware = require("../middleware/auth");

// Multer only to satisfy Express, WE DO NOT USE req.files
const upload = multer({ storage: multer.memoryStorage() });

// FASTAPI endpoint
const ML_URL = process.env.ML_IMAGE_URL;

if (!ML_URL) {
  console.error("❌ FATAL ERROR: ML_IMAGE_URL missing in .env");
}

console.log("🔥 IMAGE ML ENDPOINT =", ML_URL);

// ------------------------------------------------------
//              IMAGE ANALYSIS (FINAL VERSION)
// ------------------------------------------------------
router.post(
  "/:analysisId",
  authMiddleware,
  upload.none(), // FRONTEND DOES NOT SEND FILES
  async (req, res) => {
    try {
      const { analysisId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ success: false, message: "Not authenticated" });
      }

      // ------------------ 1. GET ANALYSIS ------------------
      const { data: analysis, error: fetchErr } = await supabaseAdmin
        .from("analyses")
        .select("*")
        .eq("id", analysisId)
        .eq("user_id", userId)
        .single();

      if (!analysis || fetchErr) {
        return res.status(404).json({ success: false, message: "Analysis not found" });
      }

      await supabaseAdmin
        .from("analyses")
        .update({ status: "processing" })
        .eq("id", analysisId);

      // ------------------ 2. GET IMAGE PATHS ------------------
      let paths = [];
      try {
        paths = JSON.parse(analysis.file_path); // multiple images
      } catch {
        paths = [analysis.file_path]; // single image
      }

      // ------------------ 3. PREP FORM DATA ------------------
      const form = new FormData();

      for (const p of paths) {
       const { data: dl, error: dlErr } = await supabaseAdmin.storage
  .from(analysis.bucket || "image_analyses")
  .download(p);


        if (dlErr) throw new Error("Failed downloading image from storage");

        const buffer = Buffer.from(await dl.arrayBuffer());
        const filename = p.split("/").pop();

        form.append("files", buffer, {
          filename,
          contentType: "image/jpeg",
        });
      }

      // ------------------ 4. SEND TO FASTAPI ------------------
   // ------------------ 4. SEND TO FASTAPI ------------------

// The screenshot shows FastAPI expects POST /detect/deepfake/images
// with multipart/form-data under the "files" field.

// Ensure ML_ENDPOINT includes the expected path. If ML_URL already points
// directly to the `/detect/deepfake/images` endpoint, use it as-is.
const ML_ENDPOINT = ML_URL && ML_URL.endsWith("/detect/deepfake/images")
  ? ML_URL
  : `${ML_URL}/detect/deepfake/images`;

console.log("📤 SENDING IMAGES →", ML_ENDPOINT);

let mlResponse;
try {
  mlResponse = await axios.post(ML_ENDPOINT, form, {
    headers: form.getHeaders(),    // MUST forward form-data headers
    responseType: "arraybuffer",   // FastAPI returns ZIP
    timeout: 600000,               // 10 min
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
} catch (err) {
  console.error("❌ FASTAPI IMAGE ERROR:", err.response?.data?.toString() || err.message);
  throw new Error("FastAPI failed during image processing");
}

const zipBuffer = mlResponse.data;


      // Detect JSON error instead of ZIP
      const textCheck = zipBuffer.toString("utf8");
      if (textCheck.startsWith("{") || textCheck.startsWith("<")) {
        console.error("❌ ML ERROR RESPONSE:", textCheck);
        throw new Error("ML returned error instead of ZIP file");
      }

      // ------------------ 5. PARSE ZIP ------------------
      let confidenceReport = null;

      try {
        const zip = new AdmZip(zipBuffer);
        const entry = zip.getEntries().find((e) => e.entryName === "confidence_report.json");

        if (entry) {
          confidenceReport = JSON.parse(entry.getData().toString("utf8"));
        }
      } catch (err) {
        console.warn("⚠️ Could not parse confidence_report.json:", err.message);
      }

      // Fallback if JSON file missing
      if (!confidenceReport) {
        confidenceReport = {
          batch_id: mlResponse.headers["x-batch-id"] || "",
          average_confidence: parseFloat(mlResponse.headers["x-average-confidence"] || 0),
        };
      }

      const score = confidenceReport.average_confidence || 0;
      const isDeepfake = score >= 0.5;

      // ------------------ 6. SAVE ZIP TO STORAGE ------------------
      const zipPath = `${userId}/${analysisId}/annotated_images.zip`;

      await supabaseAdmin.storage
.from(analysis.bucket || "image_analyses")
        .upload(zipPath, zipBuffer, {
          upsert: true,
          contentType: "application/zip",
        });

      // ------------------ 7. UPDATE DB ------------------
      await supabaseAdmin
        .from("analyses")
        .update({
          status: "completed",
          is_deepfake: isDeepfake,
          confidence_score: score,
          annotated_images_path: zipPath,
          analysis_result: confidenceReport,
          updated_at: new Date().toISOString(),
        })
        .eq("id", analysisId);

      return res.json({
        success: true,
        data: {
          analysis_id: analysisId,
          confidence_score: score,
          is_deepfake: isDeepfake,
        },
      });
    } catch (err) {
      console.error("❌ IMAGE ML ERROR:", err.message);

      await supabaseAdmin
        .from("analyses")
        .update({ status: "failed" })
        .eq("id", req.params.analysisId);

      return res.status(500).json({
        success: false,
        message: "ML processing failed",
        error: err.message,
      });
    }
  }
);

module.exports = router;
