async function loadUserData() {
  await supabaseInitPromise;
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  // 1. プロフィール情報取得
  const { data: profile } = await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profile) {
    document.getElementById('userName').textContent = profile.name || '名称未設定';
    document.getElementById('userSchool').textContent = '学校: ' + (profile.school_name || '未設定');
    document.getElementById('userGrade').textContent = '学年: ' + (profile.grade ? profile.grade + '年' : '未設定');
    document.getElementById('userPoints').textContent = (profile.points || 0) + ' PT';
  }

  // 2. イベント一覧取得 (updated_at の降順、最大3件)
  const { data: events, error } = await window.supabaseClient
    .from('events')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(3);

  const container = document.getElementById('eventContainer');
  const lastUpdatedEl = document.getElementById('lastUpdated');

  if (events && events.length > 0) {
    // 💡 取得したデータの中で一番新しい updated_at をフォーマットして「最終更新日時」に設定
    const latestDate = new Date(events[0].updated_at);
    const month = latestDate.getMonth() + 1;
    const day = latestDate.getDate();
    const hours = String(latestDate.getHours()).padStart(2, '0');
    const minutes = String(latestDate.getMinutes()).padStart(2, '0');

    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = `最終更新: ${month}/${day} ${hours}:${minutes}`;
    }

    // イベント一覧の生成
    container.innerHTML = events.map(ev => {
      const dateParts = ev.event_date.split('-');
      const dateStr = `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}`;

      return `
        <div style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="font-weight: bold; font-size: 0.9rem; color: #333; line-height: 1.3;">
              ${ev.is_new ? '<span style="background: #ff3b30; color: white; font-size: 0.65rem; padding: 2px 5px; border-radius: 4px; font-weight: bold; margin-right: 6px; vertical-align: middle;">NEW</span>' : ''}
              ${ev.title}
            </div>
          </div>
          <div style="font-size: 0.78rem; color: #666; margin-top: 4px;">
            🗓 開催日: ${dateStr}
          </div>
        </div>
      `;
    }).join('');
  } else {
    if (lastUpdatedEl) lastUpdatedEl.textContent = '最終更新: --/-- --:--';
    container.innerHTML = '<p style="text-align: center; color: #888; padding: 15px 0; font-size: 0.85rem;">現在予定されているイベントはありません。</p>';
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabaseInitPromise;
  await window.supabaseClient.auth.signOut();
  window.location.href = 'login.html';
});

loadUserData();