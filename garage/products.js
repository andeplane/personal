// Only verified purchase components are selectable. Existing room / belongings
// remain in the scene as context and cannot open an invented product card.
function register(meshes,key,meta={}){
 const id='object-'+objects.length,record={id,key,meta,meshes};objects.push(record);
 if(key){if(!data.products[key])throw new Error('Unknown product: '+key);for(const m of meshes)m.traverse(n=>{n.userData.objectId=id;});}
 return record;
}
function autoTag(){}
function capture(fn,key,meta,gear=false){const n=furnitureGroup.children.length;fn();const meshes=furnitureGroup.children.slice(n);register(meshes,key,meta);if(gear)equipmentMeshes.push(...meshes);}
function snowRacer(x,base=.128){
 const before=furnitureGroup.children.length;snowRacerBase(x);const g=new T.Group();
 for(const m of furnitureGroup.children.slice(before))g.add(m);
 g.scale.y=1.3/1.38;g.position.y=base;g.position.z=-data.layouts[current].standOff-.006;furnitureGroup.add(g);
 register([g],null,{title:'Rattkjelke · one existing snow racer',kind:'existing',dimensions:[.60,.40,1.30],note:'One existing sled, estimated upright envelope. Stored on the lowest shelf; the next shelf is above its ski tips.'});equipmentMeshes.push(g);
}
function objectBounds(o){scene.updateMatrixWorld(true);const b=new T.Box3();for(const m of o.meshes)b.expandByObject(m);return b;}
const productLink=(key,label)=>'<a href="'+data.products[key].url+'" target="_blank" rel="noopener">'+(label||data.products[key].name)+' ↗</a>';
function populateObjects(){
 const sel=root.querySelector('#object-list');sel.innerHTML='<option value="">Choose a product</option>';
 for(const o of objects.filter(o=>o.key)){const op=document.createElement('option');op.value=o.id;op.textContent=o.meta.title;sel.append(op);}
 root.querySelector('#selection').innerHTML='<h2>Click a storage product.</h2><p>Every selectable item has a retailer, SKU, price and direct buying link. Existing walls and belongings are context.</p>';root.querySelector('#focus-item').disabled=true;
}
function selectObject(o){
 if(selectionBox){scene.remove(selectionBox);selectionBox.traverse(m=>{m.geometry?.dispose();});selectionBox=null;}
 if(o&&!o.key)o=null;
 selected=o||null;const panel=root.querySelector('#selection');root.querySelector('#focus-item').disabled=!o;root.querySelector('#object-list').value=o?.id||'';
 if(!o){panel.innerHTML='<h2>Click a storage product.</h2><p>Choose a shelf, basket or rail for its price and purchase link.</p>';render();return;}
 root.querySelector('#object-panel').open=true;
 const m=o.meta,p=data.products[o.key],rows=[['Retailer / SKU',p.retailer+' · '+p.sku],['Price incl. VAT',(p.priceQualifier?'From ':'')+money(p.price)+(p.packSize?' / '+p.packSize+' pack':' / item')],['Retail dimensions',p.dimensionsText||p.dimensions.map(v=>Number((v*100).toFixed(1))).join(' × ')+' cm']];
 if(m.dimensions)rows.push([m.dimensionLabel||'Model W × D × H',m.dimensions.map(v=>Number((v*100).toFixed(1))).join(' × ')+' cm']);
 if(m.height!==undefined)rows.push(['Above floor',Number((m.height*100).toFixed(1))+' cm']);
 if(m.projection!==undefined)rows.push(['Beyond stud faces',Number((m.projection*100).toFixed(1))+' cm']);
 panel.innerHTML='<h2>'+m.title+'</h2><p class="purchase-link">'+productLink(o.key,'View / buy at '+p.retailer)+'</p><dl>'+rows.map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+v+'</dd></div>').join('')+'</dl><p>'+p.note+'</p>'+(m.note?'<p>'+m.note+'</p>':'')+'<p class="fine">Price checked '+p.checked+'. '+p.availability+'. Shipping is extra where applicable.</p>';
 selectionBox=new T.Group();selectionBox.scale.x=-1;const outline=new T.Box3Helper(objectBounds(o),0xc58639);outline.material.depthTest=false;outline.material.transparent=true;outline.material.opacity=.85;outline.renderOrder=100;selectionBox.add(outline);scene.add(selectionBox);render();
}
