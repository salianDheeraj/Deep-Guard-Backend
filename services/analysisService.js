const supabase = require("../config/supabase");
const { generateSupabasePath } = require("../utils/helpers");

/**
 * Upload video to Supabase Storage
 */
const uploadToSupabase = async (file, analysisId, userId) => {
  try {
    console.log(`[Storage] Uploading: ${file.originalname}`);

    const supabasePath = generateSupabasePath(userId, analysisId, file.originalname);
    console.log(`[Storage] Path: ${supabasePath}`);

    const { data, error } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET_NAME || "deepfake-analyses")
      .upload(supabasePath, file.buffer, {
        contentType: file.mimetype,
        cacheControl: "3600",
        upsert: false
      });

    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }

    console.log(`[Storage] ✅ Upload successful`);
    return supabasePath;

  } catch (error) {
    console.error(`[Storage] Error:`, error.message);
    throw error;
  }
};

/**
 * Save metadata to database
 */
const saveMetadataToDatabase = async (analysisId, file, supabasePath, userId) => {
  try {
    console.log(`[Database] Saving metadata...`);

    const { data, error } = await supabase
      .from("analyses")
      .insert([{
        id: analysisId,
        user_id: userId,
        filename: file.originalname,
        file_path: supabasePath,
        bucket: process.env.SUPABASE_BUCKET_NAME || "deepfake-analyses",
        file_size: file.size,
        file_type: file.mimetype,
        status: "pending",
        is_shared: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select();

    if (error) {
      console.warn(`[Database] Insert warning:`, error.message);
      return null;
    }

    console.log(`[Database] ✅ Metadata saved`);
    return data[0];

  } catch (error) {
    console.error(`[Database] Error:`, error.message);
    throw error;
  }
};

/**
 * Fetch analysis by ID
 */
const getAnalysisById = async (analysisId) => {
  try {
    console.log(`[Database] Fetching analysis: ${analysisId}`);

    const { data, error } = await supabase
      .from("analyses")
      .select("*")
      .eq("id", analysisId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch analysis: ${error.message}`);
    }

    console.log(`[Database] ✅ Analysis fetched`);
    return data;

  } catch (error) {
    console.error(`[Database] Error:`, error.message);
    throw error;
  }
};

/**
 * Fetch all analyses for a user
 */
const getUserAnalyses = async (userId) => {
  try {
    console.log(`[Database] Fetching analyses for user: ${userId}`);

    const { data, error } = await supabase
      .from("analyses")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch analyses: ${error.message}`);
    }

    console.log(`[Database] ✅ ${data.length} analyses fetched`);
    return data;

  } catch (error) {
    console.error(`[Database] Error:`, error.message);
    throw error;
  }
};

/**
 * Update analysis status
 */
const updateAnalysisStatus = async (analysisId, status) => {
  try {
    console.log(`[Database] Updating status for ${analysisId} to ${status}`);

    const { data, error } = await supabase
      .from("analyses")
      .update({
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq("id", analysisId)
      .select();

    if (error) {
      throw new Error(`Failed to update status: ${error.message}`);
    }

    console.log(`[Database] ✅ Status updated`);
    return data[0];

  } catch (error) {
    console.error(`[Database] Error:`, error.message);
    throw error;
  }
};

/**
 * Delete analysis from storage and database
 */
const deleteAnalysis = async (analysisId, supabasePath) => {
  try {
    console.log(`[Service] Deleting analysis: ${analysisId}`);

    // Step 1: Delete from storage
    const { error: deleteError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET_NAME || "deepfake-analyses")
      .remove([supabasePath]);

    if (deleteError) {
      console.warn(`[Storage] Delete warning:`, deleteError.message);
    }

    // Step 2: Delete from database
    const { error: dbError } = await supabase
      .from("analyses")
      .delete()
      .eq("id", analysisId);

    if (dbError) {
      throw new Error(`Failed to delete: ${dbError.message}`);
    }

    console.log(`[Service] ✅ Analysis deleted`);
    return true;

  } catch (error) {
    console.error(`[Service] Error:`, error.message);
    throw error;
  }
};

module.exports = {
  uploadToSupabase,
  saveMetadataToDatabase,
  getAnalysisById,
  getUserAnalyses,
  updateAnalysisStatus,
  deleteAnalysis
};
