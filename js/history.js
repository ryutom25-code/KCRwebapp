async function loadHistoryPage() {
  await supabaseInitPromise;
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  const historyList = document.getElementById('historyList');

  const { data: history, error } = await App.fetchAllResult(() => window.supabaseClient
    .from('point_history')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false }).order('id', { ascending: false }));

  if (error) { historyList.textContent = '履歴を取得できませんでした。再読み込みしてください。'; return; }
  if (!history || history.length === 0) {
    historyList.innerHTML = '<p style="text-align: center; color: #888; padding: 20px 0;">まだ獲得したポイントはありません。</p>';
    return;
  }

  historyList.innerHTML = history.map(item => {
    const date = new Date(item.created_at);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${month}/${day} ${hours}:${minutes}`;

    const amount = Number(item.points) || 0;
    return `<article class="history-row"><span class="tile-icon" aria-hidden="true">${amount < 0 ? '◇' : '＋'}</span><div class="item-description"><h3>${App.escapeHtml(item.title)}</h3><p>${timeStr}</p></div><strong class="point-amount ${amount < 0 ? 'negative' : ''}">${amount > 0 ? '+' : ''}${amount.toLocaleString()} PT</strong></article>`;
  }).join('');
}

loadHistoryPage();
