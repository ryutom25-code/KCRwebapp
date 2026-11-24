// Static hosting for participants uses the existing public Supabase project.
const staticSupabaseConfig = {
  url: "https://iwkdcxtjpsyalxlxtsbv.supabase.co",
  publicKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3a2RjeHRqcHN5YWx4bHh0c2J2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNTY2MjQsImV4cCI6MjEwNjgzMjYyNH0.L4UGm2ZvGlqOOCbjnnW2CeYbBa0IjCneufPsQ-eZ8TU"
};

async function loadSupabaseConfig(isStaff) {
  if (location.protocol !== 'file:') {
    const response = await fetch('/api/config', { cache: 'no-store' }).catch(() => {
      throw new Error('接続設定を取得できません。通信状況を確認してください。');
    });
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('application/json')) {
      const config = await response.json();
      if (!config?.url || !config.publicKey) throw new Error('Supabaseの接続設定が不足しています。');
      return config;
    }
    const missingRoute = [404, 405].includes(response.status) ||
      (response.ok && contentType.includes('text/html'));
    if (!missingRoute) throw new Error('接続設定を取得できません。サーバーの設定を確認してください。');
  }

  if (isStaff) {
    const localPreview = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) ||
      location.protocol === 'file:';
    if (localPreview) throw new Error('Node.jsを起動し、http://127.0.0.1:8080/admin/ を開いてください。');
    throw new Error('Node.js版のURLから管理画面を開いてください。');
  }
  return staticSupabaseConfig;
}

async function initSupabase() {
  if (!window.supabase) throw new Error('認証サービスを読み込めませんでした。ページを再読み込みしてください。');
  const isStaff = document.body.dataset.area === 'admin';
  const { url, publicKey } = await loadSupabaseConfig(isStaff);
  if (!isStaff) {
    window.supabaseClient = window.supabase.createClient(url, publicKey);
    return;
  }

  const staffUrl = new URL('/api/staff', location.origin).href;
  const staffFetch = async (input, options) => {
    const result = await fetch(input, { ...options, credentials: 'same-origin' });
    if (result.status === 401) location.replace('/admin/login.html');
    return result;
  };
  window.supabaseClient = window.supabase.createClient(staffUrl, 'staff-session', {
    accessToken: async () => null,
    global: { fetch: staffFetch }
  });
  window.productImagesUrl = new URL('/storage/v1/object/public/product-images/', url).href;
}

const supabaseInitPromise = initSupabase();
