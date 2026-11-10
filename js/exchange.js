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

// 💡 どこからでも絶対に呼べる閉じる処理（モーダルを隠すのが最優先）
window.stopScanner = function() {
  const modal = document.getElementById('scannerModal');
  if (modal) {
    modal.style.display = 'none';
  }

  // カメラ解体処理（完全にバックグラウンド化）
  if (html5QrcodeScanner) {
    const scannerInstance = html5QrcodeScanner;
    html5QrcodeScanner = null;

    try {
      scannerInstance.stop().then(() => {
        try { scannerInstance.clear(); } catch(e){}
      }).catch(() => {
        try { scannerInstance.clear(); } catch(e){}
      });
    } catch(e) {}
  }

  const readerEl = document.getElementById('reader');
  if (readerEl) readerEl.innerHTML = '';
};

// QRカメラ起動
function openScanner(product) {
  if ((currentProfile?.points || 0) < product.points) {
    alert(`ポイントが足りません。（必要: ${product.points} PT / 所持: ${currentProfile?.points || 0} PT）`);
    return;
  }

  selectedProduct = product;
  document.getElementById('targetProductName').textContent = `「${product.name}」（${product.points} PT）`;

  // モーダルを表示
  const modal = document.getElementById('scannerModal');
  if (modal) modal.style.display = 'block';

  const readerEl = document.getElementById('reader');
  if (readerEl) readerEl.innerHTML = '';

  try {
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      onScanSuccess
    ).catch(err => {
      console.warn('カメラ起動失敗:', err);
      alert('📷 カメラへのアクセスが許可されていないか、利用できません。');
      stopScanner();
    });
  } catch (err) {
    console.error('スキャナー初期化エラー:', err);
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