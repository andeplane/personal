const key = 'personal-shopping-2026-10-v1';
const money = ore => new Intl.NumberFormat('nb-NO', {style:'currency',currency:'NOK'}).format(ore / 100);
let checked = new Set();
try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(saved)) checked = new Set(saved.filter(x => typeof x === 'string')); } catch {}
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
fetch('items.json').then(r => { if (!r.ok) throw Error('data'); return r.json(); }).then(data => {
 const all = [...data.groups.flatMap(g=>g.items), ...data.online];
 function save() {try {localStorage.setItem(key,JSON.stringify([...checked]));} catch {document.querySelector('#save-note').textContent='Avkryssing virker, men denne nettleseren tillater ikke lagring.';}}
 function item(x) {
  const row=el('div',null,'item'); row.dataset.id=x.id;
  const box=el('input'); box.type='checkbox'; box.id=x.id; box.checked=checked.has(x.id);
  const body=el('div'); const label=el('label',x.name);label.htmlFor=x.id;
  body.append(label,el('p',x.project,'project'),el('p',x.purpose,'purpose'),el('p',x.quantity,'quantity'));
  const bottom=el('div',null,'item-bottom');const link=el('a','Se produkt ↗');link.href=x.url;bottom.append(link,el('strong',money(x.ore)));body.append(bottom);
  if(x.note)body.append(el('p',x.note,'note'));row.append(box,body);
  box.addEventListener('change',()=>{box.checked?checked.add(x.id):checked.delete(x.id);save();update();});return row;
 }
 const stores=document.querySelector('#stores');
 for(const area of ['Storo','Torggata']){
  const section=el('section',null,'area');section.id=area.toLowerCase();section.append(el('p',area==='Storo'?'01 / FØRSTE STOPP':'02 / VIDERE I SENTRUM','eyebrow'),el('h2',area));
  for(const group of data.groups.filter(g=>g.area===area)){
   const card=el('article',null,'store'); const head=el('div',null,'store-head');head.append(el('h3',group.name),el('p',group.location,'location'));
   const links=el('div',null,'store-links');const map=el('a','Åpne kart ↗');map.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(group.name+' '+group.location);const total=el('strong');total.dataset.group=group.id;links.append(map,total);head.append(links,el('p',group.note,'status'));card.append(head,...group.items.map(item));section.append(card);
  }stores.append(section);
 }
 document.querySelector('#online-items').append(...data.online.map(item));
 function update(){
  const local=data.groups.flatMap(g=>g.items);const left=local.filter(x=>!checked.has(x.id));
  document.querySelector('#remaining').textContent=money(left.reduce((s,x)=>s+x.ore,0));
  document.querySelector('#progress').textContent=`${local.length-left.length} av ${local.length} varelinjer avkrysset`;
  for(const g of data.groups)document.querySelector(`[data-group="${g.id}"]`).textContent=money(g.items.filter(x=>!checked.has(x.id)).reduce((s,x)=>s+x.ore,0));
  document.querySelector('#online-total').textContent=money(data.online.filter(x=>!checked.has(x.id)).reduce((s,x)=>s+x.ore,0))+' gjenstår + frakt';
  for(const row of document.querySelectorAll('.item')){const done=checked.has(row.dataset.id);row.classList.toggle('done',done);row.hidden=done&&document.querySelector('#hide-done').checked;row.querySelector('input').checked=done;}
 }
 document.querySelector('#hide-done').addEventListener('change',update);
 document.querySelector('#reset').addEventListener('click',()=>{if(confirm('Nullstille alle avkryssinger på denne enheten?')){checked.clear();save();update();}});
 window.addEventListener('storage',event=>{if(event.key===key){try{const value=JSON.parse(event.newValue||'[]');if(Array.isArray(value)){checked=new Set(value.filter(x=>typeof x==='string'));update();}}catch{}}});
 update();
}).catch(()=>{document.querySelector('#progress').textContent='Listen kunne ikke lastes.';document.querySelector('#error').textContent='Last siden på nytt når du har nett. Ingen avkryssinger er slettet.';});
document.querySelector('#print').addEventListener('click',()=>window.print());
