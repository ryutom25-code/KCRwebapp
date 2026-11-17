document.addEventListener('DOMContentLoaded', async () => {
  if (!await App.initAdminPage()) return;

  loadProducts();

  const form = document.getElementById('productForm');
  let previewObjectUrl=null;
  document.getElementById('productImage').addEventListener('change',event=>{
    if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
    const file=event.target.files[0];
    const preview=document.getElementById('imagePreview');
    const container=document.getElementById('imagePreviewContainer');
    if(file){previewObjectUrl=URL.createObjectURL(file);preview.src=previewObjectUrl;container.style.display='block';}
    else{const current=document.getElementById('currentImageUrl').value;preview.src=App.safeImageUrl(current);container.style.display=current?'block':'none';}
  });
  document.getElementById('imagePreview').addEventListener('click', event => { if (event.target.src) UI.previewImage(event.target.src, document.getElementById('productName').value); });
  const cancelBtn = document.getElementById('cancelEditBtn');

  if (form) form.addEventListener('submit', handleSaveProduct);
  if (cancelBtn) cancelBtn.addEventListener('click', resetForm);
});

// 💡 画像圧縮関数 (Canvasを使用して最大幅/高さを800px・画質80%に圧縮)
function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // リサイズ計算
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Blob（JPEG・圧縮率80%）に変換
        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          } else {
            reject(new Error('画像の圧縮に失敗しました'));
          }
        }, 'image/jpeg', quality);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
}

// 一覧取得＆表示（個別QR描画処理を削除）
async function loadProducts() {
  const listContainer = document.getElementById('adminProductList');
  if (!listContainer) return;

  const { data: products, error } = await window.supabaseClient
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    listContainer.innerHTML = '<p style="color: red; text-align: center;">読み込みエラーが発生しました。</p>';
    return;
  }

  if (!products || products.length === 0) {
    listContainer.innerHTML = '<p style="text-align: center; color: #888; padding: 15px 0;">登録されている商品はありません。</p>';
    return;
  }

  listContainer.innerHTML = '';

  for (const prod of products) {
    const card = document.createElement('div');
    card.className = 'admin-list-item';

    card.innerHTML = `<button type="button" class="product-image-button" aria-label="${App.escapeHtml(prod.name)}の画像を拡大"><img src="${App.escapeHtml(App.safeImageUrl(prod.image_url) || '../icons/campus.svg')}" alt="${App.escapeHtml(prod.name)}" loading="lazy"><span>拡大 ⤢</span></button><div class="item-description"><h3>${App.escapeHtml(prod.name)}</h3><p>${Number(prod.points).toLocaleString()} PT</p></div><div class="item-actions"><button type="button" class="btn-edit">編集</button><button type="button" class="btn-delete">削除</button></div>`;

    card.querySelector('.product-image-button').addEventListener('click', () => UI.previewImage(App.safeImageUrl(prod.image_url) || '../icons/campus.svg', prod.name));
    card.querySelector('.btn-edit').addEventListener('click', () => editProduct(prod));
    card.querySelector('.btn-delete').addEventListener('click', () => deleteProduct(prod.id, prod.name));

    listContainer.appendChild(card);
  }
}

// 保存処理（画像圧縮 ➔ アップロード ➔ DB保存）
async function handleSaveProduct(e) {
  e.preventDefault();

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  try {
    const id = document.getElementById('productId').value;
    const name = document.getElementById('productName').value.trim();
    const points = parseInt(document.getElementById('productPoints').value, 10);
    const imageInputFile = document.getElementById('productImage').files[0];
    let imageUrl = document.getElementById('currentImageUrl').value;

    // 画像が選択されていれば圧縮処理を実行してアップロード
    if (imageInputFile) {
      const compressedFile = await compressImage(imageInputFile, 800, 800, 0.8);

      const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.jpg`;

      const { data: uploadData, error: uploadError } = await window.supabaseClient
        .storage
        .from('product-images')
        .upload(fileName, compressedFile, {
          contentType: 'image/jpeg'
        });

      if (uploadError) {
        App.notify('画像のアップロードに失敗しました: ' + uploadError.message);
        return;
      }

      const { data: urlData } = window.supabaseClient
        .storage
        .from('product-images')
        .getPublicUrl(fileName);

      imageUrl = urlData.publicUrl;
    }

    const payload = {
      name: name,
      points: points,
      image_url: imageUrl,
      updated_at: new Date().toISOString()
    };

    let error = null;

    if (id) {
      const res = await window.supabaseClient.from('products').update(payload).eq('id', id);
      error = res.error;
    } else {
      const res = await window.supabaseClient.from('products').insert([payload]);
      error = res.error;
    }

    if (error) {
      App.notify('保存に失敗しました: ' + error.message);
    } else {
      App.notify(id ? '商品を更新しました！' : '商品を登録しました！');
      resetForm();
      loadProducts();
    }
  } catch (err) {
    App.notify('処理中にエラーが発生しました: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = document.getElementById('productId').value ? '更新する' : '登録する';
  }
}

function editProduct(prod) {
  document.getElementById('productId').value = prod.id;
  document.getElementById('productName').value = prod.name;
  document.getElementById('productPoints').value = prod.points;
  document.getElementById('currentImageUrl').value = prod.image_url || '';

  const previewContainer = document.getElementById('imagePreviewContainer');
  const previewImg = document.getElementById('imagePreview');
  if (prod.image_url) {
    previewImg.src = prod.image_url;
    previewContainer.style.display = 'block';
  } else {
    previewContainer.style.display = 'none';
  }

  document.getElementById('formTitle').textContent = '商品編集';
  document.getElementById('saveBtn').textContent = '更新する';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteProduct(id, name) {
  if (!await App.confirm(`「${name}」を削除してもよろしいですか？`)) return;

  const { error } = await window.supabaseClient.from('products').delete().eq('id', id);

  if (error) {
    App.notify('削除に失敗しました: ' + error.message);
  } else {
    App.notify('商品を削除しました。');
    loadProducts();
  }
}

function resetForm() {
  document.getElementById('productId').value = '';
  document.getElementById('currentImageUrl').value = '';
  document.getElementById('productName').value = '';
  document.getElementById('productPoints').value = '50';
  document.getElementById('productImage').value = '';
  document.getElementById('imagePreviewContainer').style.display = 'none';

  document.getElementById('formTitle').textContent = '商品を登録';
  document.getElementById('saveBtn').textContent = '登録する';
  document.getElementById('cancelEditBtn').style.display = 'none';
}
