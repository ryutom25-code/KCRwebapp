let currentUser = null;
let currentProfile = null;
let selectedProduct = null;
let html5QrcodeScanner = null;
let exchangeProcessing = false;
let scannerGeneration = 0;
let scannerTrigger = null;

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

  const { data: profile, error: profileError } = await window.supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (profileError || !profile) {
    document.getElementById('productList').textContent = 'プロフィールを取得できません。プロフィール登録または再読み込みを行ってください。';
    return;
  }
  currentProfile = profile;
  document.getElementById('userPoints').textContent = (profile?.points || 0) + ' PT';

  const { data: products, error: productsError } = await window.supabaseClient
    .from('products')
    .select('*')
    .order('points', { ascending: true });

  const container = document.getElementById('productList');

  if (productsError) { container.textContent = '景品を取得できませんでした。再読み込みしてください。'; return; }
  if (!products || products.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #888; padding: 20px 0;">交換可能な景品は現在ありません。</p>';
    return;
  }

  container.innerHTML = products.map((prod, index) => {
    const shortage = Math.max(0, Number(prod.points) - Number(currentProfile.points || 0));
    return `<article class="product-card"><button type="button" class="product-image product-image-zoom" data-preview-index="${index}" aria-label="${App.escapeHtml(prod.name)}の画像を拡大"><img src="${App.escapeHtml(App.safeImageUrl(prod.image_url) || 'icons/campus.svg')}" alt="${App.escapeHtml(prod.name)}" loading="lazy"></button><div class="product-body"><h3>${App.escapeHtml(prod.name)}</h3><p class="product-points">${Number(prod.points).toLocaleString()} <small>PT</small></p><small>${shortage ? `あと ${shortage.toLocaleString()} PT で交換できます` : '交換できるポイントがたまっています'}</small><button type="button" class="btn ${shortage ? 'btn-secondary' : 'btn-primary'}" data-product-index="${index}">交換する <span>→</span></button></div></article>`;
  }).join('');
  container.querySelectorAll('[data-preview-index]').forEach(button => {
    button.addEventListener('click', () => {
      const product = products[Number(button.dataset.previewIndex)];
      UI.previewImage(App.safeImageUrl(product.image_url) || 'icons/campus.svg', product.name);
    });
  });
  container.querySelectorAll('[data-product-index]').forEach(button => {
    button.addEventListener('click', () => openScanner(products[Number(button.dataset.productIndex)]));
  });
}

// 💡 どこからでも絶対に呼べる閉じる処理（モーダルを隠すのが最優先）
window.stopScanner = function() {
  scannerGeneration++;
  scannerTrigger?.focus?.();
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
  if (exchangeProcessing || html5QrcodeScanner) return;
  if (!App.hasPendingRequest('exchange:' + product.id) && (currentProfile?.points || 0) < product.points) {
    App.notify(`ポイントが足りません。（必要: ${product.points} PT / 所持: ${currentProfile?.points || 0} PT）`);
    return;
  }

  scannerTrigger = document.activeElement;
  selectedProduct = product;
  document.getElementById('targetProductName').textContent = `「${product.name}」（${product.points} PT）`;

  // モーダルを表示
  const modal = document.getElementById('scannerModal');
  if (modal) { modal.style.display = 'flex'; document.getElementById('closeScannerBtn')?.focus(); }

  const readerEl = document.getElementById('reader');
  if (readerEl) readerEl.innerHTML = '';

  try {
    html5QrcodeScanner = new Html5Qrcode("reader");
    const scanner = html5QrcodeScanner;
    const generation = ++scannerGeneration;
    scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      text => { if (generation === scannerGeneration) onScanSuccess(text); }
    ).then(async () => {
      if (generation !== scannerGeneration) {
        await scanner.stop();
        scanner.clear();
      }
    }).catch(err => {
      if (generation !== scannerGeneration) return;
      console.warn('カメラ起動失敗:', err);
      App.notify('📷 カメラへのアクセスが許可されていないか、利用できません。');
      stopScanner();
    });
  } catch (err) {
    console.error('スキャナー初期化エラー:', err);
    stopScanner();
  }
}

// The server verifies the product price and commits deduction and history together.
async function onScanSuccess(decodedText) {
  if (exchangeProcessing || !selectedProduct) return;
  exchangeProcessing = true;
  const product = selectedProduct;
  stopScanner();
  try {
    if (decodedText.trim() !== 'EXCHANGE_BOOTH') {
      throw new Error('景品交換ブースのQRコードを読み取ってください。');
    }
    if (!await App.confirm(`「${product.name}」を ${product.points} PT で交換しますか？`)) return;
    const requestKey = 'exchange:' + product.id;
    const requestId = App.pendingRequest(requestKey);
    const result = await App.rpc('exchange_product', {
      p_product_id: String(product.id), p_code: decodedText.trim(), p_request_id: requestId, p_expected_points: product.points
    });
    App.completeRequest(requestKey);
    if (currentProfile) currentProfile.points = result.newPoints;
    App.notify(`🎉 「${result.productName}」との交換が完了しました！`);
    await loadProfileAndProducts();
  } catch (error) {
    App.notify('交換を完了できませんでした: ' + error.message);
  } finally {
    exchangeProcessing = false;
  }
}
