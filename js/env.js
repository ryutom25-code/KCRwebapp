// ルート直下の .env から設定を読み込み Supabase を初期化
async function initSupabase() {
  let supabaseUrl = "https://iwkdcxtjpsyalxlxtsbv.supabase.co";
  let supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3a2RjeHRqcHN5YWx4bHh0c2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNTY2MjQsImV4cCI6MjEwNjgzMjYyNH0.L4UGm2ZvGlqOOCbjnnW2CeYbBa0IjCneufPsQ-eZ8TU";

  try {
    const response = await fetch('./.env');
    if (response.ok) {
      const text = await response.text();
      text.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        const val = values.join('=').trim();
        if (key.trim() === 'VITE_SUPABASE_URL') supabaseUrl = val;
        if (key.trim() === 'VITE_SUPABASE_ANON_KEY') supabaseKey = val;
      });
    }
  } catch (e) {
    console.warn('.envファイルの読み込みに失敗しました。');
  }

  // フォールバック（直接入力用）
  supabaseUrl = supabaseUrl || "YOUR_SUPABASE_URL";
  supabaseKey = supabaseKey || "YOUR_SUPABASE_ANON_KEY";

  if (window.supabase) {
    window.supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  }
}

const supabaseInitPromise = initSupabase();