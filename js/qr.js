// 各種ポイント設定
const POINT_RULES = {
  welcome: 50,  // 各学科への来校ポイント
  event: 30     // 全体イベント参加ポイント
};

const DEPARTMENT_NAMES = {
  'PT': '理学療法学科',
  'OT': '作業療法学科',
  'Ns': '看護学科',
  'CW': '介護福祉学科',
  'IS': '情報システム学科',
  'main': '全体イベント'
};

document.addEventListener('DOMContentLoaded', async () => {
  const statusMsg = document.getElementById('statusMessage');

  // window.supabaseClient が準備されるまで最大2秒間待つ（初期化エラー防止）
  let retryCount = 0;
  while (!window.supabaseClient && retryCount < 20) {
    await new Promise(resolve => setTimeout(resolve, 100));
    retryCount++;
  }

  // Supabaseクライアントのチェック
  if (!window.supabaseClient) {
    if (statusMsg) {
      statusMsg.style.color = 'red';
      statusMsg.textContent = 'エラー: Supabaseが初期化されていません。(js/env.jsを確認してください)';
    }
    return;
  }

  // ログインユーザーの確認
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    if (statusMsg) {
      statusMsg.style.color = 'red';
      statusMsg.textContent = 'ログイン状態が確認できませんでした。';
    }
    return;
  }

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
        statusMsg.style.color = 'green';
        statusMsg.textContent = `🎉 ${result.historyTitle} 獲得！ (+${result.earnedPoints}pt / 現在: ${result.newPoints}pt)`;
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

  // 📷 カメラの起動ロジック
  const html5QrcodeScanner = new Html5QrcodeScanner(
    "reader",
    { fps: 10, qrbox: { width: 250, height: 250 } },
    /* verbose= */ false
  );
  html5QrcodeScanner.render(onScanSuccess, () => {});
});

// --- スキャン成功時のポイント加算・DB書き込み処理 ---
async function handleScanSuccess(user, decodedText) {
  const rawText = decodedText.trim();

  // 💡 景品交換用QR（EXCHANGE_BOOTH）を間違えて読んだ場合の弾き処理
  if (rawText === 'EXCHANGE_BOOTH') {
    throw new Error('❌ これは景品交換用QRコードです。景品交換画面からスキャンしてください。');
  }

  let category = 'welcome';
  let targetId = rawText;

  // "welcome:PT" や "event:main" などの指定がある場合
  if (rawText.includes(':')) {
    const parts = rawText.split(':');
    category = parts[0];
    targetId = parts[1];
  }

  const earnedPoints = POINT_RULES[category] || 10;
  const deptName = DEPARTMENT_NAMES[targetId] || targetId;
  
  // 履歴に表示するタイトル（例: "理学療法学科 来校ポイント"）
  const historyTitle = (category === 'event') 
    ? `イベント参加 (${deptName})` 
    : `${deptName} 来校ポイント`;

  // 💡 【重複チェックを削除しました】
  // 同じQRコードでも何回でもスキャン・ポイント加算が可能です。

  // 1. checkins に記録（何回目の訪問ログとしても残す）
  await window.supabaseClient.from('checkins').insert({ 
    user_id: user.id, 
    booth_id: rawText 
  });

  // 2. profiles の合計ポイント加算
  const { data: profile } = await window.supabaseClient.from('profiles').select('points').eq('id', user.id).single();
  const newPoints = (profile?.points || 0) + earnedPoints;
  await window.supabaseClient.from('profiles').update({ points: newPoints }).eq('id', user.id);

  // 3. point_history に履歴追加
  await window.supabaseClient.from('point_history').insert({
    user_id: user.id,
    title: historyTitle,
    category: category,
    department_name: deptName,
    points: earnedPoints
  });

  return { newPoints, earnedPoints, historyTitle };
}