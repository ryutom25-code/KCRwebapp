document.addEventListener('DOMContentLoaded', async () => {
  if (!await App.initAdminPage()) return;
  const resultCard = document.getElementById('resultCard');
  const boothLabel = document.getElementById('boothLabel');
  const boothIdText = document.getElementById('boothIdText');
  const qrContainer = document.getElementById('qrcode');
  const boothInput = document.getElementById('boothInput');
  const customQrBtn = document.getElementById('customQrBtn');
  const printBtn = document.getElementById('printBtn');

  // QRコード生成処理
  async function generateQR(qrDataStr, label, eventName) {
    try {
      if (qrDataStr !== 'EXCHANGE_BOOTH') {
        const event = qrDataStr.startsWith('event:');
        const target = qrDataStr.replace(/^welcome:/, '');
        const names = { PT: '理学療法学科', OT: '作業療法学科', Ns: '看護学科', CW: '介護福祉学科', IS: '情報システム学科' };
        if (!event && !names[target]) throw new Error('有効な学科コードまたはイベント名を指定してください。');
        const { error } = await window.supabaseClient.from('qr_codes').upsert({
          code: qrDataStr, category: event ? 'event' : 'welcome',
          department_name: event ? eventName : names[target],
          points: 50, active: true
        }, { onConflict: 'code' });
        if (error) throw error;
      }
    } catch (error) {
      App.notify('QRコードを登録できません: ' + error.message);
      return;
    }
    resultCard.style.display = 'block';
    boothLabel.textContent = label;
    boothIdText.textContent = 'データ: ' + qrDataStr;

    qrContainer.innerHTML = ''; // クリア

    new QRCode(qrContainer, {
      text: qrDataStr,
      width: 220,
      height: 220,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  // 学科プリセットボタンのイベント設定
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qrData = btn.getAttribute('data-qr');
      const label = btn.getAttribute('data-label');
      generateQR(qrData, label);
    });
  });

  // 任意入力（イベント名など）作成ボタン
  customQrBtn.addEventListener('click', async () => {
    const name = boothInput.value.trim().replace(/^event:/, '').trim();
    if (!name) {
      App.notify('イベント名を入力してください。');
      return;
    }

    customQrBtn.disabled = true;
    try {
      const code = await customEventCode(name);
      await generateQR(code, `イベントQR（${name}）`, name);
    } catch (error) {
      App.notify('QRコードを作成できません: ' + error.message);
    } finally {
      customQrBtn.disabled = false;
    }
  });

  // 印刷ボタン
  printBtn.addEventListener('click', () => {
    window.print();
  });

  const eventId = new URLSearchParams(location.search).get('eventId');
  if (eventId) {
    const { data: event, error } = await window.supabaseClient
      .from('events').select('id,title').eq('id', eventId).maybeSingle();
    if (error || !event) {
      App.notify('イベントを取得できません。イベント管理から開き直してください。');
      return;
    }
    await generateQR('event:event-id:' + event.id, event.title, event.title);
  }
});

async function customEventCode(name) {
  // Retain compatible ASCII codes and keep other QR payloads ASCII and fixed-length.
  if (/^[ -~]{1,194}$/.test(name) && !/^(event-id|text):/.test(name)) return 'event:' + name;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return 'event:text:' + id;
}
