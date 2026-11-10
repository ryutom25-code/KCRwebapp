let currentUser = null;
let currentProfile = null;
let selectedProduct = null;
let html5QrcodeScanner = null;

document.addEventListener('DOMContentLoaded', async () => {
  await supabaseInitPromise;
  const { data: { user } } = await window.supabaseClient.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;

  loadProfileAndProducts();

  // 💡 スマホのタッチ・クリック両対応でキャンセルイベントを登録
  const closeBtn = document.getElementById('closeScannerBtn');
  if (closeBtn) {
    const handleClose = (e) => {
      e.preventDefault();
      stopScanner();
    };
    closeBtn.addEventListener('touchstart', handleClose, { passive: false });
    closeBtn.addEventListener('click', handleClose);
  }
});

async function loadProfileAndProducts() {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const dateStr = `${month}/${day} 現在`;

  const dateEl = document.getElementById('currentDate');
  if (dateEl) {
    dateEl.textContent = dateStr;
  }

  const { data: profile } = await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  currentProfile = profile;
  document.getElementById('userPoints').textContent = (profile?.points || 0) + ' PT';

  const { data: products } = await window.supabaseClient
    .from('products')
    .select('*')
    .order('points', { ascending: true });

  const container = document.getElementById('productList');

  if (!products || products.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #888; padding: 20px 0;">交換可能な景品は現在ありません。</p>';
    return;
  }

  container.innerHTML = products.map(prod => `
    <div class="card" style="display: flex; gap: 12px; align-items: center; padding: 12px;">
      <img src="${prod.image_url || 'https://via.placeholder.com/80'}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px; border: 1px solid #eee;">
      <div style="flex: 1;">
        <div style="font-weight: bold; font-size: 1rem; color: #333;">${escapeHtml(prod.name)}</div>
        <div style="font-size: 0.95rem; color: #ff9500; font-weight: bold; margin-top: 4px;">🪙 ${prod.points} PT</div>
      </div>
      <button type="button" class="btn" onclick='openScanner(${JSON.stringify(prod)})' style="padding: 8px 16px; background: #007aff; color: white; font-weight: bold; border-radius: 8px; font-size: 0.9rem;">
        交換する
      </button>
    </div>
  `).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// 💡 カメラ権限の事前チェック関数
async function checkCameraPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    stream.getTracks().forEach(track => track.stop()); // チェック後に即解放
    return true;
  } catch (err) {
    console.warn('カメラアクセス権限エラー:', err);
    return false;
  }
}

// QRカメラ起動
async function openScanner(product) {
  if ((currentProfile?.points || 0) < product.points) {
    alert(`ポイントが足りません。（必要: ${product.points} PT / 所持: ${currentProfile?.points || 0} PT）`);
    return;
  }

  selectedProduct = product;
  document.getElementById('targetProductName').textContent = `「${product.name}」（${product.points} PT）`;

  // 1. カメラ権限の事前チェック
  const hasPermission = await checkCameraPermission();
  if (!hasPermission) {
    alert('📷 カメラへのアクセスが許可されていないか、利用できません。\nブラウザの設定でカメラへのアクセスを「許可」にしてから再度お試しください。');
    return; // 権限がなければモーダルを開かずに終了
  }

  // 2. 権限がある場合のみモーダルを表示
  const modal = document.getElementById('scannerModal');
  if (modal) modal.style.display = 'block';

  forceCleanupScanner();

  try {
    html5QrcodeScanner = new Html5Qrcode("reader");
    await html5QrcodeScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      onScanSuccess
    );
  } catch (err) {
    console.error('スキャナー初期化・起動エラー:', err);
    stopScanner();
  }
}

// QRコード読み取り成功時
async function onScanSuccess(decodedText) {
  stopScanner();

  const validCommonCode = 'EXCHANGE_BOOTH';

  if (decodedText.trim() !== validCommonCode) {
    alert('❌ 景品交換ブースの正解QRコードではありません！設置されているQRコードをもう一度読み取ってください。');
    return;
  }

  if (!confirm(`「${selectedProduct.name}」を ${selectedProduct.points} PT で交換しますか？`)) {
    return;
  }

  const newPoints = currentProfile.points - selectedProduct.points;

  const { error: profileError } = await window.supabaseClient
    .from('profiles')
    .update({ points: newPoints })
    .eq('id', currentUser.id);

  if (profileError) {
    alert('処理に失敗しました: ' + profileError.message);
    return;
  }

  await window.supabaseClient.from('point_history').insert({
    user_id: currentUser.id,
    title: `景品交換: ${selectedProduct.name}`,
    category: 'exchange',
    points: -selectedProduct.points
  });

  alert(`🎉 「${selectedProduct.name}」との交換が完了しました！`);
  loadProfileAndProducts();
}

// 💡 即座に画面を閉じる停止処理
function stopScanner() {
  // 同期的にモーダルを閉じる
  const modal = document.getElementById('scannerModal');
  if (modal) {
    modal.style.display = 'none';
  }

  // バックグラウンドでクリーンアップ
  setTimeout(() => {
    forceCleanupScanner();
  }, 50);
}

// クリーンアップ処理
function forceCleanupScanner() {
  if (!html5QrcodeScanner) return;

  const instance = html5QrcodeScanner;
  html5QrcodeScanner = null;

  try {
    instance.stop().then(() => {
      try { instance.clear(); } catch (e) {}
    }).catch(() => {
      try { instance.clear(); } catch (e) {}
    });
  } catch (e) {}

  const readerEl = document.getElementById('reader');
  if (readerEl) readerEl.innerHTML = '';
}