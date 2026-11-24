/* Shared, dependency-free navigation and interaction layer. */
const UI = (() => {
  const paths = {
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    qr:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h3v3h3v3h-6z"/>',
    quiz:'<path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 18h.01"/><circle cx="12" cy="12" r="10"/>',
    exchange:'<path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13"/><path d="M12 8c-8 0-6-7-2-5 2 1 2 5 2 5s0-4 2-5c4-2 6 5-2 5"/>',
    profile:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    history:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    dept:'<path d="M4 21V7l8-4 8 4v14M2 21h20M8 9h1m6 0h1M8 13h1m6 0h1M10 21v-4h4v4"/>',
    index:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    checkin:'<path d="M16 21v-2a6 6 0 0 0-12 0v2M18 8a3 3 0 0 1 0 6M20 21v-2a6 6 0 0 0-3-5"/><circle cx="10" cy="7" r="4"/>',
    product:'<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10M7 4l10 6"/>',
    event:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18M7 15h2m4 0h4"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.index}</svg>`;
  const userLinks=[['home','ホーム'],['qr','チェックイン'],['quiz','学科クイズ'],['exchange','景品交換'],['history','ポイント履歴'],['dept','学科情報'],['profile','プロフィール']];
  const adminLinks=[['index','ダッシュボード'],['checkin','来校履歴'],['exchange','景品交換履歴'],['product','景品管理'],['event','イベント管理'],['quiz','クイズ管理'],['qr','QRコード発行']];
  function init() {
    const admin=document.body.dataset.area==='admin', current=document.body.dataset.page;
    const links=admin?adminLinks:userLinks, prefix=admin?'../':'';
    const brand=`<a class="brand" href="${admin?'index':'home'}.html"><img src="${prefix}icons/campus.svg" width="38" height="38" alt=""><span>KCR CAMPUS<small>${admin?'管理画面':'OPEN CAMPUS PASSPORT'}</small></span></a>`;
    const link=([id,label],mobile=false)=>`<a href="${id}.html" class="${mobile?'':'nav-item '}${current===id?'active':''}" ${current===id?'aria-current="page"':''}>${icon(id)}<span>${label}</span></a>`;
    const mobile=admin?links.slice(0,3):[userLinks[0],userLinks[1],userLinks[2],userLinks[3],userLinks[6]];
    const logout = '<form class="staff-logout" method="post" action="/api/staff/logout"><button class="btn btn-secondary" type="submit">ログアウト</button></form>';
    const sidebarNote = admin
      ? `<div class="sidebar-note"><a href="../home.html">利用者画面へ ↗</a>${logout}</div>`
      : '<div class="sidebar-note"><strong>ひとつの体験が、未来につながる。</strong>体験・クイズに参加して、ポイントをためよう。<a href="https://www.kcr.ac.jp/contact/">お問い合わせ ↗</a></div>';
    document.getElementById('appNavigation').innerHTML=`<aside class="sidebar">${brand}<p class="nav-caption">${admin?'管理メニュー':'MY CAMPUS'}</p><nav aria-label="メインナビゲーション">${links.map(x=>link(x)).join('')}</nav>${sidebarNote}</aside><header class="mobile-header">${brand}<span>${admin?'管理画面':'OPEN CAMPUS'}</span></header><nav class="mobile-nav" aria-label="モバイルナビゲーション">${mobile.map(x=>link(x,true)).join('')}${admin?`<details><summary>${icon('more')}<span>メニュー</span></summary><div class="mobile-menu">${links.map(([id,label])=>`<a href="${id}.html">${label}</a>`).join('')}<a href="../home.html">利用者画面へ ↗</a>${logout}</div></details>`:''}</nav>`;
    document.querySelectorAll('[data-show-password]').forEach(input=>input.addEventListener('change',()=>{document.getElementById('password').type=input.checked?'text':'password';}));
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      if(typeof window.stopScanner==='function')window.stopScanner();
      if(typeof window.closeEditModal==='function')window.closeEditModal();
      document.querySelectorAll('details[open]').forEach(el=>el.open=false);
    });
    // Accessible focus containment for the existing camera and edit overlays.
    document.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const modal=[...document.querySelectorAll('.modal-overlay')].find(el=>getComputedStyle(el).display!=='none');
      if(!modal)return;
      const items=[...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(el=>!el.disabled&&el.offsetParent!==null);
      if(!items.length)return;
      const first=items[0],last=items.at(-1);
      if(!modal.contains(document.activeElement)||(!event.shiftKey&&document.activeElement===last)){event.preventDefault();first.focus();}
      else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    });
  }
  function notify(message){
    const host=document.getElementById('notifications');if(!host)return window.alert(message);
    const notice=document.createElement('div');notice.className='notice';
    const text=document.createElement('span');text.textContent=String(message);
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','通知を閉じる');close.onclick=()=>notice.remove();
    notice.append(text,close);host.append(notice);setTimeout(()=>notice.remove(),10000);
  }
  document.addEventListener('DOMContentLoaded',init);
  function confirmAction(message){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='confirm-dialog';
      dialog.innerHTML='<h2>内容をご確認ください</h2><p class="confirm-message"></p><div class="button-row"><button type="button" class="btn btn-secondary" data-cancel>キャンセル</button><button type="button" class="btn btn-primary" data-confirm>実行する</button></div>';
      dialog.querySelector('p').textContent=message;
      const previous=document.activeElement;
      const finish=value=>{dialog.close();dialog.remove();previous?.focus();resolve(value);};
      dialog.querySelector('[data-cancel]').onclick=()=>finish(false);
      dialog.querySelector('[data-confirm]').onclick=()=>finish(true);
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
      document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').focus();
    });
  }
  function previewImage(url,title){
    const previous=document.activeElement;
    const dialog=document.createElement('dialog');dialog.className='image-dialog';
    dialog.innerHTML='<div class="section-heading"><h2></h2><button class="icon-button" type="button" aria-label="画像を閉じる">×</button></div><img alt="">';
    dialog.querySelector('h2').textContent=title||'景品画像';
    const img=dialog.querySelector('img');img.src=url;img.alt=title||'景品画像';
    const close=()=>{dialog.close();dialog.remove();previous?.focus();};
    dialog.querySelector('button').onclick=close;
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
    document.body.append(dialog);dialog.showModal();
  }
  return {icon,notify,confirm:confirmAction,previewImage};
})();
