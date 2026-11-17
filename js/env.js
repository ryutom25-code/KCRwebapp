// Public Supabase configuration only. Never put service-role credentials here.
async function initSupabase() {
  let supabaseUrl = "https://iwkdcxtjpsyalxlxtsbv.supabase.co";
  let supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3a2RjeHRqcHN5YWx4bHh0c2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNTY2MjQsImV4cCI6MjEwNjgzMjYyNH0.L4UGm2ZvGlqOOCbjnnW2CeYbBa0IjCneufPsQ-eZ8TU";

  // フォールバック（直接入力用）
  supabaseUrl = supabaseUrl || "YOUR_SUPABASE_URL";
  supabaseKey = supabaseKey || "YOUR_SUPABASE_ANON_KEY";

  if (window.supabase) {
    window.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  }
}

const supabaseInitPromise = initSupabase();
