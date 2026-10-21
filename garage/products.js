// Selectable model objects. These studies do not claim a retail component list.
function register(meshes,key,meta={}){const id='object-'+objects.length;const record={id,key,meta,meshes};objects.push(record);for(const m of meshes)m.traverse(n=>{n.userData.objectId=id;});return record;}
function autoTag(){}
function capture(fn,key,meta,gear=false){const n=furnitureGroup.children.length;fn();const meshes=furnitureGroup.children.slice(n);register(meshes,key,meta);if(gear)equipmentMeshes.push(...meshes);}
function snowRacer(x){
 const before=furnitureGroup.children.length;snowRacerBase(x);const g=new T.Group();
 for(const m of furnitureGroup.children.slice(before))g.add(m);
 g.scale.y=1.3/1.38;furnitureGroup.add(g);
 register([g],null,{title:'Rattkjelke · one existing snow racer',kind:'existing',dimensions:[.60,.40,1.30],note:'One confirmed by you. Upright storage envelope is estimated; check the steering wheel and ski tips. Kept in a 71 cm clear rear slot with shelves above.'});equipmentMeshes.push(g);
}
function objectBounds(o){scene.updateMatrixWorld(true);const b=new T.Box3();for(const m of o.meshes)b.expandByObject(m);return b;}
function populateObjects(){
 const sel=root.querySelector('#object-list');sel.innerHTML='<option value="">Choose a shelf or object</option>';
 for(const o of objects){const op=document.createElement('option');op.value=o.id;op.textContent=o.meta.title;sel.append(op);}
 root.querySelector('#selection').innerHTML='<h2>Click a shelf.</h2><p>Inspect its size, height and assumptions.</p>';root.querySelector('#focus-item').disabled=true;
}
function selectObject(o){
 if(selectionBox){scene.remove(selectionBox);selectionBox.traverse(m=>{m.geometry?.dispose();});selectionBox=null;}
 selected=o||null;const panel=root.querySelector('#selection');root.querySelector('#focus-item').disabled=!o;root.querySelector('#object-list').value=o?.id||'';
 if(!o){panel.innerHTML='<h2>Click a shelf.</h2><p>Select an object to inspect its size and assumptions.</p>';render();return;}
 root.querySelector('#object-panel').open=true;
 const m=o.meta,kind=m.kind==='example'?'Example contents · provisional size':m.kind==='existing-storage'?'Existing storage · placement study':m.kind==='concept'?'Proposed storage · unpriced adaptations':'Existing equipment · estimated dimensions';
 let html='<h2>'+m.title+'</h2><p>'+kind+'</p>',rows=[];
 if(m.dimensions)rows.push([m.dimensionLabel||'Shown W × D × H',m.dimensions.map(v=>Number((v*100).toFixed(1))).join(' × ')+' cm']);
 if(m.height!==undefined)rows.push(['Above floor',Number((m.height*100).toFixed(1))+' cm']);
 if(m.projection!==undefined)rows.push(['Beyond stud faces',Math.round(m.projection*100)+' cm']);
 html+='<dl>'+rows.map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+v+'</dd></div>').join('')+'</dl>';
 if(m.note)html+='<p>'+m.note+'</p>';panel.innerHTML=html;
 selectionBox=new T.Group();selectionBox.scale.x=-1;const outline=new T.Box3Helper(objectBounds(o),0xc58639);outline.material.depthTest=false;outline.material.transparent=true;outline.material.opacity=.85;outline.renderOrder=100;selectionBox.add(outline);scene.add(selectionBox);render();
}
