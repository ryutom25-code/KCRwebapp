// Shared rendering and data helpers. Database permissions are enforced by RLS.
const App = {
  notify(message) {
    if (typeof UI !== 'undefined') UI.notify(message);
    else window.alert(message);
  },
  async confirm(message) {
    return typeof UI !== 'undefined' ? UI.confirm(message) : window.confirm(message);
  },
  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  },
  safeImageUrl(value) {
    try {
      const url = new URL(value, document.baseURI);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  },
  csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  },
  // Keep fetching until an empty page, even if the API caps pages below 500 rows.
  async fetchAll(makeQuery) {
    const rows = [];
    for (;;) {
      const { data, error } = await makeQuery().range(rows.length, rows.length + 499);
      if (error) throw error;
      if (!data) throw new Error('データを取得できませんでした。');
      if (!data.length) return rows;
      rows.push(...data);
    }
  },
  async fetchAllResult(makeQuery) {
    try { return { data: await App.fetchAll(makeQuery), error: null }; }
    catch (error) { return { data: null, error }; }
  },
  pendingRequests: new Map(),
  hasPendingRequest(key) {
    if (App.pendingRequests.has(key)) return true;
    try { return Boolean(window.sessionStorage?.getItem('kcr-request:' + key)); }
    catch { return false; }
  },
  pendingRequest(key) {
    const storageKey = 'kcr-request:' + key;
    let id = App.pendingRequests.get(key);
    try { id = window.sessionStorage?.getItem(storageKey) || id; } catch {}
    id = id || crypto.randomUUID();
    App.pendingRequests.set(key, id);
    try { window.sessionStorage?.setItem(storageKey, id); } catch {}
    return id;
  },
  completeRequest(key) {
    App.pendingRequests.delete(key);
    try { window.sessionStorage?.removeItem('kcr-request:' + key); } catch {}
  },
  async rpc(name, args = {}) {
    const { data, error } = await window.supabaseClient.rpc(name, args);
    if (error) throw new Error(error.message || '処理に失敗しました。');
    return data;
  },
  async initAdminPage() {
    try {
      await supabaseInitPromise;
      if (!window.supabaseClient) throw new Error('Supabaseを初期化できませんでした。');
      return true;
    } catch (error) {
      document.body.textContent = '管理画面を開けません: ' + error.message;
      return false;
    }
  }
};
