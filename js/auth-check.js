async function checkAuth() {
  try {
    await supabaseInitPromise;
    if (!window.supabaseClient) throw new Error('認証サービスを初期化できませんでした。');
    const { data: { user }, error } = await window.supabaseClient.auth.getUser();
    if (error || !user) {
      window.location.replace('login.html');
      return null;
    }
    return user;
  } catch (error) {
    const showError = () => { document.body.textContent = '認証を確認できません: ' + error.message; };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showError);
    else showError();
    return null;
  }
}
const authReady = checkAuth();
