document.addEventListener('DOMContentLoaded', () => {
  const resultCard = document.getElementById('resultCard');
  const boothLabel = document.getElementById('boothLabel');
  const boothIdText = document.getElementById('boothIdText');
  const qrContainer = document.getElementById('qrcode');
  const boothInput = document.getElementById('boothInput');
  const customQrBtn = document.getElementById('customQrBtn');
  const printBtn = document.getElementById('printBtn');

  // QRコード生成処理
  function generateQR(qrDataStr, label) {
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
      alert('QRコード化する文字列を入力してください');
      return;
    }
    // "welcome:" や "event:" が含まれていなければ自動補完する（またはそのまま設定）
    const qrData = val.includes(':') ? val : `${val}`;
    generateQR(qrData, `イベント/カスタムQR (${val})`);
  });

  // 印刷ボタン
  printBtn.addEventListener('click', () => {
    window.print();
  });
});