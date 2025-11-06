const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Validate environment variables first
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn('⚠️ WARNING: Missing Supabase credentials - auth will not work');
}
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SERVICE_ROLE_KEY
);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Connection test function 
const connectDB = async () => {
  try {
    // Simple query to test connection
    const { error } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    
    if (error) throw error;
    
    console.log('✅ Supabase Database Connected');
  } catch (error) {
    console.error('❌ Supabase Connection Error:', error.message);
    // Don't exit, just warn
    console.log('⚠️ Continuing without DB connection...');
  }
};


module.exports = { supabase, supabaseAdmin, connectDB };
