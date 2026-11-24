document.addEventListener('DOMContentLoaded', async () => {
  if (!await App.initAdminPage()) return;

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

  listContainer.innerHTML = events.map((ev, index) => `<article class="admin-list-item"><div class="item-description"><h3>${ev.is_new ? '<span class="badge">NEW</span>' : ''}${App.escapeHtml(ev.title)}</h3><p>${App.escapeHtml(ev.event_date)}</p></div><div class="item-actions"><a class="btn-edit" href="qr.html?eventId=${encodeURIComponent(ev.id)}">QRを発行</a><button type="button" class="btn-edit" data-edit-index="${index}">編集</button><button type="button" class="btn-delete" data-delete-index="${index}">削除</button></div></article>`).join('');
  listContainer.querySelectorAll('[data-edit-index]').forEach(button => button.addEventListener('click', () => {
    const ev = events[Number(button.dataset.editIndex)];
    editEvent(ev.id, ev.title, ev.event_date, ev.is_new);
  }));
  listContainer.querySelectorAll('[data-delete-index]').forEach(button => button.addEventListener('click', () => {
    const ev = events[Number(button.dataset.deleteIndex)];
    deleteEvent(ev.id, ev.title);
  }));
}

// イベントの新規保存・更新処理
async function handleSaveEvent(e) {
  e.preventDefault();

  const saveButton = document.getElementById('saveBtn');
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  try {
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
    error = await App.confirmRowChanged(window.supabaseClient.from('events').update(payload).eq('id', id));
  } else {
    // 新規登録 (INSERT)
    const res = await window.supabaseClient.from('events').insert([payload]);
    error = res.error;
  }

  if (error) {
    App.notify('保存に失敗しました: ' + error.message);
  } else {
    App.notify(id ? 'イベントを更新しました！' : 'イベントを作成しました！');
    resetForm();
    loadEvents();
  }
  } finally { saveButton.disabled = false; }
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
  if (!await App.confirm(`「${title}」を削除してもよろしいですか？`)) return;

  const error = await App.confirmRowChanged(window.supabaseClient
    .from('events')
    .delete()
    .eq('id', id));

  if (error) {
    App.notify('削除に失敗しました: ' + error.message);
  } else {
    App.notify('イベントを削除しました。');
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
