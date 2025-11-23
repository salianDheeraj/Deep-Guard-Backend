// routes/analysis-image-upload.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const { supabaseAdmin } = require("../config/supabase");
const authMiddleware = require("../middleware/auth");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 }, // 10MB per image
});

// ------------------------------------------------------
//               IMAGE UPLOAD (FINAL VERSION)
// ------------------------------------------------------
router.post(
  "/upload",
  authMiddleware,
  upload.array("files", 10),
  async (req, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ success: false, message: "Not authenticated" });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No images provided",
        });
      }

      // ------------------ 1. PREPARE ANALYSIS ENTRY ------------------
      // The `analyses` table requires non-null filename, file_path and file_size.
      // Compute summary info from incoming files so we can insert a valid row
      // and still use the generated analysisId when forming upload paths.
      const uploadedPaths = [];
      const fileNames = req.files.map((f) => f.originalname || "image");
      const totalSize = req.files.reduce((s, f) => s + (f.size || 0), 0);

      const initialInsert = {
        user_id: userId,
        type: "image",
        // DB allowed statuses: 'pending', 'processing', 'completed', 'failed'
        // use 'pending' for newly created analyses to satisfy the CHECK constraint
        status: "pending",
        bucket: "image_analyses",
        filename: fileNames[0] || "image",
        file_path: JSON.stringify([]),
        file_size: totalSize,
      };

      const { data: analysisRow, error: analysisErr } = await supabaseAdmin
        .from("analyses")
        .insert([initialInsert])
        .select()
        .single();

      if (analysisErr || !analysisRow) {
        console.error(analysisErr);
        throw new Error("Failed to create analysis record");
      }

      const analysisId = analysisRow.id;

      // ------------------ 2. UPLOAD EACH IMAGE ------------------
      for (const file of req.files) {
        const fileExt = file.originalname.split(".").pop();
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9\.]/g, "_");

        const uploadPath = `${userId}/${analysisId}/${Date.now()}_${cleanName}`;

        const { error: uploadErr } = await supabaseAdmin.storage
          .from("image_analyses")
          .upload(uploadPath, file.buffer, {
            upsert: true,
            contentType: file.mimetype || "image/jpeg",
          });

        if (uploadErr) {
          console.error(uploadErr);
          throw new Error("Failed uploading one of the images");
        }

        uploadedPaths.push(uploadPath);
      }

      // ------------------ 3. UPDATE ANALYSIS ENTRY ------------------
      await supabaseAdmin
        .from("analyses")
        .update({
          file_path: JSON.stringify(uploadedPaths),
          // move to 'processing' so the ML worker knows it's ready
          status: "processing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", analysisId);

      // ------------------ 4. RESPOND TO FRONTEND ------------------
      return res.json({
        success: true,
        analysis_id: analysisId,
        images_uploaded: uploadedPaths.length,
      });
    } catch (err) {
      console.error("❌ IMAGE UPLOAD ERROR:", err.message);

      return res.status(500).json({
        success: false,
        message: "Image upload failed",
        error: err.message,
      });
    }
  }
);

module.exports = router;
