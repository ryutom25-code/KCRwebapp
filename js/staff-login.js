const error = new URLSearchParams(location.search).get('error');
const messages = {
  credentials: 'ユーザー名またはパスワードが違います。',
  limit: '試行回数を超えました。しばらく待ってからお試しください。'
};
if (Object.hasOwn(messages, error)) document.getElementById('staffLoginError').textContent = messages[error];
