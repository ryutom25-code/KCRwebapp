document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await supabaseInitPromise;

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    alert('ログイン失敗: ' + error.message);
  } else {
    window.location.href = 'home.html';
  }
});