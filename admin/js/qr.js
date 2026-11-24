document.addEventListener('DOMContentLoaded', async () => {
  if (!await App.initAdminPage()) return;
  const resultCard = document.getElementById('resultCard');
  const boothLabel = document.getElementById('boothLabel');
  const qrDescription = document.getElementById('qrDescription');
  const qrContainer = document.getElementById('qrcode');
  const boothInput = document.getElementById('boothInput');
  const customQrBtn = document.getElementById('customQrBtn');
  const printBtn = document.getElementById('printBtn');

  let issuance = 0;

  async function generateQR(getDetails) {
    const request = ++issuance;
    resultCard.style.display = 'none';
    boothLabel.textContent = '';
    qrDescription.textContent = '';
    qrContainer.replaceChildren();

    try {
      const { code: qrDataStr, label, eventName } = await getDetails();
      if (request !== issuance) return;
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
      if (request !== issuance) return;

      new QRCode(qrContainer, {
        text: qrDataStr,
        width: 220,
        height: 220,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
      boothLabel.textContent = label;
      qrDescription.textContent = qrDataStr === 'EXCHANGE_BOOTH' ? '景品交換の確認用'
        : qrDataStr.startsWith('event:') ? 'イベント参加で50ポイント'
        : 'チェックインで50ポイント';
      resultCard.style.display = 'block';
    } catch (error) {
      if (request !== issuance) return;
      qrContainer.replaceChildren();
      App.notify('QRコードを発行できません: ' + error.message);
    }
  }

  // 学科プリセットボタンのイベント設定
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const qrData = btn.getAttribute('data-qr');
      const label = btn.getAttribute('data-label');
      generateQR(() => ({ code: qrData, label }));
    });
  });

  // 任意入力（イベント名など）作成ボタン
  customQrBtn.addEventListener('click', async () => {
    const name = boothInput.value.trim().replace(/^event:/, '').trim();
    customQrBtn.disabled = true;
    try {
      await generateQR(async () => {
        if (!name) throw new Error('イベント名を入力してください。');
        return { code: await customEventCode(name), label: `イベントQR（${name}）`, eventName: name };
      });
    } finally {
      customQrBtn.disabled = false;
    }
  });

  // 印刷ボタン
  printBtn.addEventListener('click', () => {
    if (resultCard.style.display === 'block') window.print();
  });

  const eventId = new URLSearchParams(location.search).get('eventId');
  if (eventId) {
    await generateQR(async () => {
      const { data: event, error } = await window.supabaseClient
        .from('events').select('id,title').eq('id', eventId).maybeSingle();
      if (error || !event) throw new Error('イベントを取得できません。イベント管理から開き直してください。');
      return { code: 'event:event-id:' + event.id, label: event.title, eventName: event.title };
    });
  }
});

async function customEventCode(name) {
  // Retain compatible ASCII codes and keep other QR payloads ASCII and fixed-length.
  if (/^[ -~]{1,194}$/.test(name) && !/^(event-id|text):/.test(name)) return 'event:' + name;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return 'event:text:' + id;
}
