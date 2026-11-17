document.addEventListener('DOMContentLoaded', async () => {
  if (!await App.initAdminPage()) return;

  loadTodayStats();
});

async function loadTodayStats() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 1. 本日のチェックイン件数取得
  const { count: checkinCount, error: checkinError } = await window.supabaseClient
    .from('checkins')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString());

  // 2. 本日の景品交換件数取得
  const { count: exchangeCount, error: exchangeError } = await window.supabaseClient
    .from('point_history')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', todayStart.toISOString())
    .or('category.eq.exchange,points.lt.0');

  if (checkinError || exchangeError) {
    document.getElementById('todayCheckins').textContent = '取得失敗';
    document.getElementById('todayExchanges').textContent = '取得失敗';
    return;
  }

  const checkinEl = document.getElementById('todayCheckins');
  const exchangeEl = document.getElementById('todayExchanges');

  if (checkinEl) checkinEl.innerHTML = `${checkinCount || 0} <span style="font-size: 0.8rem;">件</span>`;
  if (exchangeEl) exchangeEl.innerHTML = `${exchangeCount || 0} <span style="font-size: 0.8rem;">件</span>`;
}
