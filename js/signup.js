document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await supabaseInitPromise;

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  const { data, error } = await window.supabaseClient.auth.signUp({ email, password });

  if (error) {
    alert('登録エラー: ' + error.message);
    return;
  }

  if (data.session) {
    window.location.href = 'profile.html';
  } else {
    alert('確認メールを送信しました。メール内のリンクを開いてからログインしてください。');
    window.location.href = 'login.html';
  }
});