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
  let retryCount = 0;
  while (!window.supabaseClient && retryCount < 20) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retryCount++;
  }

  if (!window.supabaseClient) {
    alert('エラー: Supabaseが初期化されていません。');
    return;
  }

  // 1. フィルターの選択肢をセット
  await initFilterOptions();

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
  const { data: logs } = await window.supabaseClient
    .from('checkins')
    .select('booth_id');

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
  const { data: profiles } = await window.supabaseClient
    .from('profiles')
    .select('school_name, grade');

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
  const deptVal = document.getElementById('filterDepartment').value; // IS, PT 等のコード
  const schoolVal = document.getElementById('filterSchool').value;
  const gradeVal = document.getElementById('filterGrade').value;
  const sortVal = document.getElementById('sortDate').value;

  // 1. checkins テーブルから取得
  let query = window.supabaseClient
    .from('checkins')
    .select('*')
    .order('created_at', { ascending: sortVal === 'asc' });

  if (deptVal) query = query.eq('booth_id', deptVal);

  const { data: checkins, error: checkinError } = await query;

  const tbody = document.getElementById('checkinTableBody');
  const countEl = document.getElementById('recordCount');

  if (checkinError || !checkins) {
    console.error('checkins 取得エラー:', checkinError);
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red; padding: 20px;">データの読み込みに失敗しました。</td></tr>';
    return;
  }

  if (checkins.length === 0) {
    currentFilteredData = [];
    countEl.textContent = '0 件';
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 20px;">該当するデータはありません。</td></tr>';
    return;
  }

  // 2. 登場する user_id のプロフィールを一括取得
  const userIds = [...new Set(checkins.map(c => c.user_id).filter(Boolean))];
  let profileMap = {};

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await window.supabaseClient
      .from('profiles')
      .select('*')
      .in('id', userIds);

    if (!profileError && profiles) {
      profiles.forEach(p => {
        profileMap[String(p.id)] = p;
      });
    }
  }

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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #888; padding: 20px;">該当するデータはありません。</td></tr>';
    return;
  }

  // 5. 画面描画
  tbody.innerHTML = currentFilteredData.map(log => {
    const dt = new Date(log.created_at);
    const dateStr = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    const prof = log.profile || {};

    const rawName = prof.name || prof.user_name || prof.full_name;
    const deptName = BOOTH_NAMES[log.booth_id] || log.booth_id;

    const nameStr = rawName ? escapeHtml(rawName) : '<span style="color: #999;">未設定</span>';
    const schoolStr = prof.school_name ? escapeHtml(prof.school_name) : '<span style="color: #999;">未設定</span>';
    const gradeStr = (prof.grade !== null && prof.grade !== undefined && prof.grade !== '') ? `${prof.grade}年` : '<span style="color: #999;">未設定</span>';
    const deptStr = deptName ? escapeHtml(deptName) : '<span style="color: #999;">未設定</span>';

    return `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 10px; color: #555; white-space: nowrap;">${dateStr}</td>
        <td style="padding: 10px; font-weight: bold; color: #333; white-space: nowrap;">${nameStr}</td>
        <td style="padding: 10px; white-space: nowrap;">${schoolStr}</td>
        <td style="padding: 10px; white-space: nowrap;">${gradeStr}</td>
        <td style="padding: 10px; font-weight: bold; color: #007aff; white-space: nowrap;">${deptStr}</td>
        <td style="padding: 10px; text-align: center; white-space: nowrap; width: 110px;">
          <button type="button" onclick="openEditModal('${log.id}')" class="btn" style="background: #ff9500; color: white; padding: 4px 8px; font-size: 0.75rem; border-radius: 4px; margin-right: 2px;">編集</button>
          <button type="button" onclick="deleteLog('${log.id}')" class="btn" style="background: #ff3b30; color: white; padding: 4px 8px; font-size: 0.75rem; border-radius: 4px;">削除</button>
        </td>
      </tr>
    `;
  }).join('');
}

// 編集モーダルを開く
window.openEditModal = function(logId) {
  const targetLog = currentFilteredData.find(item => item.id === logId);
  if (!targetLog) return;

  document.getElementById('editLogId').value = targetLog.id;
  
  const dt = new Date(targetLog.created_at);
  dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
  const isoStr = dt.toISOString().slice(0, 16);

  document.getElementById('editCreatedAt').value = isoStr;
  document.getElementById('editTitle').value = targetLog.booth_id || '';

  const modal = document.getElementById('editModal');
  if (modal) modal.style.display = 'flex';
};

// 編集モーダルを閉じる
window.closeEditModal = function() {
  const modal = document.getElementById('editModal');
  if (modal) modal.style.display = 'none';
};

// 編集内容の保存
window.saveLogEdit = async function() {
  const logId = document.getElementById('editLogId').value;
  const createdAtVal = document.getElementById('editCreatedAt').value;
  const boothIdVal = document.getElementById('editTitle').value.trim();

  if (!createdAtVal) {
    alert('日時を正しく入力してください。');
    return;
  }

  const { error } = await window.supabaseClient
    .from('checkins')
    .update({
      created_at: new Date(createdAtVal).toISOString(),
      booth_id: boothIdVal || null
    })
    .eq('id', logId);

  if (error) {
    alert('更新に失敗しました: ' + error.message);
    return;
  }

  alert('チェックインログを更新しました！');
  closeEditModal();
  await loadCheckinLogs();
};

// ログ削除
window.deleteLog = async function(logId) {
  if (!confirm('このチェックイン履歴を削除してもよろしいですか？\n※削除したデータは復元できません。')) {
    return;
  }

  const { error } = await window.supabaseClient
    .from('checkins')
    .delete()
    .eq('id', logId);

  if (error) {
    alert('削除に失敗しました: ' + error.message);
    return;
  }

  alert('ログを削除しました。');
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
    alert('出力対象のデータがありません。');
    return;
  }

  const headers = ['日時', '氏名', '出身学校', '学年', '体験学科/ブース'];

  const rows = currentFilteredData.map(log => {
    const dt = new Date(log.created_at);
    const dateStr = `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    const prof = log.profile || {};
    const rawName = prof.name || prof.user_name || prof.full_name;
    const deptName = BOOTH_NAMES[log.booth_id] || log.booth_id || '未設定';

    return [
      `"${dateStr}"`,
      `"${(rawName || '未設定').replace(/"/g, '""')}"`,
      `"${(prof.school_name || '未設定').replace(/"/g, '""')}"`,
      `"${(prof.grade !== null && prof.grade !== undefined && prof.grade !== '') ? prof.grade + '年' : '未設定'}"`,
      `"${deptName.replace(/"/g, '""')}"`,
    ].join(',');
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
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}