async function loadUserData() {
  await supabaseInitPromise;
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  // 1. プロフィール情報取得
  const { data: profile, error: profileError } = await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) { document.getElementById('userName').textContent = 'プロフィール取得失敗'; return; }
  if (!profile) { window.location.href = 'profile.html'; return; }
  if (profile) {
    document.getElementById('userName').textContent = profile.name || '名称未設定';
    document.getElementById('userSchool').textContent = '学校: ' + (profile.school_name || '未設定');
    document.getElementById('userGrade').textContent = '学年: ' + (profile.grade ? (/^[0-9]+$/.test(String(profile.grade)) ? profile.grade + '年' : profile.grade) : '未設定');
    document.getElementById('userPoints').textContent = (profile.points || 0) + ' PT';
  }

  // 2. イベント一覧取得 (updated_at の降順、最大3件)
  const { data: events, error } = await window.supabaseClient
    .from('events')
    .select('*')
    .order('updated_at', { ascending: false })

  const container = document.getElementById('eventContainer');
  const lastUpdatedEl = document.getElementById('lastUpdated');

  if (error) { container.textContent = 'お知らせを取得できませんでした。再読み込みしてください。'; return; }
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

    container.innerHTML = events.map(ev => {
      const parts = String(ev.event_date || '').split('-');
      return `<article class="event-row"><div class="date-tile"><small>${App.escapeHtml(parts[1] || '—')}月</small>${App.escapeHtml(parts[2] || '—')}</div><div><h3>${ev.is_new ? '<span class="badge">NEW</span>' : ''}${App.escapeHtml(ev.title)}</h3><p>${App.escapeHtml(ev.event_date || '開催日未定')}</p></div></article>`;
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
