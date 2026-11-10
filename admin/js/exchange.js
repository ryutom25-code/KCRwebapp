document.addEventListener('DOMContentLoaded', async () => {
  await supabaseInitPromise;

  // 初期読み込み
  loadExchangeLogs();

  // ソート順変更イベント
  const sortSelect = document.getElementById('sortDate');
  if (sortSelect) {
    sortSelect.addEventListener('change', loadExchangeLogs);
  }

  // CSV出力イベント
  const csvBtn = document.getElementById('exportCsvBtn');
  if (csvBtn) {
    csvBtn.addEventListener('click', exportToCsv);
  }
});

let currentLogs = []; // CSV出力用に取得データを保持

// 1. 交換ログデータの取得とテーブル描画
async function loadExchangeLogs() {
  const tbody = document.getElementById('exchangeTableBody');
  const countEl = document.getElementById('recordCount');
  const sortOrder = document.getElementById('sortDate')?.value || 'desc';

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #888;">読み込み中...</td></tr>';
  }

  // point_history テーブルから category = 'exchange' を取得し、profiles テーブルを結合
  const { data: logs, error } = await window.supabaseClient
    .from('point_history')
    .select(`
      created_at,
      title,
      points,
      profiles ( name, school_name )
    `)
    .eq('category', 'exchange')
    .order('created_at', { ascending: sortOrder === 'asc' });

  if (error) {
    console.error('データ取得エラー:', error);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ff3b30; padding: 20px;">エラーが発生しました: ${escapeHtml(error.message)}</td></tr>`;
    }
    return;
  }

  currentLogs = logs || [];

  if (countEl) {
    countEl.textContent = `${currentLogs.length} 件`;
  }

  if (!currentLogs || currentLogs.length === 0) {
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: #888;">交換履歴はありません。</td></tr>';
    }
    return;
  }

  // テーブル要素の生成
  if (tbody) {
    tbody.innerHTML = currentLogs.map(log => {
      const date = new Date(log.created_at);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const dateStr = `${date.getFullYear()}/${month}/${day} ${hours}:${minutes}`;

      const userName = log.profiles?.name || '名称未設定';
      const schoolName = log.profiles?.school_name || '未設定';
      const productName = log.title ? log.title.replace(/^景品交換:\s*/, '') : '不明な景品';
      const pointsUsed = Math.abs(log.points || 0);

      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px; color: #555;">${dateStr}</td>
          <td style="padding: 10px; font-weight: bold; color: #333;">${escapeHtml(userName)}</td>
          <td style="padding: 10px; color: #666;">${escapeHtml(schoolName)}</td>
          <td style="padding: 10px; font-weight: bold; color: #007aff;">${escapeHtml(productName)}</td>
          <td style="padding: 10px; color: #ff3b30; font-weight: bold;">-${pointsUsed} PT</td>
        </tr>
      `;
    }).join('');
  }
}

// 2. CSVダウンロード機能
function exportToCsv() {
  if (!currentLogs || currentLogs.length === 0) {
    alert('出力対象のデータがありません。');
    return;
  }

  // BOM（文字化け防止）
  let csvContent = '\uFEFF';
  csvContent += '日時,氏名,出身学校,交換景品,消費PT\n';

  currentLogs.forEach(log => {
    const date = new Date(log.created_at);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const dateStr = `${date.getFullYear()}/${month}/${day} ${hours}:${minutes}`;

    const userName = (log.profiles?.name || '名称未設定').replace(/"/g, '""');
    const schoolName = (log.profiles?.school_name || '未設定').replace(/"/g, '""');
    const productName = (log.title ? log.title.replace(/^景品交換:\s*/, '') : '不明な景品').replace(/"/g, '""');
    const pointsUsed = Math.abs(log.points || 0);

    csvContent += `"${dateStr}","${userName}","${schoolName}","${productName}",-${pointsUsed}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `exchange_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// エスケープ処理
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}