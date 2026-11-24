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
  async function generateQR(qrDataStr, label) {
    try {
      if (qrDataStr !== 'EXCHANGE_BOOTH') {
        const event = qrDataStr.startsWith('event:');
        const target = qrDataStr.replace(/^welcome:/, '');
        const names = { PT: '理学療法学科', OT: '作業療法学科', Ns: '看護学科', CW: '介護福祉学科', IS: '情報システム学科' };
        if (!event && !names[target]) throw new Error('有効な学科コードまたはイベント名を指定してください。');
        const { error } = await window.supabaseClient.from('qr_codes').upsert({
          code: qrDataStr, category: event ? 'event' : 'welcome',
          department_name: event ? qrDataStr.slice(6) : names[target],
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
  customQrBtn.addEventListener('click', () => {
    const val = boothInput.value.trim();
    if (!val) {
      App.notify('QRコード化する文字列を入力してください');
      return;
    }
    // "welcome:" や "event:" が含まれていなければ自動補完する（またはそのまま設定）
    const qrData = val.startsWith('event:') ? val : `event:${val}`;
    generateQR(qrData, `イベント/カスタムQR (${val})`);
  });

  // 印刷ボタン
  printBtn.addEventListener('click', () => {
    window.print();
  });
});
