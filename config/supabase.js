const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Validate environment variables first
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('❌ ERROR: Missing Supabase credentials');
  process.exit(1);
}

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
    console.error('❌ Supabase Connection Failed:', error.message);
    process.exit(1); // Exit like MongoDB does
  }
};

module.exports = { supabase, connectDB };
