function rearSurface(a){
 const racks=a.type==='bror'?a.rackCount*5*.84*.54:a.type==='transform'?a.rackCount*4*.9*a.depth:0;
 return racks+rearBoards(a).length*1.18*.38;
}
function shoppingList(a){
 const rows=[];const add=(key,qty,use)=>{if(qty)rows.push({key,qty,use});};
 if(a.type==='bror')add('deep',a.rackCount,'Rear · complete BROR units; all five supplied shelves each');
 if(a.type==='transform'){add('base80',1,'Rear · starter with four shelves');add('extension80',1,'Rear · extension with four shelves');}
 const inserts=recessPlacements(a);
 if(a.recessMode==='stock')add('recessUnit',inserts.length,'Inside clear left-wall compartments · uncut two-tray units');
 else{
  add('pine20',Math.ceil(inserts.length/2),'CUT LIST: '+inserts.length+' pieces, each 535 × 200 × 18 mm. Two pieces per 1180 mm board; allow 3 mm per saw cut. '+(inserts.length%2?'One spare 535 mm piece remains.':'')+' Confirm each bay before cutting.');
  add('bracket20',inserts.length*2,'Two rear-mounted 20 cm brackets per fitted recess shelf');
 }
 const side=sideRuns(a).length+1,rear=rearBoards(a).length;
 add('pine28',side,'Uncut upper side boards · '+sideRuns(a).length+' left + one right-front; existing ski shelf reused');
 add('pine38',rear,'Uncut rear wall boards · 118 × 38 cm');
 add('bracket30',(side+rear)*3,'Three Habo 30 cm supports per uncut board; fixing/backing extra');
 return rows;
}
function updateTable(){
 const a=data.layouts[current],rows=shoppingList(a),total=rows.reduce((s,r)=>s+r.qty*data.products[r.key].price,0);
 root.querySelector('#garage-title').textContent=a.id+' · '+a.name;
 const preview=photoPlans.find(p=>p.id===a.id.toLowerCase()),photo=preview.output+'?v='+preview.outputSHA256.slice(0,12),source=preview.source3D+'?v='+preview.source3DHash.slice(0,12),photoAlt='Imagegen rendering of current Plan '+a.id+', '+preview.depthCm+' cm shelves, without a car';
 root.querySelector('#photo-title').textContent='Plan '+a.id+' · '+a.name;root.querySelector('#photo-preview-title').textContent='Imagegen · '+a.id+' · '+preview.depthCm+' cm';
 for(const image of root.querySelectorAll('#plan-photo, #plan-photo-preview')){image.src=photo;image.alt=photoAlt;}root.querySelector('#photo-link').href=photo;
 root.querySelector('#plan-photo-source').src=source;root.querySelector('#plan-photo-source').alt='Current Plan '+a.id+' 3D source, '+preview.depthCm+' cm shelves, without a car';root.querySelector('#photo-source-link').href=source;
 for(const imagePlan of photoPlans){const link=root.querySelector('[data-photo-plan="'+imagePlan.id+'"]'),url=imagePlan.output+'?v='+imagePlan.outputSHA256.slice(0,12);link.href=url;link.querySelector('img').src=url;}
 root.querySelector('#garage-equipment').textContent=a.summary;
 root.querySelector('#garage-metrics').innerHTML='<span>Rear gap <strong>'+Math.round(a.frontGap*100)+' cm</strong></span><span>Rear system <strong>'+a.system+'</strong></span><span>Rear shelf surface <strong>'+shelfZones.reduce((s,z)=>s+z.area,0).toFixed(1)+' m²</strong></span><span>Left wall <strong>'+leftWallStats.existing+' ledges + '+leftWallStats.added+' added shelves</strong></span><span>Loft <strong>existing · '+loftStats.length.toFixed(1)+' m assumed length</strong></span>';
 const priceText=money(total)+' · products incl. VAT';root.querySelector('#garage-price').textContent=priceText;root.querySelector('#price-top').textContent=priceText;
 root.querySelector('#garage-unpriced').textContent='Prices checked '+data.priceDate+'. '+a.unpriced;
 root.querySelector('#left-capacity').textContent=leftWallStats.existing+' existing ledges retained; '+leftWallStats.added+' added shelf surfaces inside clear recesses ('+leftWallStats.area.toFixed(2)+' m² nominal surface). '+(a.recessMode==='cut'?'C uses fitted 53.5 × 20 cm boards: 11.5 cm beyond the studs.':'Stock APOTEKARE units are 50 × 18 × 52 cm: 9.5 cm beyond the studs, including a 5 mm installation allowance.');
 root.querySelector('#inventory-rows').innerHTML=data.inventory.map(i=>'<tr><td>'+i.name+'<br><small>'+i.count+'</small></td><td>'+i.evidence+'</td><td>'+i.storage+'</td></tr>').join('');
 root.querySelector('#comparison-rows').innerHTML=data.layouts.map(p=>'<tr'+(p===a?' class="selected-plan"':'')+'><td>'+p.id+' · '+p.name+'</td><td>'+Math.round(p.depth*100)+' cm</td><td>'+rearSurface(p).toFixed(1)+' m²</td><td>'+recessPlacements(p).length*(p.recessMode==='cut'?1:2)+' surfaces</td><td>'+((sideRuns(p).length+1)*1.18+2.4).toFixed(1)+' m</td><td>'+Math.round(p.frontGap*100)+' cm</td><td>'+money(shoppingList(p).reduce((s,r)=>s+r.qty*data.products[r.key].price,0))+'</td></tr>').join('');
 root.querySelector('#garage-products').innerHTML=rows.map(r=>{const p=data.products[r.key];return '<tr><td>'+productLink(r.key)+'<br><small>'+p.retailer+' · '+p.sku+'</small></td><td>'+r.qty+'</td><td>'+money(p.price)+'</td><td>'+money(r.qty*p.price)+'</td><td>'+r.use+'</td></tr>';}).join('');
}
