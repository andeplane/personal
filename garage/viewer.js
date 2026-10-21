import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';


 const root=document.getElementById('garage-options');
 const data=await (await fetch('./design-data.json',{cache:'no-store'})).json();
 const host=root.querySelector('#garage-scene');
 const  W=data.room.width,L=data.room.length,H=data.room.loftUnderside;
 let current=1, view='overview', scene,camera,carGroup,loftGroup, furnitureGroup;
 const renderer=new T.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.outputColorSpace=T.SRGBColorSpace;
 host.replaceChildren(renderer.domElement); renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
 const pmrem=new T.PMREMGenerator(renderer), environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;
 let controls,composer,ao,selected=null,selectionBox,objects=[],equipmentMeshes=[],dimensionGroup,bikeGroup;
 const render=()=>{if(composer)composer.render();else if(scene&&camera)renderer.render(scene,camera);};
 let materials={},labels=[];
 function oldToken(name){const probe=document.createElement('span');probe.style.color='var('+name+')';root.append(probe);const c=getComputedStyle(probe).color;probe.remove();return c;}
 const palette={wood:'#cbaa76',metal:'#3d4747',floor:'#adada6',white:'#f1f0e8',glass:'#425963',bin:'#d1ddd6',gear:'#566548',rubber:'#242b2b',accent:'#7b3f38',background:'#fafbf6',foreground:'#25493c'};
 function token(name){return palette[name.replace('--garage-','').replace('--','')]||'#315845';}
 let seed=42;function random(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;}
 function texture(kind){const c=document.createElement('canvas');c.width=256;c.height=kind==='wood'?1024:256;const ctx=c.getContext('2d'),im=ctx.createImageData(c.width,c.height);let stripes=Array.from({length:256},()=>random());
 for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;let n=random();let v=kind==='wood'?200+Math.sin(x*.63+Math.sin(y*.007)*2)*4+stripes[x]*8+n*3:kind==='fabric'?150+(x%3===0?20:0)+(y%3===0?18:0)+n*12:192+n*16;im.data[i]=v;im.data[i+1]=kind==='wood'?v*.87:v;im.data[i+2]=kind==='wood'?v*.68:v;im.data[i+3]=255;}ctx.putImageData(im,0,0);
 if(kind==='wood'){for(let k=0;k<4;k++){let x=30+random()*196,y=random()*1024;ctx.save();ctx.translate(x,y);ctx.scale(.65,2.7);for(let r=4;r<25;r+=3){ctx.strokeStyle='rgba(76,42,20,'+(0.12-r*.002)+')';ctx.beginPath();ctx.ellipse(0,0,r,r*.75,0,0,Math.PI*2);ctx.stroke();}ctx.restore();}}
 const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.colorSpace=T.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;}
 const woodMap=texture('wood'),floorMap=texture('floor'),fabricMap=texture('fabric');floorMap.repeat.set(3,6);fabricMap.repeat.set(6,9);
 function mat(key){const p={color:palette[key],roughness:.7,metalness:0,envMapIntensity:.45};if(key==='wood'){p.color='#f4d5a7';p.map=woodMap;p.bumpMap=woodMap;p.bumpScale=.002;p.roughness=.88;}if(key==='floor'){p.map=floorMap;p.bumpMap=floorMap;p.bumpScale=.0003;p.roughness=.96;}if(key==='white'){p.roughness=.32;p.metalness=.18;p.envMapIntensity=.6;}if(key==='metal'){p.roughness=.34;p.metalness=.72;}if(key==='bin'){p.roughness=.24;p.metalness=.05;}if(key==='glass'){p.roughness=.13;p.metalness=.45;}return new T.MeshStandardMaterial(p);}
 function fabricMaterial(key){const m=materials[key].clone();m.map=fabricMap;m.bumpMap=fabricMap;m.bumpScale=.003;m.roughness=.97;return m;}
 function box(w,h,d,x,y,z,m,parent=scene){const mesh=new T.Mesh(new RoundedBoxGeometry(w,h,d,2,Math.min(.006,Math.min(w,h,d)*.18)),typeof m==='string'?materials[m]:m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh); autoTag(mesh,w,h,d,x,y,z,m,parent);return mesh;}
 function rod(a,b,r,m,parent=scene){const v1=new T.Vector3(...a),v2=new T.Vector3(...b),dir=v2.clone().sub(v1);const mesh=new T.Mesh(new T.CylinderGeometry(r,r,dir.length(),16),materials[m]);mesh.position.copy(v1.add(v2).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),dir.normalize());mesh.castShadow=true;parent.add(mesh);return mesh;}
 function line(a,b,color=token('--garage-accent'),parent=scene){const g=new T.BufferGeometry().setFromPoints([new T.Vector3(...a),new T.Vector3(...b)]);const l=new T.Line(g,new T.LineBasicMaterial({color}));parent.add(l);return l;}
 function label(text,pos,width=1.2,parent=scene){const c=document.createElement('canvas');c.width=768;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=token('--background');ctx.globalAlpha=.92;ctx.fillRect(0,0,768,128);ctx.globalAlpha=1;ctx.fillStyle=token('--foreground');ctx.font='500 80px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,384,64);const tex=new T.CanvasTexture(c);const s=new T.Sprite(new T.SpriteMaterial({map:tex,depthTest:false}));s.position.set(...pos);s.scale.set(width,width/6,1);s.renderOrder=20;parent.add(s);labels.push(s);return s;}
 function dimension(a,b,text,pos,width=1){line(a,b);let dv=new T.Vector3(...b).sub(new T.Vector3(...a)).normalize();const tick=dv.y?new T.Vector3(.07,0,0):new T.Vector3(0,.06,0);for(const p of [a,b]){line(new T.Vector3(...p).sub(tick).toArray(),new T.Vector3(...p).add(tick).toArray());}label(text,pos,width);}
 function brorBase(x,w,d,levels,height=1.9){for(const xx of [x-w/2+.016,x+w/2-.016])for(const zz of [L-d+.016,L-.016])box(.032,height,.032,xx,height/2,zz,'metal',furnitureGroup);for(const y of levels)box(w-.01,.05,d-.01,x,y-.025,L-d/2,'metal',furnitureGroup);rod([x-w/2,0.1,L-.02],[x+w/2,height-.05,L-.02],.006,'metal',furnitureGroup);rod([x+w/2,0.1,L-.02],[x-w/2,height-.05,L-.02],.006,'metal',furnitureGroup);}
 function makeCar(){carGroup=new T.Group();scene.add(carGroup);const cx=data.car.centerX,cz=data.car.entranceGap+data.car.length/2;
 function hull(rings,m){const arr=[],indices=[];const contour=[[-1,0],[-1,.72],[-.84,1],[.84,1],[1,.72],[1,0]];for(const [z,w,b,t] of rings)for(const [x,v] of contour)arr.push(cx+x*w,b+v*(t-b),cz+z);for(let i=0;i<rings.length-1;i++)for(let k=0;k<6;k++){let a=i*6+k,b=i*6+(k+1)%6,c=b+6,d=a+6;indices.push(a,b,d,b,c,d);}for(let k=1;k<5;k++){indices.push(0,k+1,k);let o=(rings.length-1)*6;indices.push(o,o+k,o+k+1);}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(arr,3));g.setIndex(indices);g.computeVertexNormals();const mm=materials[m].clone();mm.side=T.DoubleSide;const mesh=new T.Mesh(g,mm);mesh.castShadow=true;mesh.receiveShadow=true;carGroup.add(mesh);}
 hull([[-2.3985,.72,.32,.83],[-2.18,.9,.22,1.02],[-1.4,.96,.19,1.03],[.7,.96,.19,1.03],[1.65,.94,.26,.91],[2.25,.82,.32,.76],[2.3985,.68,.36,.72]],'white');
 hull([[-1.95,.74,.94,1.04],[-1.1,.79,1.02,1.48],[-.55,.77,1.03,1.624],[.45,.73,1.03,1.59],[1.25,.80,.99,1.03]],'glass');
 for(const z of [-1.445,1.445])for(const x of [-.82,.82]){let wheel=new T.Mesh(new T.CylinderGeometry(.35,.35,.245,36),materials.rubber);wheel.rotation.z=Math.PI/2;wheel.position.set(cx+x,.35,cz+z);wheel.castShadow=true;carGroup.add(wheel);let hub=new T.Mesh(new T.CylinderGeometry(.225,.225,.252,24),materials.metal);hub.rotation.z=Math.PI/2;hub.position.copy(wheel.position);carGroup.add(hub);}
 for(const sign of [-1,1])box(.062,.1,.18,cx+sign*(data.car.foldedWidth/2-.031),1.06,cz+.75,'metal',carGroup);
 box(1.30,.028,.015,cx,.74,cz+2.392,'white',carGroup);box(1.3,.032,.018,cx,.83,cz-2.393,'gear',carGroup);
 // Dashed footprint encloses official folded-mirror width and full length.
 const p=[[-.991,-2.3985],[.991,-2.3985],[.991,2.3985],[-.991,2.3985],[-.991,-2.3985]].map(([x,z])=>new T.Vector3(cx+x,.02,cz+z));const geom=new T.BufferGeometry().setFromPoints(p);const env=new T.Line(geom,new T.LineDashedMaterial({color:token('--garage-accent'),dashSize:.10,gapSize:.06}));env.computeLineDistances();carGroup.add(env);carGroup.visible=root.querySelector('#garage-car').checked;
 }

 function snowRacerBase(x){
  // One upright snow racer: conservative 0.60 W × 0.40 D × 1.30 H envelope.
  const z=L-.22;
  for(const dx of [-.245,.245]){box(.08,1.08,.04,x+dx,.84,z+.13,'metal',furnitureGroup);rod([x+dx,.3,z+.11],[x+dx,1.34,z-.12],.018,'metal',furnitureGroup);}
  for(const y of [.50,1.10])rod([x-.245,y,z-.04],[x+.245,y,z-.04],.018,'metal',furnitureGroup);
  box(.21,.63,.09,x,1.04,z-.07,'rubber',furnitureGroup);
  box(.10,.36,.045,x,.30,z-.14,'metal',furnitureGroup);
  const wheel=new T.Mesh(new T.TorusGeometry(.13,.018,8,28),materials.metal);wheel.position.set(x,.58,z-.16);furnitureGroup.add(wheel);
  for(const xx of [x-.20,x+.20]){rod([xx,1.28,L-.01],[xx,1.28,L-.24],.0125,'metal',furnitureGroup);rod([xx,1.28,L-.24],[xx,1.34,L-.24],.0125,'metal',furnitureGroup);}
  box(.55,.025,.01,x,1.05,z-.18,'accent',furnitureGroup);
 }
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
 // Typical adult hybrid-bike planning proxies, not measured user bikes.
 // Bike: 1.80 m long × 0.65 m handlebar width × 1.10 m high.
 function makeBikes(){bikeGroup=new T.Group();scene.add(bikeGroup);const spacing=Number(root.querySelector('#bike-spacing').value)/100,depth=.65+2*spacing;const end=L-(data.layouts[current].bikeBlockingDepth??data.layouts[current].depth)-.05,start=end-depth;
 for(let i=0;i<3;i++){const g=new T.Group();bikeGroup.add(g);g.position.set(W/2+(i===2?.15:0),0,start+.325+i*spacing);g.rotation.y=i===1?-Math.PI/2:Math.PI/2;g.userData.bikeIndex=i;const frame=materials.metal.clone();frame.color.set(['#47756d','#b36b39','#546880'][i]);const metal=new T.MeshStandardMaterial({color:'#b9c4c7',metalness:.8,roughness:.3});
 const tube=(a,b,r=.018,mat=frame)=>{const va=new T.Vector3(...a),vb=new T.Vector3(...b),v=vb.clone().sub(va);const m=new T.Mesh(new T.CylinderGeometry(r,r,v.length(),12),mat);m.position.copy(va.add(vb).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());m.castShadow=true;g.add(m);};
 for(const z of [-.55,.55]){const wheel=new T.Mesh(new T.TorusGeometry(.326,.024,10,56),materials.rubber);wheel.rotation.y=Math.PI/2;wheel.position.set(0,.35,z);wheel.castShadow=true;g.add(wheel);const rim=new T.Mesh(new T.TorusGeometry(.304,.008,8,48),metal);rim.rotation.y=Math.PI/2;rim.position.copy(wheel.position);g.add(rim);for(let k=0;k<20;k++){const a=k/20*Math.PI*2;tube([0,.35,z],[0,.35+Math.sin(a)*.3,z+Math.cos(a)*.3],.0015,metal);}}
 const rear=[0,.35,-.55],bb=[0,.30,-.12],seat=[0,.78,-.22],head=[0,.77,.40],front=[0,.35,.55];for(const [a,b] of [[rear,bb],[rear,seat],[bb,seat],[seat,head],[bb,head],[head,front]])tube(a,b);tube(seat,[0,.97,-.25],.013,metal);tube(head,[0,1.075,.36],.014,metal);tube([-.325,1.075,.36],[.325,1.075,.36],.012,metal);
 for(const x of [-.275,.275])tube([x-.05,1.075,.36],[x+.05,1.075,.36],.025,materials.rubber);
 box(.18,.045,.25,0,.978,-.27,'rubber',g);tube([-.13,.3,-.12],[.13,.3,-.12],.01,metal);box(.08,.025,.10,-.16,.3,-.12,'rubber',g);box(.08,.025,.1,.16,.3,-.12,'rubber',g);
 register(g.children.filter(m=>m.isMesh),null,{title:'Bike '+(i+1)+' · adult hybrid estimate',dimensions:[1.80,.65,1.10],note:'Turned 90 degrees across the garage. Alternating directions, with bike 3 offset 15 cm across the room to stagger handlebars. Shown dimensions follow garage axes. Original bike size: 180 cm long × 65 cm handlebars × 110 cm high. Nesting is a planning approximation: verify pedals, bars and brake cables against your actual bikes.'});}
 const overlap=Math.max(0,data.car.entranceGap+data.car.length-start);if(overlap>0){const red=new T.MeshStandardMaterial({color:'#c44d34',transparent:true,opacity:.30,depthWrite:false});box(1.92,.012,overlap,data.car.centerX,.016,start+overlap/2,red,bikeGroup);}
 const outline=new T.Box3Helper(new T.Box3(new T.Vector3(W/2-.9,0,start),new T.Vector3(W/2+1.05,1.1,end)),0xb38345);bikeGroup.add(outline);
 const panel=root.querySelector('#bike-status');panel.innerHTML='<h3>Three bikes · nested sideways</h3><p>Each bike: <strong>180 × 65 × 110 cm</strong> (L × W × H), estimated. Alternating directions; third bike staggered 15 cm across the garage.</p><p>Packed group: <strong>195 cm across × '+Math.round(depth*100)+' cm deep</strong> at '+Math.round(spacing*100)+' cm between wheel planes. Plus 5 cm to the rear shelves.</p><p>Current floor-level rear gap: <strong>'+Math.round(data.layouts[current].frontGap*100)+' cm</strong>. '+(overlap>0?'This setting extends <strong>'+Math.round(overlap*100)+' cm into the car’s rectangular envelope</strong> (red area).':'The group envelope clears the parked-car envelope at this setting.')+'</p><p class="fine">This optional packing study is not part of the default storage allocation. Actual nesting, access and the loft approach need checking; three bicycles are not claimed to fit with the parked car.</p>';
 root.querySelector('#bike-spacing-value').textContent=Math.round(spacing*100)+' cm';
 }
 root.querySelector('#bike-spacing').addEventListener('input',()=>{const old=bikeGroup;const oldIds=new Set();old.traverse(m=>{if(m.userData.objectId)oldIds.add(m.userData.objectId);});selectObject(null);objects=objects.filter(o=>!oldIds.has(o.id));scene.remove(old);old.traverse(m=>{if(m.geometry)m.geometry.dispose();});makeBikes();populateObjects();applyVisibility();});
// Keep the right wall shallow below head level, and reuse its high ski shelf.
function rightWall(){
 capture(()=>{
  box(.3,.018,2.4,W-.15,1.941,3.35,'wood',furnitureGroup);
  for(const z of [2.25,2.98,3.71,4.45]){
   box(.025,.20,.025,W-.015,1.832,z,'metal',furnitureGroup);
   box(.30,.018,.025,W-.15,1.923,z,'metal',furnitureGroup);
   rod([W-.02,1.732,z],[W-.28,1.915,z],.009,'metal',furnitureGroup);
  }
 },null,{title:'Right wall · existing high ski shelf',kind:'existing-storage',side:'right',dimensions:[2.4,.3,.218],dimensionLabel:'Along wall × projection × shelf/support height',height:1.95,note:'Reuse the existing shelf visible in the photos. The model estimates 240 cm length, 30 cm depth and 195 cm top height. Preserve clearance to the door track and the loft; actual location / dimensions are unmeasured.'});
 capture(()=>{
  box(.025,.68,1.35,W-.015,1.24,1.16,'metal',furnitureGroup);
  for(const z of [.65,.92,1.19,1.46,1.73])rod([W-.03,1.4,z],[W-.10,1.4,z],.006,'metal',furnitureGroup);
 },null,{title:'Right wall · shallow tool strip',kind:'concept',side:'right',dimensions:[1.35,.11,.68],dimensionLabel:'Along wall × maximum projection × height',height:.90,note:'An optional shallow board / rail for small tools and accessories near the entrance. Keep the main walking route on the left. Hook selection and exact placement are unpriced.'});
 capture(()=>{
  box(.055,.35,.30,W-.085,.20,1.65,'rubber',furnitureGroup);
  rod([W-.085,.32,1.65],[W-.085,1.50,1.65],.016,'wood',furnitureGroup);
  rod([W-.085,1.50,1.56],[W-.085,1.50,1.74],.018,'rubber',furnitureGroup);
 },null,{title:'Existing snow shovel / long tool · estimated envelope',side:'right',dimensions:[.32,.12,1.55],dimensionLabel:'Along wall × projection × height',note:'Long-tool example for the observed equipment category, using a shallow wall position. Exact shape, length and placement are unmeasured.'},true);
 for(const z of [2.6,3.2,4.15,4.95])capture(()=>rod([W-.01,1.5,z],[W-.08,1.5,z],.01,'metal',furnitureGroup),null,{title:'Right wall · folded-gear mounting point',kind:'concept',height:1.5,note:'Retain / adapt existing hooks and straps. About 15 cm total folded-gear projection is assumed; actual gear and fixing locations need checking.'});
 for(const z of [2.6,3.2])capture(()=>{
  box(.08,.47,.4,W-.095,1.05,z,'rubber',furnitureGroup);
  for(const zz of [z-.22,z+.22])rod([W-.14,.5,zz],[W-.14,1.5,zz],.014,'metal',furnitureGroup);
  for(const y of [.5,1.5])rod([W-.14,y,z-.22],[W-.14,y,z+.22],.014,'metal',furnitureGroup);
 },null,{title:'Existing folding chair',side:'right',dimensions:[.5,.16,1],dimensionLabel:'Along wall × projection × height',note:'Provisional folded size. Separate places avoid stacking the chairs farther into the garage.'},true);
 capture(()=>{
  for(const z of [3.94,4.36])rod([W-.10,.05,z],[W-.10,1.95,z],.022,'white',furnitureGroup);
  for(let y=.18;y<1.9;y+=.26)rod([W-.10,y,3.94],[W-.10,y,4.36],.02,'white',furnitureGroup);
 },null,{title:'Existing stepladder / gardintrapp',side:'right',dimensions:[.5,.15,1.9],dimensionLabel:'Along wall × projection × height',note:'Accessible folded wall position; estimated dimensions. This is not a specified loft-access ladder.'},true);
 capture(()=>{
  box(.07,1.25,.75,W-.05,.65,4.92,'white',furnitureGroup);
  box(.009,.03,.76,W-.095,1.05,4.92,'accent',furnitureGroup);
 },null,{title:'Existing folding table',side:'right',dimensions:[.76,.10,1.25],dimensionLabel:'Along wall × projection × height',note:'Estimated folded envelope. Removable straps keep the table shallow and accessible.'},true);
 capture(()=>{for(let i=0;i<2;i++)box(.055,.025,2.15,W-.10-i*.09,1.9675,3.35,'gear',furnitureGroup);},null,{title:'Right shelf · existing ski bundle',side:'right',dimensions:[2.15,.20,.025],dimensionLabel:'Along wall × depth × height',note:'Illustrative bundle only; ski lengths and quantities are unmeasured.'},true);
}
// Illustrative mixed contents, not an inventory count or a claim that all belongings fit.
function exampleContents(){
 const examples=[
  {title:'Rucksack lying down · example',kind:'pack',size:[.66,.30,.25],colour:'gear'},
  {title:'Small backpack · example',kind:'pack',size:[.32,.22,.45],colour:'accent'},
  {title:'Soft sports bag · example',kind:'bag',size:[.46,.28,.25],colour:'rubber'},
  {title:'Compressed bag · example',kind:'bag',size:[.34,.22,.18],colour:'gear'},
  {title:'Ice skates · example pair',kind:'skates',size:[.28,.31,.28]},
  {title:'Ski boots / winter footwear · example pair',kind:'boots',size:[.28,.31,.34]},
  {title:'Small bags / accessories · example',kind:'bag',size:[.29,.22,.20],colour:'accent'},
  {title:'Rolled long bag · example',kind:'roll',size:[.52,.16,.16],colour:'gear'},
  {title:'Maintenance supplies · example',kind:'supplies',size:[.24,.15,.22]}
 ];
 const available=shelfZones.filter(z=>z.clear>.13).map(z=>({...z}));
 for(const item of examples){
  const [w,d,h]=item.size;
  // Prefer a suitable opening; leave other bays open for changing / future belongings.
  const candidates=available.filter(z=>z.width>w+.02&&z.depth>d+.01&&z.clear>h+.015);
  candidates.sort((a,b)=>(a.clear-h)*2+(a.width-w)-((b.clear-h)*2+(b.width-w)));
  const slot=candidates[0];if(!slot)continue;available.splice(available.indexOf(slot),1);
  const px=slot.x-slot.width/2+w/2+.01;
  const remainder=slot.width-w-.06;
  if(remainder>.16)available.push({...slot,x:slot.x+(w+.06)/2,width:remainder});
  const group=new T.Group(),mat=fabricMaterial(item.colour||'rubber');
  const soft=(ww,hh,dd,x,y,z,m=mat)=>{const mesh=new T.Mesh(new RoundedBoxGeometry(ww,hh,dd,3,Math.min(.035,ww/5,hh/5,dd/5)),m);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);};
  if(item.kind==='skates'||item.kind==='boots'){
   for(const x of [-w/4,w/4]){
    soft(w*.42,.075,d*.9,x,.06,0);
    soft(w*.39,h-.08,d*.5,x,(h+.08)/2,d*.18,item.kind==='boots'?materials.white:mat);
    if(item.kind==='skates'){
     soft(.012,.018,d*.85,x,.009,0,materials.metal);
     for(const zz of [-d*.27,d*.27])soft(.025,.025,.025,x,.03,zz,materials.metal);
    }
    for(const y of [h*.45,h*.67])soft(w*.43,.012,.015,x,y,-d*.08,materials.metal);
   }
  }else if(item.kind==='supplies'){
   for(const [i,hh] of [.15,.21,.18].entries())soft(.065,hh,.08,(i-1)*.08,hh/2,0,materials.white);
  }else{
   soft(w*.96,h*.92,d*.94,0,h/2,0);
   if(item.kind==='pack'){
    soft(w*.55,h*.34,d*.08,0,h*.42,-d*.47);
    for(const x of [-w*.2,w*.2])soft(.017,h*.65,.008,x,h*.52,-d*.49,materials.rubber);
   }else if(item.kind==='bag'){
    for(const x of [-w*.2,w*.2])soft(.015,h*.65,.009,x,h*.52,-d*.47,materials.rubber);
   }
  }
  group.position.set(px,slot.y+.003,L-slot.depth+d/2+.005);
  furnitureGroup.add(group);
  register([group],null,{title:item.title,kind:'example',dimensions:item.size,height:slot.y,note:'Representative size only; not a measurement of your belongings or a fixed quantity. Mixed packed / compressed bags can stand, lie down or hang. Remaining space is intentionally unallocated.'});equipmentMeshes.push(group);
 }
}
// The bay opening is measured. Whole-wall positions / brace locations remain a photo-based study.
let leftWallStats={existing:0,added:0,baskets:0,area:0,basketLitres:0};
function leftWallBays(){
 const wall=data.leftWall,bays=[];
 const pitch=wall.clearWidth+wall.studWidth;
 for(let z=wall.firstStud;z+pitch+wall.studWidth/2<L;z+=pitch){
  const start=z+wall.studWidth/2,end=start+wall.clearWidth;
  bays.push({start,end,center:(start+end)/2,width:wall.clearWidth});
 }
 return bays;
}
function leftWallBraceAt(brace,z){return brace[0][1]+(brace[1][1]-brace[0][1])*(z-brace[0][0])/(brace[1][0]-brace[0][0]);}
function leftWallBraceCrosses(bay,y,clearance=.06){
 return data.leftWall.braces.some(b=>{
  const a=Math.max(bay.start,Math.min(b[0][0],b[1][0])),c=Math.min(bay.end,Math.max(b[0][0],b[1][0]));
  if(a>c)return false;
  const ya=leftWallBraceAt(b,a),yc=leftWallBraceAt(b,c);
  return y>=Math.min(ya,yc)-clearance&&y<=Math.max(ya,yc)+clearance;
 });
}
function leftWallFrame(){
 const wall=data.leftWall,d=wall.recessDepth,pitch=wall.clearWidth+wall.studWidth;
 const group=new T.Group();group.userData.wall='left';scene.add(group);
 for(let i=0;i<43;i++){
  const len=L/43,z=(i+.5)*len,hh=H+(storageHeight()-H)*Math.max(0,(z-4)/(L-4)),mat=materials.wood.clone();mat.color.multiplyScalar(.92+random()*.15);
  box(.034,hh,len-.003,-d-.017,hh/2,z,mat,group);
 }
 for(let z=wall.firstStud;z<L;z+=pitch)box(d,H,wall.studWidth,-d/2,H/2,z,'wood',group);
 // Braces are retained whole. Added shelf inserts skip their path rather than cutting through them.
 for(const ends of wall.braces){
  const [a,b]=ends,dy=b[1]-a[1],dz=b[0]-a[0],length=Math.hypot(dy,dz);
  const mesh=new T.Mesh(new RoundedBoxGeometry(d*.8,length,.065,2,.003),materials.wood);
  mesh.position.set(-d/2,(a[1]+b[1])/2,(a[0]+b[0])/2);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(0,dy,dz).normalize());
  mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
  register([mesh],null,{title:'Left wall · retained diagonal brace',kind:'existing-storage',side:'left',note:'Existing bracing is visible in the new photos. Its placement is schematic; the shelf inserts skip its path. No brace is removed, notched or altered.'});
 }
}
function leftWallStorage(){
 const wall=data.leftWall,d=wall.recessDepth,bays=leftWallBays(),group=new T.Group();group.userData.wall='left';furnitureGroup.add(group);
 leftWallStats={existing:0,added:0,baskets:0,area:0,basketLitres:0};
 const charger=wall.chargerZone;
 const overlapsCharger=b=>b.end>charger[0]&&b.start<charger[1];
 const rearLimit=L-data.layouts[current].depth-.04;
 const addition=root.querySelector('#garage-left-inserts').checked;
 const note='Measured representative opening: 54.5 cm across × 63.5 cm clear height. Recess depth about 9 cm, read from IMG_0750. Bay count, floor heights, brace and charger positions are schematic from the photos. Verify each actual bay before cutting shelves.';
 function captureInWall(fn,meta){const n=group.children.length;fn();const meshes=group.children.slice(n);register(meshes,null,meta);return meshes;}
 for(const [index,bay] of bays.entries()){
  for(const y of wall.ledgeTops){
   captureInWall(()=>box(d,.045,bay.width,-d/2,y-.0225,bay.center,'wood',group),{
    title:'Left wall · existing ledge '+(index+1)+' / '+Math.round(y*100)+' cm',kind:'existing-storage',side:'left',dimensions:[bay.width,d,.045],dimensionLabel:'Along wall × recess depth × thickness',height:y,note
   });
   leftWallStats.existing++;
  }
  // Keep all charging equipment / cable handling space and bays masked by rear storage unallocated.
  if(overlapsCharger(bay)||bay.end>rearLimit)continue;
  if(root.querySelector('#garage-left-baskets').checked)leftWallBasket(bay,index,group,captureInWall);
  if(!addition)continue;
  for(let row=0;row<wall.ledgeTops.length;row++){
   const lower=wall.ledgeTops[row],upper=row+1<wall.ledgeTops.length?wall.ledgeTops[row+1]-.045:H-.045;
   const y=(lower+upper)/2;
   if(upper-lower<.3||leftWallBraceCrosses(bay,y))continue;
   const inset=.006,width=bay.width-2*inset,depth=d-.008;
   captureInWall(()=>{
    box(depth,.018,width,-d/2,y-.009,bay.center,'wood',group);
    // Small front lip stays within the stud-face line x=0.
    box(.008,.018,width,-.008,y+.009,bay.center,'wood',group);
   },{title:'Left wall · added shallow shelf '+(index+1)+' / '+Math.round(y*100)+' cm',kind:'concept',side:'left',dimensions:[width,depth,.018],dimensionLabel:'Along wall × shelf depth × thickness',height:y,note:note+' Proposed removable insert with a retaining lip. Keep its front behind the stud faces. Fixings / loading and material quantity remain to be specified; no building brace is altered.'});
   leftWallStats.added++;leftWallStats.area+=width*depth;
  }
 }
 // Show a few small accessories on the existing ledges without allocating every recess to specific items.
 const exampleBay=bays.find(b=>!overlapsCharger(b)&&b.end<rearLimit&&!leftWallBraceCrosses(b,wall.ledgeTops[1]+.1,.12));
 if(exampleBay){
  const y=wall.ledgeTops[1],n=group.children.length;
  for(const [i,h] of [.15,.18,.13].entries()){
   const mesh=new T.Mesh(new T.CylinderGeometry(.026,.026,h,16),materials.white);mesh.position.set(-d/2,y+h/2+.002,exampleBay.center-.13+i*.12);mesh.castShadow=true;group.add(mesh);
   box(.022,.018,.022,-d/2,y+h+.011,exampleBay.center-.13+i*.12,'rubber',group);
  }
  const meshes=group.children.slice(n);
  register(meshes,null,{title:'Left recess · small supplies example',kind:'example',side:'left',dimensions:[.35,.052,.22],dimensionLabel:'Along wall × depth × height',height:y,note:'Illustrative small bottles / accessories. Left-wall recesses are shallow storage; no box, bag or footwear count is assumed.'});equipmentMeshes.push(...meshes);
 }
 // Existing charger and hanging cable loop remain visible as a reserved area in the left-wall view.
 const cx=.065,cz=(charger[0]+charger[1])/2+.18;
 captureInWall(()=>{
  box(.12,.32,.19,cx,1.13,cz,'rubber',group);
  const c=new T.CatmullRomCurve3([new T.Vector3(.10,1.04,cz),new T.Vector3(.10,.40,cz-.12),new T.Vector3(.10,.40,cz-.70),new T.Vector3(.10,1.30,cz-.75),new T.Vector3(.10,1.35,cz-.36),new T.Vector3(.10,.58,cz-.46)]);
  const cable=new T.Mesh(new T.TubeGeometry(c,48,.014,8,false),materials.rubber);group.add(cable);
 },{title:'Left wall · existing charger / cable space',kind:'existing-storage',side:'left',note:'Observed in IMG_0754 and IMG_0758. Keep this zone open for the charger, cable loop and handling. The model placement is approximate; new shelves are excluded from the whole reserved span.'});
}
function leftWallBasket(bay,index,group,captureInWall){
 const bottom=Number(root.querySelector('#basket-clearance').value)/100;
 const projection=Number(root.querySelector('#basket-projection').value)/100;
 const belowLoft=bay.start<loftStats.length;
 const roof=H+(storageHeight()-H)*Math.max(0,(bay.start-4)/(L-4));
 const limit=belowLoft?H:roof;
 const height=Math.min(.25,limit-.02-bottom),top=bottom+height;
 const braced=leftWallBraceCrosses(bay,(top+bottom)/2,height/2+.045);
 // In a braced opening the basket sits in front of the brace, without cutting it.
 const rear=braced?.008:-data.leftWall.recessDepth+.006,front=projection,width=bay.width-.02,depth=front-rear;
 if(height<.06||depth<.065)return;
 const z0=bay.center-width/2,z1=bay.center+width/2,r=.003;
 captureInWall(()=>{
  for(const y of [bottom+r,top-r]){
   for(const z of [z0+r,z1-r])rod([rear+r,y,z],[front-r,y,z],r,'metal',group);
   for(const x of [rear+r,front-r])rod([x,y,z0+r],[x,y,z1-r],r,'metal',group);
  }
  for(let z=z0+.025;z<z1-.01;z+=.065){
   rod([rear+r,bottom+r,z],[front-r,bottom+r,z],.002,'metal',group);
   for(const x of [rear+r,front-r])rod([x,bottom+r,z],[x,top-r,z],.002,'metal',group);
  }
  for(const z of [z0+r,z1-r])for(const x of [rear+r,front-r])rod([x,bottom+r,z],[x,top-r,z],r,'metal',group);
 },{title:'Left wall · high basket '+(index+1),kind:'concept',side:'left',dimensions:[width,depth,height],dimensionLabel:'Along wall × basket depth × height',height:bottom,projection,basket:true,note:'Removable wire basket / retaining tray concept. '+Math.round(projection*100)+' cm maximum projection beyond the stud faces; '+Math.round(bottom*100)+' cm clear below. '+(braced?'This bay is braced, so the basket uses only the shallow space in front of the brace.':'The basket uses the recess plus a modest projection.')+' Keep contents within its rim. Charger and rear-rack spans are excluded. Fixings and load capacity are unspecified.'});
 leftWallStats.baskets++;leftWallStats.basketLitres+=width*depth*height*1000;
}
// The existing loft is a separate storage surface, never added to rack capacity.
let accessGroup,parkingPath,emptyFloor,loftStats;
function planPatch(parent,x0,x1,z0,z1,y,colour,opacity=.18){
 const m=new T.MeshStandardMaterial({color:colour,transparent:true,opacity,depthWrite:false,side:T.DoubleSide});
 const patch=box(x1-x0,.003,z1-z0,(x0+x1)/2,y,(z0+z1)/2,m,parent);
 const points=[[x0,y+.003,z0],[x1,y+.003,z0],[x1,y+.003,z1],[x0,y+.003,z1],[x0,y+.003,z0]].map(p=>new T.Vector3(...p));
 const edge=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineDashedMaterial({color:colour,dashSize:.09,gapSize:.045}));edge.computeLineDistances();parent.add(edge);return patch;
}
function makeLoft(){
 const a=data.loft,length=Number(root.querySelector('#loft-length').value)/100;
 const top=H+a.joistDepth+a.deckThickness;
 loftStats={length,top,footprint:W*length,accessStart:length,accessEnd:length+a.accessDepth};
 loftGroup=new T.Group();scene.add(loftGroup);
 const m=materials.wood.clone();m.transparent=true;m.opacity=.12;m.depthWrite=false;
 const deck=box(W,a.deckThickness,length,W/2,top-a.deckThickness/2,length/2,m,loftGroup);
 const parts=[deck];
 for(let z=.12;z<length;z+=.65){const joist=box(W,a.joistDepth,.045,W/2,H+a.joistDepth/2,z,m,loftGroup);parts.push(joist);}
 loftGroup.userData.structure=parts;
 register(parts,null,{title:'Existing loft / hems · footprint study',kind:'existing-storage',dimensions:[W,length,a.joistDepth+a.deckThickness],height:top,note:a.evidence+' The drawing marks storage and access areas on the deck. It does not estimate usable roof volume or establish safe loading.'});
 const middle=W/2,half=a.clearStrip/2;
 const allocation=new T.Group();loftGroup.add(allocation);loftGroup.userData.allocation=allocation;
 const zones=[planPatch(allocation,.06,middle-half,.08,length-.06,top+.01,'#386a61'),planPatch(allocation,middle+half,W-.06,.08,length-.06,top+.01,'#386a61')];
 register(zones,null,{title:'Loft · seasonal / bulky storage zones',kind:'concept',note:'Use the existing loft for bulky, less frequently handled belongings. Green areas are an allocation diagram on the assumed deck footprint; roof headroom and safe load are unknown. Keep the central access strip open.'});
 const strip=planPatch(allocation,middle-half,middle+half,.08,length-.04,top+.012,'#b4833d');
 register([strip],null,{title:'Loft · keep access strip clear',kind:'concept',dimensions:[a.clearStrip,length-.12,.003],height:top,note:'A 65 cm planning strip keeps the seasonal storage reachable. This is an assumed access arrangement, not a verified walkway, guardrail or access-ladder design.'});
 makeAccessZones();
}
function makeAccessZones(){
 accessGroup=new T.Group();scene.add(accessGroup);
 const a=data.loft,x0=(W-a.accessWidth)/2,x1=x0+a.accessWidth;
 const approach=planPatch(accessGroup,x0,x1,loftStats.accessStart,loftStats.accessEnd,.025,'#b77637',.22);
 register([approach],null,{title:'Loft · reserved floor approach',kind:'concept',dimensions:[a.accessWidth,a.accessDepth,.003],height:0,note:'Keep this floor area available when accessing the loft. It overlaps the parked-car envelope at the default loft edge, so move the car out first. The final access method, ladder footprint and required opening are unmeasured.'});
 parkingPath=new T.Group();accessGroup.add(parkingPath);
 const carLeft=data.car.centerX-data.car.foldedWidth/2,z0=data.car.entranceGap,z1=L-data.layouts[current].depth;
 planPatch(parkingPath,.14,carLeft-.02,z0,z1,.018,'#3d7162',.13);
 const clear=Number(root.querySelector('#basket-clearance').value)/100;
 for(const x of [.14,carLeft-.02]){
  line([x,clear,z0],[x,clear,z1],'#3d7162',parkingPath);
  for(const z of [z0,z1])line([x,.025,z],[x,clear,z],'#3d7162',parkingPath);
 }
 emptyFloor=new T.Group();accessGroup.add(emptyFloor);
 planPatch(emptyFloor,.18,W-.32,.25,z1-.08,.014,'#3d7162',.10);
}
function updateSpaceStatus(){
 const parked=root.querySelector('#garage-car').checked,loft=root.querySelector('#garage-loft').checked;
 const rearStart=L-data.layouts[current].depth;
 const blocked=loftStats.accessEnd>rearStart-.03;
 accessGroup.visible=root.querySelector('#garage-access').checked;
 loftGroup.userData.allocation.visible=accessGroup.visible;
 // A top comparison hides the deck by view, while the floor plan remains visible.
 loftGroup.visible=loft&&view!=='plan';
 loftGroup.userData.structure[0].material.opacity=['loft','photo'].includes(view)?1:.12;
 root.querySelector('#plan-note').hidden=view!=='plan';
 parkingPath.visible=parked;emptyFloor.visible=!parked;
 root.querySelector('#loft-length-value').textContent=loftStats.length.toFixed(1)+' m';
 root.querySelector('#basket-projection-value').textContent=root.querySelector('#basket-projection').value+' cm';
 root.querySelector('#basket-clearance-value').textContent=root.querySelector('#basket-clearance').value+' cm';
 root.querySelector('#basket-controls').hidden=!root.querySelector('#garage-left-baskets').checked;
 root.querySelector('#loft-status').textContent=blocked?'The assumed loft approach overlaps rear storage / the rear wall. Revise the loft edge or access arrangement.':parked?'Move car out for the reserved loft approach and a usable work area.':'The reserved loft approach is clear of rear storage in this model. Final access method still needs checking.';
 root.querySelector('#space-status').innerHTML=parked?'<strong>Car parked:</strong> '+Math.round(data.layouts[current].frontGap*100)+' cm rear gap. Left side: about 55 cm to folded mirrors, narrowing to about 42 cm at the charger. A narrow passage; door movement is unmodelled.':'<strong>Car out:</strong> the centre becomes working and retrieval space; keep the marked loft approach available.';
}
// Four whole-garage studies share a coherent rear system. Mixed openings are
// independent of the belongings used to illustrate them.
let shelfZones=[];
function shelfZone(x,width,depth,y,next,thickness=.024){
 shelfZones.push({x,width,depth,y,clear:next-y-thickness,area:width*depth});
}
function storageHeight(){return root.querySelector('#garage-upper').checked?Number(root.querySelector('#rear-height').value)/100:H;}
function upperClearance(){return H+(storageHeight()-H)*(L-.28-4)/(L-4);}
function rearShelf(x,width,depth,y,next,title){
 const board=materials.wood.clone();board.color.set('#dbc3a0');
 capture(()=>{
  box(width,.024,depth,x,y-.012,L-depth/2,board,furnitureGroup);
  for(const xx of [x-width/2+.012,x+width/2-.012])box(.024,.035,depth,xx,y-.0415,L-depth/2,'metal',furnitureGroup);
 },null,{title,kind:'concept',dimensions:[width,depth,.024],height:y,note:'Adjustable shelf concept in a coordinated system. Nominal clear width and top surface shown. Reuse suitable existing shelf units or specify a matching system later; supports, fixings and loads are unverified.'});
 shelfZone(x,width,depth,y,next,.06);
}
function upperStorage(){
 if(storageHeight()<2.4)return;const h=upperClearance();
 const x0=.08,width=2.67,depth=.28,bottom=2.06,top=h-.06,cols=3;
 const levels=[bottom];while(levels.at(-1)+.38+.25<=h)levels.push(levels.at(-1)+.38);
 capture(()=>{
  for(let i=0;i<=cols;i++)box(.018,top-bottom,depth,x0+i*width/cols,(bottom+top)/2,L-depth/2,'white',furnitureGroup);
 },null,{title:'Rear upper compartments · assumed roof clearance',kind:'concept',dimensions:[width,depth,top-bottom],height:bottom,note:'Independent shallow compartments using the taller rear roof space. Roof profile, clear height and support locations are unmeasured. Reuse / extend existing small shelves where suitable; do not infer a loft load rating.'});
 for(let i=0;i<cols;i++)for(let j=0;j<levels.length;j++)rearShelf(x0+(i+.5)*width/cols,width/cols-.025,depth,levels[j],levels[j+1]??h,'Rear upper shelf · '+Math.round(levels[j]*100)+' cm');
}
function storage(){
 const a=data.layouts[current];furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];
 const posts=[.10,1.04,1.98,2.73];
 capture(()=>{
  // Rear-mounted uprights leave a continuous front edge, including the sled slot.
  for(const x of posts)box(.04,a.top,.035,x,a.top/2,L-.0175,'metal',furnitureGroup);
 },null,{title:'Rear shelving · matching adjustable uprights',kind:'concept',dimensions:[a.rearWidth,.035,a.top],note:'One consistent shelving concept across the whole rear wall. No mixed retail rack and timber extension is required by the design. Final system, attachment and load rating remain to be specified.'});
 for(let bay=0;bay<2;bay++){
  const x=(posts[bay]+posts[bay+1])/2,width=posts[bay+1]-posts[bay]-.04;
  a.shelves[bay].forEach((y,i)=>{
   const depth=y>a.stepHeight?a.upperDepth:a.depth;
   rearShelf(x,width,depth,y,a.shelves[bay][i+1]??(storageHeight()>H?2.06:H),'Rear bay '+(bay+1)+' · '+Math.round(depth*100)+' cm deep / '+Math.round(y*100)+' cm high');
  });
 }
 const sx=(posts[2]+posts[3])/2,sw=posts[3]-posts[2]-.04;
 a.shelves[2].forEach((y,i)=>rearShelf(sx,sw,.4,y,a.shelves[2][i+1]??(storageHeight()>H?2.06:H),'Above sled · '+Math.round(y*100)+' cm high'));
 snowRacer(sx);
 rightWall();upperStorage();exampleContents();leftWallStorage();
 root.querySelector('#rear-height-value').textContent=Math.round(storageHeight()*100)+' cm';
 root.querySelector('#upper-controls').hidden=!root.querySelector('#garage-upper').checked;
}
 function build(){if(scene)scene.traverse(o=>{if(o.geometry)o.geometry.dispose();});objects=[];equipmentMeshes=[];selected=null;selectionBox=null;labels=[];scene=new T.Scene();scene.scale.x=-1;scene.background=new T.Color('#e9e9e0');scene.environment=environment;materials={};for(const k of ['wood','metal','floor','white','glass','bin','gear','rubber','accent'])materials[k]=mat(k);dimensionGroup=new T.Group();scene.add(dimensionGroup);
 scene.add(new T.HemisphereLight(0xf5f7ff,0x9b896f,1.6));
 const sun=new T.DirectionalLight(0xfff3dc,1.7);sun.position.set(1,5,-3);sun.target.position.set(-1,0,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-5,right:5,top:7,bottom:-5,near:.1,far:20});sun.shadow.bias=-.0002;sun.shadow.normalBias=.008;sun.shadow.radius=4;scene.add(sun,sun.target);
 const fill=new T.DirectionalLight(0xdce9ff,.65);fill.position.set(-4,3,1);scene.add(fill);
 box(W+.16,.12,L+.1,W/2,-.065,L/2,'floor');
 const concrete=materials.floor.clone();concrete.color.set('#8d9088');box(.06,.13,L,W-.005,.065,L/2,concrete);box(.06,.13,L,.005,.065,L/2,concrete);
 // Individual pine boards: actual room interior faces remain x=2.83 and z=6.10.
 const rearH=storageHeight();
 for(let i=0;i<20;i++){const w=W/20;const m=materials.wood.clone();m.color.multiplyScalar(.92+random()*.15);box(w-.003,rearH,.034,(i+.5)*w,rearH/2,L+.017,m);}
 for(let i=0;i<43;i++){const d=L/43;const hh=H+(rearH-H)*Math.max(0,((i+.5)*d-4)/(L-4));const m=materials.wood.clone();m.color.multiplyScalar(.92+random()*.15);box(.034,hh,d-.003,W+.017,hh/2,(i+.5)*d,m);}
 leftWallFrame();
 for(const z of [2.03,4.06])box(W,.001,.004,W/2,.001,z,new T.MeshStandardMaterial({color:'#777c75',roughness:1}));
 const studio=new T.MeshStandardMaterial({color:'#e9e9e0',roughness:1});box(200,.02,200,W/2,-.145,L/2,studio);

 for(const m of scene.children){if(m.userData.wall)continue;if(m.isMesh&&m.position.z>=L-.05)m.userData.wall='back';else if(m.isMesh&&m.position.x>=W-.05)m.userData.wall='right';}
 makeLoft();
 storage();makeCar();register(carGroup.children.filter(m=>m.isMesh),null,{title:'Model Y parking envelope',dimensions:[data.car.foldedWidth,data.car.length,data.car.height],note:'Official planning dimensions; simplified body shape. Folded mirrors: 198.2 cm; body: 192 cm; open mirrors: 212.9 cm. Driver-door and hatch movement are not modelled.'});carGroup.traverse(m=>{if(m.isMesh){m.material=m.material.clone();m.material.transparent=true;m.material.opacity=.27;m.material.depthWrite=false;}});
 dimension([0,2.18,L-.20],[W,2.18,L-.20],'2.83 m',[W/2,2.24,L-.20],.8);dimension([0,.04,-.35],[W,.04,-.35],'2.83 m',[W/2,.05,-.55],1.8);
 const carEnd=data.car.entranceGap+data.car.length,rearGap=data.layouts[current].frontGap;dimension([W+.16,.04,carEnd],[W+.16,.04,carEnd+rearGap],Math.round(rearGap*100)+' cm rear gap',[W+.62,.08,carEnd+rearGap/2],1.05);labels.at(-1).userData.floorGap=true;
 dimension([-.30,.03,0],[-.30,.03,L],'6.10 m',[-.45,.10,3.0],1.8);
 makeBikes();if(camera)updateComposer();else updateCamera(); updateTable(); populateObjects(); applyVisibility();render();root.dataset.ready='true';
 }
 function updateCamera(){const w=host.clientWidth,h=host.clientHeight,aspect=w/h;renderer.setSize(w,h,false);controls?.dispose();let pos,target=[-W/2,.9,L/2];const orth=['plan','loft','front','back','left','side-right','right','left-wall'].includes(view);
 if(orth){const span=(view==='plan'?7.1:view==='loft'?Math.max(5.8,3.6/aspect):['left','side-right','right','left-wall'].includes(view)?Math.max(3.3,6.9/aspect):Math.max(3.2,3.3/aspect));camera=new T.OrthographicCamera(-span*aspect/2,span*aspect/2,span/2,-span/2,.03,100);camera.userData.span=span;}else camera=new T.PerspectiveCamera(view==='photo'?66:43,aspect,.03,100);
 if(view==='photo'){pos=[-W/2,1.70,-.10];target=[-W/2,1.12,5.90];}else if(view==='rear'){pos=[-1.08,2.05,1.05];target=[-1.42,1.05,5.85];}else if(view==='left-wall'){pos=[-2.5,1.05,L/2];target=[0,1.05,L/2];}else if(view==='right'){pos=[-.20,1.05,L/2];target=[-W,1.05,L/2];}else if(view==='plan'){pos=[-W/2,12,3.05];target=[-W/2,0,3.05];camera.up.set(0,0,1);}else if(view==='loft'){pos=[-W/2,12,loftStats.length/2];target=[-W/2,loftStats.top,loftStats.length/2];camera.up.set(0,0,1);}else if(view==='front'){pos=[-W/2,.9,-8];}else if(view==='back'){pos=[-W/2,.9,14];}else if(view==='left'){pos=[8,.9,L/2];}else if(view==='side-right'){pos=[-10,.9,L/2];}else{pos=[-4.4,4.9,-4.2];target=[-1.42,1.0,3.10];}
 if(aspect<1&&view==='rear')pos[2]-=1.7;
 camera.position.set(...pos);camera.lookAt(new T.Vector3(...target));controls=new OrbitControls(camera,renderer.domElement);controls.target.set(...target);controls.enableDamping=true;controls.dampingFactor=.12;controls.minDistance=.45;controls.maxDistance=18;controls.maxPolarAngle=Math.PI*.5;controls.update();controls.addEventListener('change',()=>{updateWalls();render();});
 updateComposer();root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));applyVisibility();render();}
 // A layout rebuild replaces the scene, but keeps the camera and orbit controls.
 function updateComposer(){const w=host.clientWidth,h=host.clientHeight;
 composer?.dispose();composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));ao=new SSAOPass(scene,camera,w,h);ao.enabled=!camera.isOrthographicCamera;ao.kernelRadius=8;ao.minDistance=.002;ao.maxDistance=.12;composer.addPass(ao);composer.addPass(new OutputPass());composer.addPass(new SMAAPass(w,h));composer.setSize(w,h);}
 function applyVisibility(){if(!scene)return;if(bikeGroup)bikeGroup.visible=root.querySelector('#garage-bikes').checked;root.querySelector('#bike-controls').hidden=!root.querySelector('#garage-bikes').checked;root.querySelector('#bike-status').hidden=!root.querySelector('#garage-bikes').checked;updateWalls();carGroup.visible=root.querySelector('#garage-car').checked;for(const o of equipmentMeshes)o.visible=root.querySelector('#garage-gear').checked;labels.forEach((l,i)=>{l.visible=root.querySelector('#garage-dims').checked&&(l.userData.floorGap?view==='plan':['overview','plan'].includes(view)||['rear','front','back'].includes(view)&&i===0);});updateSpaceStatus();render();}
 function focusObject(){if(!selected)return;const b=objectBounds(selected),center=b.getCenter(new T.Vector3()),size=b.getSize(new T.Vector3());const distance=Math.max(.85,size.length()*1.35);const dir=new T.Vector3(.2,.32,-1).normalize();camera.up.set(0,1,0);camera.position.copy(center).addScaledVector(dir,distance);controls.target.copy(center);controls.update();render();}
 for(const id of ['garage-left-inserts','garage-left-baskets','garage-upper'])root.querySelector('#'+id).addEventListener('change',build);
 for(const id of ['basket-projection','basket-clearance','loft-length']){
  root.querySelector('#'+id).addEventListener('change',build);
  root.querySelector('#'+id).addEventListener('input',e=>{root.querySelector('#'+id+'-value').textContent=(id==='loft-length'?(e.target.value/100).toFixed(1)+' m':e.target.value+' cm');});
 }
 root.querySelector('#rear-height').addEventListener('change',build);
 root.querySelector('#rear-height').addEventListener('input',e=>{root.querySelector('#rear-height-value').textContent=e.target.value+' cm';});
 root.querySelector('#reset-view').addEventListener('click',updateCamera);root.querySelector('#focus-item').addEventListener('click',focusObject);root.querySelector('#object-list').addEventListener('change',e=>selectObject(objects.find(o=>o.id===e.target.value)));
 for(const id of ['garage-gear','garage-dims','garage-bikes','garage-cutaway','garage-access'])root.querySelector('#'+id).addEventListener('change',()=>{if(id==='garage-bikes'&&root.querySelector('#garage-bikes').checked)root.querySelector('#garage-car').checked=true;applyVisibility();});
 const raycaster=new T.Raycaster(),pointer=new T.Vector2();let down=null;
 renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,time:performance.now()};});
 function pick(e){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(scene.children,true);for(const hit of hits){let o=hit.object,visible=true;while(o){if(!o.visible)visible=false;o=o.parent;}if(!visible||!hit.object.isMesh)continue;return objects.find(o=>o.id===hit.object.userData.objectId)||null;}return null;}
 renderer.domElement.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<6&&performance.now()-down.time<700)selectObject(pick(e));down=null;});
 renderer.domElement.addEventListener('pointermove',e=>{if(e.buttons)return;renderer.domElement.style.cursor=pick(e)?'pointer':'grab';});

 root.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;root.querySelector('#garage-view').value=view;updateCamera();}));

 function updateWalls(){if(!scene||!camera)return;const cut=root.querySelector('#garage-cutaway').checked;scene.traverse(m=>{const side=m.userData.wall;if(side)m.visible=!(cut&&(side==='left'&&camera.position.x>0||side==='right'&&camera.position.x<-W||side==='back'&&camera.position.z>L));});}
 const money=v=>new Intl.NumberFormat('nb-NO',{maximumFractionDigits:2}).format(v)+' kr';
function rearSurface(a){
 let area=0;for(let i=0;i<2;i++)for(const y of a.shelves[i])area+=.9*(y>a.stepHeight?a.upperDepth:a.depth);
 area+=.71*.4*a.shelves[2].length;
 if(storageHeight()>H){let levels=1;while(2.06+levels*.38+.25<=upperClearance())levels++;area+=3*(2.67/3-.025)*.28*levels;}
 return area;
}
function updateTable(){
 const a=data.layouts[current];
 root.querySelector('#garage-title').textContent=a.id+' · '+a.name;
 const photo='assets/garage-plan-'+a.id.toLowerCase()+'.jpg';root.querySelector('#photo-title').textContent=a.id+' · '+a.name;root.querySelector('#plan-photo').src=photo;root.querySelector('#photo-link').href=photo;root.querySelector('#plan-photo').alt='Photorealistic concept · '+a.name+' · without a car';
 root.querySelector('#garage-equipment').textContent=a.summary;
 root.querySelector('#garage-metrics').innerHTML='<span>Rear gap <strong>'+Math.round(a.frontGap*100)+' cm</strong></span><span>Rear depth <strong>'+Math.round(a.depth*100)+' / '+Math.round(a.upperDepth*100)+' cm</strong></span><span>Rear shelf surface <strong>'+shelfZones.reduce((s,z)=>s+z.area,0).toFixed(1)+' m²</strong></span><span>Left wall <strong>'+leftWallStats.added+' inserts + '+leftWallStats.baskets+' high baskets</strong></span><span>Loft <strong>existing · '+loftStats.length.toFixed(1)+' m assumed length</strong></span>';
 root.querySelector('#garage-price').textContent='Layout study · components unpriced';
 root.querySelector('#garage-unpriced').textContent=a.unpriced;
 root.querySelector('#inventory-rows').innerHTML=data.inventory.map(i=>'<tr><td>'+i.name+'<br><small>'+i.count+'</small></td><td>'+i.evidence+'</td><td>'+i.storage+'</td></tr>').join('');
 root.querySelector('#comparison-rows').innerHTML=data.layouts.map(p=>'<tr'+(p===a?' class="selected-plan"':'')+'><td>'+p.id+' · '+p.name+'</td><td>'+Math.round(p.depth*100)+' / '+Math.round(p.upperDepth*100)+' cm</td><td>'+rearSurface(p).toFixed(1)+' m²</td><td>'+Math.round(p.frontGap*100)+' cm</td><td>'+(p.depth>=.8?'Car out for rear retrieval':p.depth>=.6?'Tighter rear retrieval':p.depth>=.5?'Balanced starting point':'Most rear floor space')+'</td></tr>').join('');
 root.querySelector('#garage-products').innerHTML=[
  ['Rear wall','8 adjustable main shelves + 2 above the sled; a 90 cm wide × 104 cm high opening for bulky things','Proposed system / reuse suitable existing small units; folded bike-carrier depth still needs checking'],
  ['Upper rear','28 cm deep compartments in the taller roof area','Conditional on the assumed clearance'],
  ['Left wall',leftWallStats.added+' flush inserts + '+leftWallStats.baskets+' high baskets','Existing ledges, braces and charger kept'],
  ['Right wall','High ski shelf; shallow tools; ladder, folded chairs and table','Reuse existing shelf and adapt hooks / straps'],
  ['Loft / hems','Seasonal / bulky storage; clear strip and approach','Existing deck; footprint / loading unmeasured']
 ].map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('');
}
 root.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>{current=Number(b.dataset.layout);root.querySelectorAll('[data-layout]').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));build();}));
 root.querySelector('#garage-view').addEventListener('change',e=>{view=e.target.value;updateCamera();});root.querySelector('#garage-car').addEventListener('change',applyVisibility);root.querySelector('#garage-loft').addEventListener('change',applyVisibility);
 new ResizeObserver(()=>{if(!camera)return; const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);if(camera.isOrthographicCamera){const span=camera.userData.span;camera.left=-span*w/h/2;camera.right=span*w/h/2;}else camera.aspect=w/h;camera.updateProjectionMatrix();composer?.setSize(w,h);render();}).observe(host);
 build();
 renderer.setAnimationLoop(()=>{controls?.update();});
 window.garageModel={data,setLayout:i=>{root.querySelector('[data-layout="'+i+'"]').click()},setView:v=>{root.querySelector('#garage-view').value=v;root.querySelector('#garage-view').dispatchEvent(new Event('change'))},capture:()=>renderer.domElement.toDataURL('image/png'),getScene:()=>scene,getObjects:()=>objects.map(({id,key,meta})=>({id,key,meta})),select:id=>selectObject(objects.find(o=>o.id===id)),project:id=>{const o=objects.find(o=>o.id===id);const b=objectBounds(o);return b.getCenter(new T.Vector3()).project(camera).toArray();}};

