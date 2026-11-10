document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await supabaseInitPromise;

  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    alert('ユーザー認証が見つかりません。再ログインしてください。');
    window.location.href = 'login.html';
    return;
  }

  const updates = {
    id: user.id,
    name: document.getElementById('fullName').value,
    school_name: document.getElementById('schoolName').value,
    grade: document.getElementById('grade').value,
    created_at: new Date()
  };

  const { error } = await window.supabaseClient.from('profiles').upsert(updates);

  if (error) {
    alert('保存エラー: ' + error.message);
  } else {
    window.location.href = 'home.html';
  }
});