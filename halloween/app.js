(() => {
  'use strict';
  const ideas = window.GARDEN_IDEAS;
  const $ = id => document.getElementById(id);
  const byId = new Map(ideas.map(x => [x.id, x]));
  const storageKey = 'haunted-garden-ideas-v1';
  const recommendation = [6,9,10,20,2,7,8,1,3,4,5,11,12,13,14,15,16,17,18,19];
  const themes = [['All','All ideas'],['Spiders','Spiders & webs'],['Graveyards','Graveyards'],['Structures','Dukkestue & sheds'],['Lighting','Lighting'],['Mechanics','Moving props'],['Projection','Projections'],['Europe','Europe']];
  const tagNames = {Structures:'Dukkestue & sheds',Mechanics:'Moving props',Projection:'Projection',Spiders:'Spiders & webs'};
  let saved = new Set(), notes = {}, storageAvailable = true;
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (Array.isArray(data.saved)) saved = new Set(data.saved.filter(x => byId.has(x)));
    if (data.notes && typeof data.notes === 'object') for (const [id, note] of Object.entries(data.notes)) {
      if (byId.has(id) && typeof note === 'string') notes[id] = note.slice(0,5000);
    }
  } catch { storageAvailable = false; }
  let view = 'all', theme = 'All', query = '', sort = 'recommended', current = null, navigation = [], returnFocus = null, playing = false, toastTimer;
  const esc = value => String(value).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const fold = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const bookmark = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
  function notify(message) {
    $('toast').textContent = message; $('toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3000);
  }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({version:1,saved:[...saved],notes})); storageAvailable=true; return true; }
    catch { storageAvailable=false; return false; }
  }
  function pool() {
    return ideas.filter(x => (view==='all' || saved.has(x.id)) && (!query || fold([x.title,x.originalTitle,x.place,x.idea,x.tags.join(' '),notes[x.id]||''].join(' ')).includes(fold(query))));
  }
  function visible() {
    return pool().filter(x => theme==='All' || x.tags.includes(theme)).sort((a,b) => sort==='name' ? a.title.localeCompare(b.title) : sort==='original' ? a.number-b.number : recommendation.indexOf(a.number)-recommendation.indexOf(b.number));
  }
  function renderFilters() {
    const candidates=pool();
    $('filters').innerHTML=themes.map(([key,label]) => `<button class="filter${theme===key?' active':''}" data-theme="${key}" aria-pressed="${theme===key}">${label}<span class="filter-count">${key==='All'?candidates.length:candidates.filter(x=>x.tags.includes(key)).length}</span></button>`).join('');
  }
  function render() {
    const list=visible();
    $('saved-count').textContent=saved.size;
    $('saved-tab').setAttribute('aria-label',`Shortlist, ${saved.size} saved ideas`);
    $('browse-tab').classList.toggle('active',view==='all'); $('browse-tab').setAttribute('aria-pressed',view==='all');
    $('saved-tab').classList.toggle('active',view==='saved'); $('saved-tab').setAttribute('aria-pressed',view==='saved');
    $('hero').hidden=view==='saved';
    $('section-eyebrow').textContent=view==='saved'?'THE PLAN IS TAKING SHAPE':'THE INSPIRATION COLLECTION';
    $('collection-title').textContent=view==='saved'?'The ones to remember.':'Find the feeling.';
    $('collection-description').textContent=view==='saved'?'Your saved ideas and notes for next Halloween. Kept in this browser.':'Real gardens, clever effects, and ideas worth borrowing.';
    $('collection-total').textContent=view==='saved'?`${saved.size} saved ${saved.size===1?'idea':'ideas'}`:'20 ideas to explore';
    $('export-button').hidden=view!=='saved'||saved.size===0;
    $('results-count').textContent=`${list.length} ${list.length===1?'idea':'ideas'}${theme==='All'?'':` · ${themes.find(x=>x[0]===theme)[1]}`}${query?` matching “${query}”`:''}`;
    $('reset-filters').hidden=!query&&theme==='All';
    $('research-note').textContent=view==='saved'?'Your notes are included when you export.':'Photographed home displays. Original sources included.';
    renderFilters();
    $('idea-grid').innerHTML=list.map(x => `<article class="idea-card" data-id="${x.id}"><div class="card-photo"><button class="photo-open" data-open="${x.id}" aria-label="Explore ${esc(x.title)}"><img src="${esc(x.image)}" alt="${esc(x.originalTitle)}" loading="lazy" referrerpolicy="no-referrer"></button><div class="photo-shade"></div><span class="card-number">${String(x.number).padStart(2,'0')} / 20</span><button class="save-button" data-save="${x.id}" aria-pressed="${saved.has(x.id)}" aria-label="${saved.has(x.id)?'Remove':'Save'} ${esc(x.title)} ${saved.has(x.id)?'from':'to'} shortlist">${bookmark}</button>${x.fit?`<span class="fit-badge">✦ &nbsp; A favourite for ${esc(x.fit.toLowerCase())}</span>`:''}</div><div class="card-body"><p class="card-place">${esc(x.place)}${notes[x.id]?.trim()?'<span class="note-dot" aria-label="Has your notes"> · Has notes</span>':''}</p><button class="card-title" data-open="${x.id}">${esc(x.title)}</button><p class="card-description">${esc(x.idea)}</p><div class="card-bottom"><div class="card-tags">${x.tags.filter(t=>t!=='Europe').slice(0,2).map(t=>`<span class="tag">${tagNames[t]||t}</span>`).join('')}</div><a class="source-link" href="${esc(x.source)}" target="_blank" rel="noopener noreferrer" aria-label="View ${esc(x.title)} on ${x.sourceName}">${x.sourceName} ↗</a></div></div></article>`).join('');
    $('idea-grid').hidden=!list.length;
    $('empty-state').hidden=!!list.length;
    if(!list.length){
      const noSaved=view==='saved'&&saved.size===0;
      $('empty-title').textContent=noSaved?'Every good haunt starts with an idea.':'Nothing lurking here.';
      $('empty-description').textContent=noSaved?'Tap the bookmark on any idea to collect it here. Open an idea to add notes for our garden.':'Try a different search or clear the theme filter to see more ideas.';
      $('empty-action').textContent=noSaved?'Explore the collection':'Clear search & filters';
    }
    $('idea-grid').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{
      img.style.visibility='hidden';
      const fallback=document.createElement('div');fallback.className='image-error';fallback.innerHTML='<strong>Photo unavailable</strong><span>Open the idea to visit its original source.</span>';img.closest('.card-photo').append(fallback);
    },{once:true}));
  }
  function setView(next){view=next;theme='All';query='';$('search').value='';render();window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  function reset(){theme='All';query='';$('search').value='';render();}
  function toggleSaved(id){
    if(saved.has(id))saved.delete(id);else saved.add(id);
    const ok=persist();render();if(current===id)updateSaveButton();
    notify(ok?(saved.has(id)?'Added to your shortlist':'Removed from your shortlist'):'Browser storage is unavailable. Export your shortlist to keep it.');
  }
  function updateSaveButton(){
    const isSaved=saved.has(current);$('detail-save').textContent=isSaved?'✓ In your shortlist':'♡ Add to shortlist';$('detail-save').setAttribute('aria-pressed',isSaved);
  }
  function showDetail(id,initial=false){
    const x=byId.get(id);if(!x)return;
    if(initial){navigation=visible().map(x=>x.id);if(!navigation.includes(id))navigation=ideas.map(x=>x.id);returnFocus=document.activeElement;}
    current=id;playing=false;
    $('detail-image').src=x.image;$('detail-image').alt=x.originalTitle;$('detail-image').style.visibility='visible';
    $('photo-credit').textContent=`Photo: ${x.credit}`;
    $('detail-number').textContent=`FIELD NOTE ${String(x.number).padStart(2,'0')} / 20`;
    $('detail-fit').textContent=x.fit?`✦ ${x.fit}`:'';
    $('detail-place').textContent=x.place;$('detail-title').textContent=x.title;$('original-title').textContent=x.originalTitle;
    $('detail-tags').innerHTML=x.tags.map(t=>`<span class="tag">${tagNames[t]||t}</span>`).join('');
    $('detail-idea').textContent=x.idea;$('detail-source').href=x.source;
    $('idea-notes').value=notes[id]||'';$('note-status').textContent=storageAvailable?'Saved automatically':'Storage unavailable';
    $('motion-button').hidden=!x.motionImage;$('motion-button').textContent='Play effect preview ▷';$('motion-button').setAttribute('aria-pressed','false');
    updateSaveButton();const position=navigation.indexOf(id);$('detail-position').textContent=`${position+1} of ${navigation.length} in this view`;
    $('previous-idea').disabled=position<=0;$('next-idea').disabled=position>=navigation.length-1;
    if(!$('idea-dialog').open)$('idea-dialog').showModal();
    $('idea-dialog').scrollTop=0;document.body.style.overflow='hidden';
    history.replaceState(null,'',`#idea-${id}`);
  }
  function step(delta){const index=navigation.indexOf(current)+delta;if(index>=0&&index<navigation.length)showDetail(navigation[index]);}
  function exportShortlist(){
    const selection=ideas.filter(x=>saved.has(x.id));
    const text=['# The Haunted Garden — shortlist',`Exported ${new Date().toLocaleDateString('en-GB')}`,'',...selection.flatMap(x=>[`## ${x.title}`,x.place,'',x.idea,'',`Source: ${x.source}`,`Photo: ${x.image}`,...(notes[x.id]?.trim()?['',`Notes: ${notes[x.id].trim()}`]:[]),'','---',''])].join('\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='haunted-garden-shortlist.md';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify(`Exported ${selection.length} ${selection.length===1?'idea':'ideas'} with your notes`);
  }
  document.addEventListener('click',event=>{
    const open=event.target.closest('[data-open]');if(open){showDetail(open.dataset.open,true);return;}
    const save=event.target.closest('[data-save]');if(save){const id=save.dataset.save;toggleSaved(id);document.querySelector(`[data-save="${id}"]`)?.focus({preventScroll:true});return;}
    const filter=event.target.closest('[data-theme]');if(filter){theme=filter.dataset.theme;render();document.querySelector(`[data-theme="${theme}"]`)?.focus({preventScroll:true});}
  });
  $('browse-tab').onclick=()=>setView('all');$('saved-tab').onclick=()=>setView('saved');
  document.querySelector('.brand').onclick=event=>{event.preventDefault();setView('all');};
  $('search').oninput=event=>{query=event.target.value.trim();render();};$('sort').onchange=event=>{sort=event.target.value;render();};
  $('reset-filters').onclick=reset;$('empty-action').onclick=()=>view==='saved'&&saved.size===0?setView('all'):reset();
  $('export-button').onclick=exportShortlist;
  $('close-dialog').onclick=()=>$('idea-dialog').close();
  $('idea-dialog').addEventListener('click',event=>{if(event.target===$('idea-dialog')){const r=$('idea-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('idea-dialog').close();}});
  $('idea-dialog').addEventListener('close',()=>{current=null;document.body.style.overflow='';history.replaceState(null,'',location.pathname+location.search);render();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else $('collection-title').focus?.({preventScroll:true});});
  $('previous-idea').onclick=()=>step(-1);$('next-idea').onclick=()=>step(1);$('detail-save').onclick=()=>toggleSaved(current);
  $('idea-notes').oninput=event=>{if(!current)return;notes[current]=event.target.value;$('note-status').textContent=persist()?'Saved in this browser':'Not saved — export to keep';};
  $('motion-button').onclick=()=>{const x=byId.get(current);if(!x?.motionImage)return;playing=!playing;$('detail-image').src=playing?x.motionImage:x.image;$('motion-button').textContent=playing?'Stop preview ▪':'Play effect preview ▷';$('motion-button').setAttribute('aria-pressed',playing);};
  $('detail-image').onerror=()=>{$('detail-image').style.visibility='hidden';$('photo-credit').textContent='This photo is temporarily unavailable. Use Original source to see the display.';};
  document.addEventListener('keydown',event=>{
    if(event.ctrlKey||event.metaKey||event.altKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
    if(event.key==='/'&&!$('idea-dialog').open){event.preventDefault();$('search').focus();}
    if($('idea-dialog').open&&event.key==='ArrowRight'){event.preventDefault();step(1);}
    if($('idea-dialog').open&&event.key==='ArrowLeft'){event.preventDefault();step(-1);}
  });
  window.addEventListener('hashchange',()=>{const match=location.hash.match(/^#idea-(\d+)$/);if(match)showDetail(match[1],true);});
  render();const initial=location.hash.match(/^#idea-(\d+)$/);if(initial)showDetail(initial[1],true);
})();
