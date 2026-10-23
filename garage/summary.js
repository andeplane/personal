function rearSurface(a){
 const racks=a.type==='bror'?a.rackCount*5*.84*.54:a.type==='transform'?a.rackCount*4*.9*a.depth:0;
 return (a.type==='mixed'?mixedRearSurface(a):racks)+rearBoards(a).length*1.18*.38;
}
function shoppingEntries(a){
 const rows=[];const add=(key,qty,use,zone)=>{if(qty)rows.push({key,qty,use,zone});};
 if(a.type==='bror')add('deep',a.rackCount,'Rear · all five supplied shelves per complete BROR unit','rear');
 if(a.type==='transform'){add('base80',1,'Rear · starter with four shelves','rear');add('extension80',1,'Rear · extension with four shelves','rear');}
 if(a.type==='mixed'){
  const p=mixedRearParts(a);
  add('rack80',1,'Rear · original 144.8 cm Adrian rack; three included shelf levels','rear');
  add('bayPlywood',2,'Rear fitted bay · CUT two '+Math.round((p.w-2*p.t)*1000)+' × 800 mm upper pieces and four '+Math.round(p.narrow*1000)+' × 800 mm small pieces; two 2440 × 1220 × 18 mm sheets, with 3 mm kerfs','rear');
  add('frameTimber',p.timberMetres,'Rear fitted bay · 48 × 48 mm timber, '+p.stock.length+' planned 4.8 m lengths; stock availability and cut plan shown in the product card. Quantity and unit price are per linear metre','rear');
 }
 const boards=leftBoardPlacements(a),supports=leftSupports(a);
 for(const key of ['pine20','pine28','pine38']){
  const n=boards.filter(p=>p.key===key).length;
  add(key,Math.ceil(n/2),'Left wall · CUT '+n+' blanks of 585 × '+Math.round(data.products[key].dimensions[1]*1000)+' × 18 mm; two per 1180 mm stock board (3 mm kerfs). Rear notches around intact timber. '+(n%2?'One spare blank. ':'')+'Measure every bay before cutting.','walls');
 }
 for(const key of ['bracket10','bracket20','bracket30'])add(key,supports.filter(s=>s.key===key).length,'Left wall · short leg outward, fixed to stud faces; shared at board joints','walls');
 add('pine28',Number(a.upperRight),'Right wall · uncut 118 × 28 cm extension; existing ski shelf retained','walls');
 add('bracket30',Number(a.upperRight)*3,'Right wall · three supports, 30 cm leg outward','walls');
 const rear=rearBoards(a).length;
 add('pine38',rear,'Rear · uncut 118 × 38 cm boards','rear');
 add('bracket30',rear*3,'Rear · three supports per uncut board','rear');
 return rows;
}
function shoppingList(a){
 const combined=new Map();for(const row of shoppingEntries(a)){const prior=combined.get(row.key);if(prior){prior.qty+=row.qty;prior.use+='; '+row.use;}else combined.set(row.key,{...row});}return [...combined.values()];
}
function updateComponentImages(){
 const c=configuration(),studies=data.imageStudies.filter(s=>Object.entries(s.match).every(([key,value])=>c[key]===value));
 root.querySelector('#component-images').innerHTML=studies.map(s=>{
  const p=photoPlans.find(p=>p.id===s.id);if(!p)return '';
  const photo=p.output+'?v='+p.outputSHA256.slice(0,12),source=p.source3D+'?v='+p.source3DHash.slice(0,12);
  return '<article class="component-study"><h3>'+s.label+'</h3><div class="photo-comparison"><figure><a href="'+source+'" target="_blank" rel="noopener"><img src="'+source+'" loading="lazy" width="2560" height="1600" alt="'+s.label+' · isolated 3D reference"></a><figcaption>3D source · this component only</figcaption></figure><figure><a href="'+photo+'" target="_blank" rel="noopener"><img src="'+photo+'" loading="lazy" width="2048" height="1280" alt="'+s.label+' · Imagegen component study"></a><figcaption>Imagegen · '+s.depthCm+' cm shelf depth</figcaption></figure></div></article>';
 }).join('')||'<p>No new storage selected. Existing ledges, ski shelf and loft remain visible in the model.</p>';
}
function updateTable(){
 const a=currentPlan(),rows=shoppingList(a),entries=shoppingEntries(a),total=rows.reduce((s,r)=>s+r.qty*data.products[r.key].price,0);
 const zoneTotal=zone=>entries.filter(r=>r.zone===zone).reduce((s,r)=>s+r.qty*data.products[r.key].price,0);
 root.querySelector('#wall-price').textContent=money(zoneTotal('walls'))+' · wall products';root.querySelector('#rear-price').textContent=money(zoneTotal('rear'))+' · rear products';
 root.querySelector('#garage-title').textContent='Walls + '+a.name.toLowerCase();root.querySelector('#garage-equipment').textContent='Existing loft, ledges and ski shelf retained. One sled and folded ladder; contents are illustrative.';
 root.querySelector('#rear-choice-note').textContent=a.summary;
 const recessText=a.recessMode==='none'?'Existing ledges retained.': 'Five aligned levels: 20 cm total depth at 15.8 / 49.8 / 83.8 / 117.8 cm, then 28 cm at 151.8 cm. Rear cut-outs use the recess without cutting the original timber. Lower projection 11.5 cm; upper ledge 19.5 cm.';
 root.querySelector('#recess-choice-note').textContent=recessText;
 root.querySelector('#garage-metrics').innerHTML='<span>Rear gap <strong>'+Math.round(a.frontGap*100)+' cm</strong></span><span>Rear shelf area <strong>'+rearSurface(a).toFixed(1)+' m²</strong></span><span>Built left shelves <strong>'+leftWallStats.area.toFixed(2)+' m²</strong></span><span>High left run <strong>'+leftWallStats.highLength.toFixed(2)+' m</strong></span>';
 const priceText=money(total)+' · products incl. VAT';root.querySelector('#garage-price').textContent=priceText;root.querySelector('#price-top').textContent=priceText;
 root.querySelector('#garage-unpriced').textContent='Prices checked '+data.priceDate+'. '+a.unpriced;
 root.querySelector('#left-capacity').textContent=leftWallStats.existing+' existing ledges retained; '+leftWallStats.added+' added surfaces ('+leftWallStats.area.toFixed(2)+' m²). '+recessText;
 const unconstrained=leftBoardPlacements({...a,footprintDepth:0}).length,omitted=unconstrained-leftBoardPlacements(a).length;
 root.querySelector('#combination-note').textContent=(omitted?omitted+' left shelf pieces omitted at the rear to avoid the selected rear storage. ':'Wall and rear selections stay independent. ')+'The wired charger and all structural timber stay. Only the cable hanger is proposed to move below the charger. '+(a.upperRuns?'38 cm high shelves sit at 184 cm: about 26 cm to the assumed loft underside; brackets extend down to 152 cm. ':'')+(a.upperRear&&!upperLevels().length?'High rear shelves omitted: insufficient assumed roof clearance.':'');
 root.querySelector('#inventory-rows').innerHTML=data.inventory.map(i=>'<tr><td>'+i.name+'<br><small>'+i.count+'</small></td><td>'+i.evidence+'</td><td>'+i.storage+'</td></tr>').join('');
 root.querySelector('#garage-products').innerHTML=rows.map(r=>{const p=data.products[r.key];return '<tr><td>'+productLink(r.key)+'<br><small>'+p.retailer+' · '+p.sku+'</small></td><td>'+r.qty+'</td><td>'+money(p.price)+'</td><td>'+money(r.qty*p.price)+'</td><td>'+r.use+'</td></tr>';}).join('');
 updateComponentImages();
}
