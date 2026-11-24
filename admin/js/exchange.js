document.addEventListener('DOMContentLoaded', async () => {
  if (!await App.initAdminPage()) return;

  // 初期読み込み
  loadExchangeLogs();

  // ソート順変更イベント
  const sortSelect = document.getElementById('sortDate');
  if (sortSelect) {
    sortSelect.addEventListener('change', loadExchangeLogs);
  }

  document.getElementById('exchangeSearch')?.addEventListener('input', renderExchangeLogs);

  // CSV出力イベント
  const csvBtn = document.getElementById('exportCsvBtn');
  if (csvBtn) {
    csvBtn.addEventListener('click', exportToCsv);
  }
});

let exchangeLoadGeneration = 0;
let allExchangeLogs = [];
let currentLogs = []; // CSV出力用に取得データを保持

// 1. 交換ログデータの取得とテーブル描画
async function loadExchangeLogs() {
  const generation = ++exchangeLoadGeneration;
  const tbody = document.getElementById('exchangeTableBody');
  const countEl = document.getElementById('recordCount');
  const sortOrder = document.getElementById('sortDate')?.value || 'desc';

  currentLogs = [];
  allExchangeLogs = [];
  if (countEl) countEl.textContent = '取得中';
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6">読み込み中...</td></tr>';
  }

  const ranking = document.getElementById('exchangeRanking');
  if (ranking) ranking.textContent = '読み込み中...';

  const { data: logs, error } = await App.fetchAllResult(() => window.supabaseClient
    .from('staff_exchange_logs')
    .select('id, created_at, product_name, points, user_name, school_name, grade')
    .order('created_at', { ascending: sortOrder === 'asc' }).order('id', { ascending: sortOrder === 'asc' }));

  if (generation !== exchangeLoadGeneration) return;
  if (error) {
    if (countEl) countEl.textContent = '取得失敗';
    if (ranking) ranking.textContent = 'ランキングを取得できませんでした。';
    console.error('データ取得エラー:', error);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6">エラーが発生しました: ${App.escapeHtml(error.message)}</td></tr>`;
    }
    return;
  }

  allExchangeLogs = logs;
  renderExchangeRanking(logs);
  const total = document.getElementById('exchangeTotal');
  const points = document.getElementById('exchangePointsTotal');
  if (total) total.textContent = logs.length.toLocaleString() + ' 件';
  if (points) points.textContent = logs.reduce((sum, log) => sum + Math.abs(Number(log.points) || 0), 0).toLocaleString() + ' PT';
  renderExchangeLogs();
}

function renderExchangeLogs() {
  const tbody = document.getElementById('exchangeTableBody');
  const countEl = document.getElementById('recordCount');
  const search = (document.getElementById('exchangeSearch')?.value || '').trim().toLocaleLowerCase();
  currentLogs = allExchangeLogs.filter(log => !search ||
    [log.user_name, log.school_name, log.grade, exchangeProductName(log)]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(search)));

  if (countEl) {
    countEl.textContent = `${currentLogs.length} 件`;
  }

  if (!currentLogs || currentLogs.length === 0) {
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6">交換履歴はありません。</td></tr>';
    }
    return;
  }

  // テーブル要素の生成
  if (tbody) {
    tbody.innerHTML = currentLogs.map(log => {
      const productName = exchangeProductName(log);
      const pointsUsed = Math.abs(log.points || 0);

      return `
        <tr>
          <td>${formatExchangeDate(log.created_at)}</td>
          <td>${App.escapeHtml(log.user_name || '—')}</td>
          <td>${App.escapeHtml(log.school_name || '—')}</td>
          <td>${App.escapeHtml(log.grade ?? '—')}</td>
          <td>${App.escapeHtml(productName)}</td>
          <td class="point-amount negative">-${pointsUsed} PT</td>
        </tr>
      `;
    }).join('');
  }
}

function formatExchangeDate(createdAt) {
  const date = new Date(createdAt);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}/${month}/${day} ${hours}:${minutes}`;
}

// Aggregate by the saved product name, stripping the historical display prefix.
function exchangeProductName(log) {
  return String(log.product_name || '').replace(/^景品交換[:：]\s*/, '').trim() || '不明な景品';
}

function buildExchangeRanking(logs) {
  const totals = new Map();
  for (const log of logs) {
    const name = exchangeProductName(log);
    totals.set(name, (totals.get(name) || 0) + 1);
  }
  const rows = Array.from(totals, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
  let rank = 0;
  return rows.map((row, index) => {
    if (!index || row.count !== rows[index - 1].count) rank = index + 1;
    return { ...row, rank };
  });
}

function renderExchangeRanking(logs) {
  const container = document.getElementById('exchangeRanking');
  if (!container) return;
  const rows = buildExchangeRanking(logs);
  if (!rows.length) { container.textContent = '交換履歴はありません。'; return; }
  container.innerHTML = `<table class="ranking-table">
    <thead><tr><th scope="col">順位</th><th scope="col">景品</th><th scope="col">交換件数</th></tr></thead>
    <tbody>${rows.map(row => `<tr>
      <td><span class="rank-medal rank-${row.rank}">${row.rank}</span></td>
      <td>${App.escapeHtml(row.name)}</td>
      <td><span class="rank-count">${row.count} 件</span><span class="rank-bar" style="--share:${Math.round(row.count / rows[0].count * 100)}%"></span></td>
    </tr>`).join('')}</tbody></table>`;
}

// 2. CSVダウンロード機能
function exportToCsv() {
  if (!currentLogs || currentLogs.length === 0) {
    App.notify('出力対象のデータがありません。');
    return;
  }

  // BOM（文字化け防止）
  let csvContent = '\uFEFF';
  csvContent += '日時,氏名,学校名,学年,交換景品,消費PT\r\n';

  currentLogs.forEach(log => {
    const cells = [formatExchangeDate(log.created_at), log.user_name, log.school_name, log.grade, exchangeProductName(log)];
    csvContent += cells.map(App.csvCell).join(',') + `,-${Math.abs(log.points || 0)}\r\n`;
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
