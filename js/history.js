async function loadHistoryPage() {
  await supabaseInitPromise;
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  const historyList = document.getElementById('historyList');

  const { data: history, error } = await window.supabaseClient
    .from('point_history')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !history || history.length === 0) {
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

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid #eee;">
        <div>
          <div style="font-weight: bold; font-size: 0.95rem; color: #333;">${item.title}</div>
          <div style="font-size: 0.8rem; color: #888; margin-top: 4px;">${timeStr}</div>
        </div>
        <div style="font-weight: bold; font-size: 1.1rem; color: #28a745;">
          ${item.points} PT
        </div>
      </div>
    `;
  }).join('');
}

loadHistoryPage();