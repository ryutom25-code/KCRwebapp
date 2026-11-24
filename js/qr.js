document.addEventListener('DOMContentLoaded', async () => {
  const statusMsg = document.getElementById('statusMessage');

  const user = await authReady;
  if (!user) return;

  const camera = createQrCamera('reader', 250);
  let isProcessing = false;

  // スキャン成功時のイベントハンドラー
  async function onScanSuccess(decodedText) {
    if (isProcessing) return;
    isProcessing = true;

    if (statusMsg) {
      statusMsg.style.color = '#007aff';
      statusMsg.textContent = '処理中...';
    }

    try {
      const result = await handleScanSuccess(user, decodedText);
      if (statusMsg) {
        if (result.cooldown) {
          const next = new Date(result.nextAllowedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          statusMsg.style.color = '#687790';
          statusMsg.textContent = `${result.departmentName}はチェックイン済みです。次は ${next} からポイントを獲得できます。`;
        } else {
          statusMsg.style.color = 'green';
          statusMsg.textContent = `🎉 ${result.historyTitle} 獲得！ (+${result.earnedPoints}pt / 現在: ${result.newPoints}pt)`;
        }
      }
    } catch (err) {
      if (statusMsg) {
        statusMsg.style.color = 'red';
        statusMsg.textContent = err.message || 'エラーが発生しました。';
      }
    } finally {
      // 3秒後に連打防止フラグを解除（連続スキャン制御）
      setTimeout(() => { isProcessing = false; }, 3000);
    }
  }

  async function startCamera() {
    statusMsg.style.color = '';
    statusMsg.textContent = 'カメラを起動しています…';
    try {
      if (await camera.start(onScanSuccess) && !isProcessing) {
        statusMsg.textContent = 'QRコードを読み取れます。';
      }
    } catch (error) {
      statusMsg.textContent = cameraErrorMessage(error);
    }
  }

  window.addEventListener('pagehide', () => camera.stop());
  window.addEventListener('pageshow', event => {
    if (event.persisted) startCamera();
  });
  await startCamera();
});

// Cache a known cooldown while the camera stays on the same code. The DB is authoritative.
const scanCooldowns = new Map();
async function handleScanSuccess(user, decodedText) {
  const rawText = decodedText.trim();
  if (rawText === 'EXCHANGE_BOOTH') {
    throw new Error('これは景品交換用QRコードです。景品交換画面からスキャンしてください。');
  }
  const key = user.id + ':' + rawText.replace(/^welcome:/, '');
  const cached = scanCooldowns.get(key);
  if (cached && new Date(cached.nextAllowedAt).getTime() > Date.now()) return cached;
  scanCooldowns.delete(key);
  const result = await App.rpc('record_checkin', { p_code: rawText, p_request_id: crypto.randomUUID() });
  if (result.nextAllowedAt) scanCooldowns.set(key, { ...result, cooldown: true, earnedPoints: 0 });
  return result;
}
