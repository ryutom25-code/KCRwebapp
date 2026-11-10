async function checkAuth() {
  // env.js の Supabase 初期化完了を必ず待つ
  if (typeof supabaseInitPromise !== 'undefined') {
    await supabaseInitPromise;
  }

  // クライアントが存在しない場合の安全装置
  if (!window.supabaseClient) {
    console.error('SupabaseClient が初期化されていません。');
    return;
  }

  const { data: { user } } = await window.supabaseClient.auth.getUser();

  // 未ログインの場合は signup.html へリダイレクト
  if (!user) {
    window.location.href = 'signup.html';
  }
}

checkAuth();