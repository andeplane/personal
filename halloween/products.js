(() => {
  'use strict';
  const products = window.GARDEN_PRODUCTS;
  const images = window.GARDEN_PRODUCT_IMAGES || {};
  const galleries = window.GARDEN_PRODUCT_GALLERIES || {};
  const key = 'haunted-garden-products-v1';
  const $ = selector => document.querySelector(selector);
  const categories = ['All finds', ...new Set(products.map(p => p.category))];
  const symbols = {'Lighting':'✦','Spiders & webs':'✳','Graves & movement':'†','Projection':'◈','Fog':'≈','Power & control':'ϟ'};
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (value,currency) => new Intl.NumberFormat('en-GB',{style:'currency',currency,maximumFractionDigits:2}).format(value);
  let list = {}, category = 'All finds', savedOnly = false, toastTimer;
  try {
    const stored = JSON.parse(localStorage.getItem(key)||'{}');
    for(const p of products) if(Number.isInteger(stored?.[p.id]) && stored[p.id]>0 && stored[p.id]<=99) list[p.id]=stored[p.id];
  } catch {}
  function toast(message) {const el=$('#product-toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),2800);}
  function save() {try {localStorage.setItem(key,JSON.stringify(list));} catch {toast('Browser storage is unavailable. Export your list to keep it.');}}
  function totals() {
    const result={};let count=0;
    for(const p of products) if(list[p.id]) {result[p.currency]=(result[p.currency]||0)+p.price*list[p.id];count+=list[p.id];}
    $('#list-count').textContent=count;$('#bar-count').textContent=count;
    $('#subtotal').textContent=count ? 'Estimate: '+Object.entries(result).map(([currency,total])=>money(total,currency)).join(' + ') : 'Your list is empty';
    $('#shortlist-toggle').setAttribute('aria-pressed',String(savedOnly));
    $('#shortlist-toggle').classList.toggle('active',savedOnly);
    $('#products-title').textContent=savedOnly?'Your garden, taking shape.':'Built for a better scare.';
  }
  function render() {
    const search=$('#product-search').value.trim().toLowerCase(), market=$('#market').value,picks=$('#picks-only').checked;
    const visible=products.filter(p=>(category==='All finds'||p.category===category)&&(market==='All'||p.market===market)&&(!picks||p.pick)&&(!savedOnly||list[p.id])&&(!search||[p.name,p.category,p.why,p.detail,p.control,p.quality,p.placement].join(' ').toLowerCase().includes(search))).sort((a,b)=>Number(!!b.pick)-Number(!!a.pick));
    $('#product-filters').innerHTML=categories.map(c=>`<button class="filter ${category===c?'active':''}" aria-pressed="${category===c}" data-filter="${esc(c)}">${esc(c)}</button>`).join('');
    $('#product-count').textContent=`${visible.length} ${visible.length===1?'product':'products'}${savedOnly?' in your list':''}`;
    $('#reset-products').hidden=category==='All finds'&&market==='All'&&!search&&!picks&&!savedOnly;
    $('#product-empty').hidden=visible.length>0;
    $('#product-grid').innerHTML=visible.map(p=>`<article class="product-card ${list[p.id]?'in-list':''}" id="${p.id}"><button class="product-photo ${images[p.id]?'':'no-photo'}" data-gallery="${p.id}" aria-label="View photos of ${esc(p.name)}" aria-haspopup="dialog">${images[p.id]?`<img src="${esc(images[p.id])}" alt="${esc(p.name)}" loading="lazy" decoding="async">`:''}<span class="product-symbol" aria-hidden="true">${symbols[p.category]}</span>${p.pick?'<span class="pick-badge">FIRST PICK</span>':''}<span class="photo-count">${galleries[p.id]?.length||1} ${(galleries[p.id]?.length||1)===1?'photo':'photos'} · View ↗</span></button><div class="product-body"><p class="product-meta">${esc(p.category)} · ${esc(p.market==='Norway'?'Norwegian storefront':p.market==='Import'?'Import quote needed':'Digital download')}</p><h3><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)} <span aria-hidden="true">↗</span></a></h3><p class="product-why">${esc(p.why)}</p><p class="quality">${esc(p.quality)}</p><div class="product-tags"><span>${esc(p.placement)}</span><span>${esc(p.control)}</span></div><details><summary>Fit, specifications & things to check</summary><p>${esc(p.detail)}</p><p>${esc(p.caveat)}</p></details><div class="product-buy"><div class="product-price"><strong>${esc(p.prefix||'')}${esc(money(p.price,p.currency))}</strong><small>Observed 31 Oct 2026</small></div><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">View at ${esc(p.merchant)} ↗</a></div><div class="product-save"><button class="button ${list[p.id]?'primary':'subtle'}" data-save="${p.id}" aria-pressed="${!!list[p.id]}">${list[p.id]?'✓ In my list · remove':'+ Add to my list'}</button>${list[p.id]?`<label>Qty <input type="number" min="1" max="99" value="${list[p.id]}" data-quantity="${p.id}" aria-label="Quantity of ${esc(p.name)}"></label>`:''}</div></div></article>`).join('');
    $('#product-grid').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.classList.add('failed');img.parentElement.classList.add('no-photo');},{once:true}));
    totals();
  }
  const dialog = $('#product-gallery');
  let galleryProduct, galleryIndex = 0, galleryOpener, previousOverflow;
  function showPhoto(index) {
    const photos = galleries[galleryProduct.id];
    galleryIndex = (index + photos.length) % photos.length;
    const photo = photos[galleryIndex], image = $('#gallery-image');
    $('#gallery-error').hidden = true;
    image.hidden = false;
    image.alt = `${galleryProduct.name} — ${photo.caption}, photo ${galleryIndex + 1}`;
    image.src = photo.src;
    $('#gallery-caption').textContent = photo.caption;
    $('#gallery-count').textContent = `${galleryIndex + 1} / ${photos.length}`;
    $('#gallery-source').textContent = `Photo: ${photo.sourceName} ↗`;
    $('#gallery-source').href = photo.sourcePage;
    $('#gallery-prev').hidden = $('#gallery-next').hidden = photos.length < 2;
    $('#gallery-thumbnails').hidden = photos.length < 2;
    $('#gallery-thumbnails').querySelectorAll('button').forEach((button, i) => {
      button.setAttribute('aria-current', String(i === galleryIndex));
    });
    $('#gallery-thumbnails').querySelector(`[data-photo="${galleryIndex}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  function openGallery(id, opener) {
    galleryProduct = products.find(p => p.id === id);
    if (!galleryProduct || !galleries[id]?.length) return;
    galleryOpener = opener;
    $('#gallery-title').innerHTML = `<a href="${esc(galleryProduct.url)}" target="_blank" rel="noopener noreferrer">${esc(galleryProduct.name)} ↗</a>`;
    $('#gallery-shop').href = galleryProduct.url;
    $('#gallery-shop').textContent = `View at ${galleryProduct.merchant} ↗`;
    $('#gallery-thumbnails').innerHTML = galleries[id].map((photo,i) => `<button data-photo="${i}" aria-label="Show photo ${i+1}: ${esc(photo.caption)}" aria-current="false"><img src="${esc(photo.src)}" alt="" loading="lazy"></button>`).join('');
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    showPhoto(0);
    $('#gallery-close').focus();
  }
  $('#gallery-image').addEventListener('error', () => { $('#gallery-image').hidden = true; $('#gallery-error').hidden = false; });
  $('#gallery-close').addEventListener('click', () => dialog.close());
  $('#gallery-prev').addEventListener('click', () => showPhoto(galleryIndex - 1));
  $('#gallery-next').addEventListener('click', () => showPhoto(galleryIndex + 1));
  $('#gallery-thumbnails').addEventListener('click', e => {
    const button = e.target.closest('[data-photo]');
    if (button) showPhoto(Number(button.dataset.photo));
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      showPhoto(galleryIndex + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });
  dialog.addEventListener('click', e => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = previousOverflow;
    galleryOpener?.focus({preventScroll:true});
  });
  $('#product-grid').addEventListener('click', e => {
    const button = e.target.closest('[data-gallery]');
    if (button) openGallery(button.dataset.gallery, button);
  });
  function clear(){category='All finds';savedOnly=false;$('#market').value='All';$('#product-search').value='';$('#picks-only').checked=false;render();}
  function showList(){category='All finds';savedOnly=true;$('#market').value='All';$('#product-search').value='';$('#picks-only').checked=false;render();$('#products').scrollIntoView({behavior:'smooth'});}
  $('#product-search').addEventListener('input',render);$('#market').addEventListener('change',render);$('#picks-only').addEventListener('change',render);
  $('#reset-products').addEventListener('click',clear);$('#empty-reset').addEventListener('click',clear);
  $('#view-list').addEventListener('click',showList);$('#shortlist-toggle').addEventListener('click',()=>savedOnly?clear():showList());
  $('#product-filters').addEventListener('click',e=>{const button=e.target.closest('[data-filter]');if(button){category=button.dataset.filter;render();}});
  document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{clear();category=button.dataset.category;render();$('#products').scrollIntoView({behavior:'smooth'});}));
  $('#product-grid').addEventListener('click',e=>{const button=e.target.closest('[data-save]');if(!button)return;const id=button.dataset.save;const adding=!list[id];if(adding)list[id]=1;else delete list[id];save();render();const replacement=document.querySelector(`[data-save="${id}"]`);if(replacement)replacement.focus({preventScroll:true});toast(adding?'Added to your garden list.':'Removed from your list.');});
  function quantity(e, final=false){const id=e.target.dataset.quantity;if(!id)return;const value=Number(e.target.value);if(!Number.isInteger(value)||value<1||value>99){if(final){e.target.value=list[id];toast('Choose a quantity from 1 to 99.');}return;}list[id]=value;save();totals();}
  $('#product-grid').addEventListener('input',e=>quantity(e));
  $('#product-grid').addEventListener('change',e=>quantity(e,true));
  $('#export-products').addEventListener('click',()=>{
    const chosen=products.filter(p=>list[p.id]);if(!chosen.length){toast('Add a few products to your list first.');return;}
    const lines=['# Haunted Garden shopping shortlist','','Prices observed 31 October 2026. Estimates only; overseas shipping/import costs and checkout tax adjustments are not included. Some prices are listing minima.','',...chosen.flatMap(p=>[`## ${list[p.id]} × ${p.name}`,`${p.prefix||''}${money(p.price,p.currency)} each · ${p.merchant}`,p.url,p.caveat,''])];
    const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='haunted-garden-shopping-list.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Shopping list exported.');
  });
  const featured=$('#featured-product');if(images['alien-spider']){featured.src=images['alien-spider'];featured.addEventListener('load',()=>featured.classList.add('loaded'));featured.addEventListener('error',()=>featured.hidden=true);}else featured.hidden=true;
  render();
  if(location.hash){const target=document.getElementById(location.hash.slice(1));if(target)setTimeout(()=>target.scrollIntoView(),100);}
})();
