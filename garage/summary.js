function rearSurface(a){
 if(a.type==='boaxel')return a.shelves.flat().length*.8*.38;
 if(a.type==='bror')return 10*.84*.54+2*.8*.38+upperLevels().length*3*.8*.38;
 return a.shelves.flat().length*.9*a.depth+upperLevels().length*3*.8*.38;
}
function shoppingList(a){
 const rows=[];const add=(key,qty,use)=>{if(qty)rows.push({key,qty,use});};
 const levels=upperLevels().length;
 if(a.type==='boaxel'){
  add('upright',6,'Rear · three independent BOAXEL bays, two full 200 cm uprights each');add('upperMount',3,'Rear · one uncut 82.4 cm alignment rail per bay');add('shelf',a.shelves.flat().length,'Rear · mixed openings and two shelves above the sled');add('upperBracket',a.shelves.flat().length*2,'Rear · two matching 40 cm brackets per shelf');
 }else if(a.type==='bror'){
  add('deep',2,'Rear · both stock BROR units, all ten supplied shelves used');add('upright',2,'Sled bay · two full 200 cm uprights');add('upperMount',1,'Sled bay · uncut 82.4 cm alignment rail');add('shelf',2+levels,'Sled bay · two shelves + roof-space tier(s)');add('upperBracket',(2+levels)*2,'Sled bay · two matching brackets per shelf');
 }else{add(a.baseKey,1,'Rear starter · four shelves included');add(a.extensionKey,2,'Two rear extensions · eight shelves included');}
 add('wallRail',Math.max(0,leftWallStats.rails-1),'Left wall · uncut 198 cm rails on stud faces');add('shortWallRail',leftWallStats.rails?1:0,'Above charger · uncut 316 mm rail');
 add('basketSmall',leftWallStats.small,'Left wall · fixed 43.5 × 8 × 7 cm baskets');add('basketLarge',leftWallStats.large,'Left wall · fixed 43.5 × 13.5 × 14 cm high baskets');
 add('railFixings',Math.ceil(((leftWallStats.rails?leftWallStats.rails-1:0)*5+(leftWallStats.rails?2:0))/10),'Left rails · five timber screws per full rail, two for the short rail');
 if(levels&&a.type!=='boaxel'){
  const bays=a.type==='bror'?2:3;add('upperMount',bays,'Above racks · uncut alignment rails');add('upperRail',bays*2,'Above racks · two 100 cm uprights per bay');add('shelf',bays*levels,'Above racks · metal BOAXEL shelves');add('upperBracket',bays*levels*2,'Above racks · two brackets per shelf');
 }
 // Merge identical catalogue components while preserving all allocations.
 const combined=new Map();for(const r of rows){const old=combined.get(r.key);if(old){old.qty+=r.qty;old.use+='; '+r.use;}else combined.set(r.key,{...r});}return [...combined.values()];
}
function updateTable(){
 const a=data.layouts[current],rows=shoppingList(a),total=rows.reduce((s,r)=>s+r.qty*data.products[r.key].price,0);
 root.querySelector('#garage-title').textContent=a.id+' · '+a.name;
 const photo='assets/garage-plan-'+a.id.toLowerCase()+'.jpg',photoAlt='Imagegen image of the earlier Plan '+a.id+', without a car';
 root.querySelector('#photo-title').textContent='Plan '+a.id+' · earlier generated image';root.querySelector('#photo-preview-title').textContent='Imagegen image · Plan '+a.id;
 for(const image of root.querySelectorAll('#plan-photo, #plan-photo-preview')){image.src=photo;image.alt=photoAlt;}root.querySelector('#photo-link').href=photo;
 root.querySelector('#garage-equipment').textContent=a.summary;
 root.querySelector('#garage-metrics').innerHTML='<span>Rear gap <strong>'+Math.round(a.frontGap*100)+' cm</strong></span><span>Rear system <strong>'+a.system+'</strong></span><span>Rear shelf surface <strong>'+shelfZones.reduce((s,z)=>s+z.area,0).toFixed(1)+' m²</strong></span><span>Left wall <strong>'+leftWallStats.existing+' existing ledges + '+leftWallStats.baskets+' real baskets</strong></span><span>Loft <strong>existing · '+loftStats.length.toFixed(1)+' m assumed length</strong></span>';
 const priceText=money(total)+' · products incl. VAT';root.querySelector('#garage-price').textContent=priceText;root.querySelector('#price-top').textContent=priceText;
 root.querySelector('#garage-unpriced').textContent='Prices checked '+data.priceDate+'. '+a.unpriced;
 root.querySelector('#left-capacity').textContent=leftWallStats.rails+' basket rails, '+leftWallStats.small+' shallow + '+leftWallStats.large+' high baskets, and '+leftWallStats.existing+' existing ledges / mini shelves retained. '+leftWallStats.aboveCharger+' baskets use space above the charger. No bespoke basket or custom-cut shelf is included.';
 root.querySelector('#inventory-rows').innerHTML=data.inventory.map(i=>'<tr><td>'+i.name+'<br><small>'+i.count+'</small></td><td>'+i.evidence+'</td><td>'+i.storage+'</td></tr>').join('');
 root.querySelector('#comparison-rows').innerHTML=data.layouts.map(p=>'<tr'+(p===a?' class="selected-plan"':'')+'><td>'+p.id+' · '+p.name+'</td><td>'+Math.round(p.depth*100)+' cm</td><td>'+rearSurface(p).toFixed(1)+' m²</td><td>'+Math.round(p.frontGap*100)+' cm</td><td>'+money(shoppingList(p).reduce((s,r)=>s+r.qty*data.products[r.key].price,0))+'</td></tr>').join('');
 root.querySelector('#garage-products').innerHTML=rows.map(r=>{const p=data.products[r.key];return '<tr><td>'+productLink(r.key)+'<br><small>'+p.retailer+' · '+p.sku+'</small></td><td>'+r.qty+'</td><td>'+money(p.price)+'</td><td>'+money(r.qty*p.price)+'</td><td>'+r.use+'</td></tr>';}).join('');
}
