document.addEventListener('DOMContentLoaded', async () => {
  let retryCount = 0;
  while (!window.supabaseClient && retryCount < 20) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retryCount++;
  }

  if (!window.supabaseClient) {
    alert('エラー: Supabaseが初期化されていません。');
    return;
  }

  loadEvents();

  const form = document.getElementById('eventForm');
  const cancelBtn = document.getElementById('cancelEditBtn');

  if (form) form.addEventListener('submit', handleSaveEvent);
  if (cancelBtn) cancelBtn.addEventListener('click', resetForm);
});

// イベント一覧の取得＆描画
async function loadEvents() {
  const listContainer = document.getElementById('adminEventList');
  if (!listContainer) return;

  const { data: events, error } = await window.supabaseClient
    .from('events')
    .select('*')
    .order('event_date', { ascending: false });

  if (error) {
    listContainer.innerHTML = '<p style="color: red; text-align: center;">読み込みエラーが発生しました。</p>';
    return;
  }

  if (!events || events.length === 0) {
    listContainer.innerHTML = '<p style="text-align: center; color: #888; padding: 15px 0;">登録されているイベントはありません。</p>';
    return;
  }

  listContainer.innerHTML = events.map(ev => `
    <div style="padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="font-weight: bold; font-size: 0.95rem;">
          ${ev.is_new ? '<span style="background: #ff3b30; color: white; font-size: 0.65rem; padding: 2px 5px; border-radius: 4px; font-weight: bold; margin-right: 5px;">NEW</span>' : ''}
          ${ev.title}
        </div>
        <div style="font-size: 0.8rem; color: #666; margin-top: 4px;">
          🗓 ${ev.event_date}
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button type="button" onclick="editEvent('${ev.id}', '${escapeHtml(ev.title)}', '${ev.event_date}', ${ev.is_new})" style="padding: 6px 12px; background: #007aff; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">編集</button>
        <button type="button" onclick="deleteEvent('${ev.id}', '${escapeHtml(ev.title)}')" style="padding: 6px 12px; background: #ff3b30; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer;">削除</button>
      </div>
    </div>
  `).join('');
}

// エスケープ処理（文字列に引用符等が含まれる場合の対策）
function escapeHtml(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// イベントの新規保存・更新処理
async function handleSaveEvent(e) {
  e.preventDefault();

  const id = document.getElementById('eventId').value;
  const title = document.getElementById('eventTitle').value.trim();
  const event_date = document.getElementById('eventDate').value;
  const is_new = document.getElementById('isNew').checked;

  const payload = {
    title: title,
    event_date: event_date,
    is_new: is_new,
    updated_at: new Date().toISOString()
  };

  let error = null;

  if (id) {
    // 更新 (UPDATE)
    const res = await window.supabaseClient.from('events').update(payload).eq('id', id);
    error = res.error;
  } else {
    // 新規登録 (INSERT)
    const res = await window.supabaseClient.from('events').insert([payload]);
    error = res.error;
  }

  if (error) {
    alert('保存に失敗しました: ' + error.message);
  } else {
    alert(id ? 'イベントを更新しました！' : 'イベントを作成しました！');
    resetForm();
    loadEvents();
  }
}

// 編集モードヘ切り替え
function editEvent(id, title, event_date, is_new) {
  document.getElementById('eventId').value = id;
  document.getElementById('eventTitle').value = title;
  document.getElementById('eventDate').value = event_date;
  document.getElementById('isNew').checked = is_new;

  document.getElementById('formTitle').textContent = 'イベント編集';
  document.getElementById('saveBtn').textContent = '更新する';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// イベント削除
async function deleteEvent(id, title) {
  if (!confirm(`「${title}」を削除してもよろしいですか？`)) return;

  const { error } = await window.supabaseClient
    .from('events')
    .delete()
    .eq('id', id);

  if (error) {
    alert('削除に失敗しました: ' + error.message);
  } else {
    alert('イベントを削除しました。');
    loadEvents();
  }
}

// フォームリセット
function resetForm() {
  document.getElementById('eventId').value = '';
  document.getElementById('eventTitle').value = '';
  document.getElementById('eventDate').value = '';
  document.getElementById('isNew').checked = true;

  document.getElementById('formTitle').textContent = 'イベント作成';
  document.getElementById('saveBtn').textContent = '登録する';
  document.getElementById('cancelEditBtn').style.display = 'none';
}