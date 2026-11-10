document.addEventListener('DOMContentLoaded', async () => {
  let retryCount = 0;
  while (!window.supabaseClient && retryCount < 20) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retryCount++;
  }

  if (!window.supabaseClient) return;

  loadTodayStats();
});

async function loadTodayStats() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 1. 本日のチェックイン件数取得
  const { count: checkinCount } = await window.supabaseClient
    .from('point_history')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString())
    .neq('category', 'exchange')
    .gt('points', 0);

  // 2. 本日の景品交換件数取得
  const { count: exchangeCount } = await window.supabaseClient
    .from('point_history')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString())
    .or('category.eq.exchange,points.lt.0');

  const checkinEl = document.getElementById('todayCheckins');
  const exchangeEl = document.getElementById('todayExchanges');

  if (checkinEl) checkinEl.innerHTML = `${checkinCount || 0} <span style="font-size: 0.8rem;">件</span>`;
  if (exchangeEl) exchangeEl.innerHTML = `${exchangeCount || 0} <span style="font-size: 0.8rem;">件</span>`;
}