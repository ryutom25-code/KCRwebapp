let checkinLoadGeneration = 0;
let editTrigger = null;
let currentFilteredData = []; // 現在画面に表示されている抽出データを保持

// 💡 booth_id (略称コード) と 表示名の対応表
const BOOTH_NAMES = {
  'IS': '情報システム学科',
  'PT': '理学療法学科',
  'OT': '作業療法学科',
  'Ns': '看護学科',
  'CW': '介護福祉学科'
  // ※ 実際に使っている識別コードを追加・変更してください
};

document.addEventListener('DOMContentLoaded', async () => {
  if (!await App.initAdminPage()) return;

  // 1. フィルターの選択肢をセット
  try { await initFilterOptions(); }
  catch (error) { App.notify('フィルターを取得できません: ' + error.message); }

  // 2. checkins からログデータの読み込み
  await loadCheckinLogs();

  // 3. フィルター変更時のイベント設定
  document.getElementById('filterDepartment').addEventListener('change', loadCheckinLogs);
  document.getElementById('filterSchool').addEventListener('change', loadCheckinLogs);
  document.getElementById('filterGrade').addEventListener('change', loadCheckinLogs);
  document.getElementById('sortDate').addEventListener('change', loadCheckinLogs);

  document.getElementById('resetFilterBtn').addEventListener('click', resetFilters);
  document.getElementById('exportCsvBtn').addEventListener('click', exportToCsv);
});

// データベースから実際に存在する booth_id・学校名・学年を抽出してプルダウンにセット
async function initFilterOptions() {
  // 1. checkins から booth_id を抽出してプルダウンを作成
  const { data: logs, error: logsError } = await App.fetchAllResult(() => window.supabaseClient
    .from('checkins')
    .select('booth_id').order('id'));

  if (logsError) throw logsError;
  if (logs) {
    const boothIds = [...new Set(logs.map(l => l.booth_id).filter(Boolean))];
    const deptSelect = document.getElementById('filterDepartment');
    deptSelect.innerHTML = '<option value="">すべての学科</option>';
    boothIds.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      // BOOTH_NAMES にあれば正式名称、なければコードそのまま(IS, PT等)を表示
      opt.textContent = BOOTH_NAMES[id] || id;
      deptSelect.appendChild(opt);
    });
  }

  // 2. profiles から出身学校名および学年を抽出
  const { data: profiles, error: profilesError } = await App.fetchAllResult(() => window.supabaseClient
    .from('profiles')
    .select('school_name, grade').order('id'));

  if (profilesError) throw profilesError;
  if (profiles) {
    // 学校名プルダウンの生成
    const schools = [...new Set(profiles.map(p => p.school_name).filter(Boolean))];
    const schoolSelect = document.getElementById('filterSchool');
    schoolSelect.innerHTML = '<option value="">すべての学校</option>';
    schools.forEach(sch => {
      const opt = document.createElement('option');
      opt.value = sch;
      opt.textContent = sch;
      schoolSelect.appendChild(opt);
    });

    // 💡 学年プルダウンの動的生成 (profiles に存在する学年を抽出してソート)
    const grades = [...new Set(profiles.map(p => p.grade).filter(g => g !== null && g !== undefined && g !== ''))]
      .sort((a, b) => a - b);

    const gradeSelect = document.getElementById('filterGrade');
    gradeSelect.innerHTML = '<option value="">すべての学年</option>';
    grades.forEach(grd => {
      const opt = document.createElement('option');
      opt.value = grd;
      opt.textContent = (typeof grd === 'number' || !isNaN(grd)) ? `${grd}年` : grd;
      gradeSelect.appendChild(opt);
    });
  }
}

// データの読み込み＆結合処理
async function loadCheckinLogs() {
  const generation = ++checkinLoadGeneration;
  const deptVal = document.getElementById('filterDepartment').value; // IS, PT 等のコード
  const schoolVal = document.getElementById('filterSchool').value;
  const gradeVal = document.getElementById('filterGrade').value;
  const sortVal = document.getElementById('sortDate').value;

  // 1. checkins テーブルから取得
  const makeQuery = () => {
    let query = window.supabaseClient
      .from('checkins')
      .select('*')
      .order('created_at', { ascending: sortVal === 'asc' }).order('id', { ascending: sortVal === 'asc' });

    if (deptVal) query = query.eq('booth_id', deptVal);

    return query;
  };
  currentFilteredData = [];
  const { data: checkins, error: checkinError } = await App.fetchAllResult(makeQuery);

  if (generation !== checkinLoadGeneration) return;
  const tbody = document.getElementById('checkinTableBody');
  const countEl = document.getElementById('recordCount');

  if (checkinError || !checkins) {
    countEl.textContent = '取得失敗';
    console.error('checkins 取得エラー:', checkinError);
    tbody.innerHTML = '<tr><td colspan="6">データの読み込みに失敗しました。</td></tr>';
    return;
  }

  if (checkins.length === 0) {
    currentFilteredData = [];
    countEl.textContent = '0 件';
    tbody.innerHTML = '<tr><td colspan="6">該当するデータはありません。</td></tr>';
    return;
  }

  // Fetch every profile page; avoid a large IN URL and capped joins.
  const { data: profiles, error: profileError } = await App.fetchAllResult(() =>
    window.supabaseClient.from('profiles').select('*').order('id'));
  if (generation !== checkinLoadGeneration) return;
  if (profileError) {
    countEl.textContent = '取得失敗';
    tbody.textContent = 'プロフィールの読み込みに失敗しました。';
    return;
  }
  const profileMap = Object.fromEntries(profiles.map(profile => [String(profile.id), profile]));

  // 3. checkins と profiles をマージ
  let mergedLogs = checkins.map(c => ({
    ...c,
    profile: profileMap[String(c.user_id)] || {}
  }));

  // 4. クライアント側で学校名・学年フィルターを適用
  if (schoolVal) {
    mergedLogs = mergedLogs.filter(item => item.profile?.school_name === schoolVal);
  }
  if (gradeVal) {
    // 💡 数値・文字列の不一致を防ぐため String() で型合わせして判定
    mergedLogs = mergedLogs.filter(item => String(item.profile?.grade) === String(gradeVal));
  }

  currentFilteredData = mergedLogs;
  countEl.textContent = `${currentFilteredData.length} 件`;

  if (currentFilteredData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">該当するデータはありません。</td></tr>';
    return;
  }

  // 5. 画面描画
  tbody.innerHTML = currentFilteredData.map(log => {
    const dt = new Date(log.created_at);
    const dateStr = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    const prof = log.profile || {};

    const rawName = prof.name || prof.user_name || prof.full_name;
    const deptName = BOOTH_NAMES[log.booth_id] || log.booth_id;

    const nameStr = rawName ? App.escapeHtml(rawName) : '<span>未設定</span>';
    const schoolStr = prof.school_name ? App.escapeHtml(prof.school_name) : '<span>未設定</span>';
    const gradeStr = (prof.grade !== null && prof.grade !== undefined && prof.grade !== '') ? `${App.escapeHtml(prof.grade)}${/^[0-9]+$/.test(String(prof.grade)) ? '年' : ''}` : '<span>未設定</span>';
    const deptStr = deptName ? App.escapeHtml(deptName) : '<span>未設定</span>';

    return `
      <tr>
        <td>${dateStr}</td>
        <td>${nameStr}</td>
        <td>${schoolStr}</td>
        <td>${gradeStr}</td>
        <td>${deptStr}</td>
        <td>
          <button type="button" onclick="openEditModal('${log.id}')" class="btn">編集</button>
          <button type="button" onclick="deleteLog('${log.id}')" class="btn">削除</button>
        </td>
      </tr>
    `;
  }).join('');
}

// 編集モーダルを開く
window.openEditModal = function(logId) {
  const targetLog = currentFilteredData.find(item => String(item.id) === String(logId));
  if (!targetLog) return;

  editTrigger = document.activeElement;
  document.getElementById('editLogId').value = targetLog.id;
  
  const dt = new Date(targetLog.created_at);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  const isoStr = dt.toISOString().slice(0, 16);

  document.getElementById('editCreatedAt').value = isoStr;
  document.getElementById('editTitle').value = targetLog.booth_id || '';

  const modal = document.getElementById('editModal');
  if (modal) { modal.style.display = 'flex'; document.getElementById('editCreatedAt').focus(); }
};

// 編集モーダルを閉じる
window.closeEditModal = function() {
  const modal = document.getElementById('editModal');
  if (modal) modal.style.display = 'none';
  editTrigger?.focus?.();
};

// 編集内容の保存
window.saveLogEdit = async function() {
  const logId = document.getElementById('editLogId').value;
  const createdAtVal = document.getElementById('editCreatedAt').value;
  const boothIdVal = document.getElementById('editTitle').value.trim();

  if (!createdAtVal) {
    App.notify('日時を正しく入力してください。');
    return;
  }

  const error = await App.confirmRowChanged(window.supabaseClient
    .from('checkins')
    .update({
      created_at: new Date(createdAtVal).toISOString(),
      booth_id: boothIdVal || null
    })
    .eq('id', logId));

  if (error) {
    App.notify('更新に失敗しました: ' + error.message);
    return;
  }

  App.notify('チェックインログを更新しました！');
  closeEditModal();
  await loadCheckinLogs();
};

// ログ削除
window.deleteLog = async function(logId) {
  if (!await App.confirm('このチェックイン履歴を削除してもよろしいですか？\n※削除したデータは復元できません。')) {
    return;
  }

  const error = await App.confirmRowChanged(window.supabaseClient
    .from('checkins')
    .delete()
    .eq('id', logId));

  if (error) {
    App.notify('削除に失敗しました: ' + error.message);
    return;
  }

  App.notify('ログを削除しました。');
  await loadCheckinLogs();
};

// フィルター初期化
async function resetFilters() {
  document.getElementById('filterDepartment').value = '';
  document.getElementById('filterSchool').value = '';
  document.getElementById('filterGrade').value = '';
  document.getElementById('sortDate').value = 'desc';
  await loadCheckinLogs();
}

// CSV出力
function exportToCsv() {
  if (!currentFilteredData || currentFilteredData.length === 0) {
    App.notify('出力対象のデータがありません。');
    return;
  }

  const headers = ['日時', '氏名', '出身学校', '学年', '体験学科/ブース'];

  const rows = currentFilteredData.map(log => {
    const dt = new Date(log.created_at);
    const dateStr = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    const prof = log.profile || {};
    const rawName = prof.name || prof.user_name || prof.full_name;
    const deptName = BOOTH_NAMES[log.booth_id] || log.booth_id || '未設定';

    return [dateStr, rawName || '未設定', prof.school_name || '未設定',
      (prof.grade !== null && prof.grade !== undefined && prof.grade !== '') ? prof.grade + '年' : '未設定',
      deptName].map(App.csvCell).join(',');
  });

  const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  const todayStr = new Date().toISOString().split('T')[0];
  link.setAttribute('href', url);
  link.setAttribute('download', `checkin_logs_${todayStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
