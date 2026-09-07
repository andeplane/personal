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
 let current=0, view='rear', scene,camera,carGroup,loftGroup, furnitureGroup;
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
 function binBase(x,y,z,w=.39,d=.28,h=.28){box(w,h-.02,d,x,y+(h-.02)/2,z,'bin',furnitureGroup);box(w+.006,.02,d+.006,x,y+h-.01,z,'white',furnitureGroup);box(w*.37,.05,.003,x,y+h/2,z-d/2-.003,'white',furnitureGroup);}
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

 function packBase(x,y,z,colour='gear',h=.75){
  const m=new T.Mesh(new RoundedBoxGeometry(.49,h-.08,.31,5,.07),fabricMaterial(colour));m.position.set(x,y+h/2,z);furnitureGroup.add(m);m.castShadow=true;
  box(.52,.075,.35,x,y+h-.04,z,colour,furnitureGroup);
  box(.24,.22,.055,x,y+.20,z-.175,colour,furnitureGroup);
  for(const xx of [x-.11,x+.11])box(.025,h*.75,.012,xx,y+h*.50,z-.185,'metal',furnitureGroup);
  for(const yy of [y+.18,y+h-.16])box(.50,.025,.015,x,yy,z-.19,'metal',furnitureGroup);
 }
 function bootsBase(x,y,z){for(const dx of [-.21,-.07,.07,.21]){box(.12,.08,.31,x+dx,y+.04,z,'metal',furnitureGroup);box(.115,.34,.17,x+dx,y+.23,z+.055,'white',furnitureGroup);for(const hh of [.10,.20,.28])box(.12,.018,.018,x+dx,y+hh,z-.04,'metal',furnitureGroup);}}
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
 function upperSledShelves(x,bootShelf=false){for(const xx of [x-.405,x+.405])box(.025,1,.02,xx,1.525,L-.01,'white',furnitureGroup);box(.824,.025,.01,x,2.012,L-.02,'white',furnitureGroup);for(const y of [bootShelf?1.55:1.64,2]){box(.80,.02,.38,x,y-.01,L-.21,'white',furnitureGroup);for(const xx of [x-.405,x+.405])box(.014,.055,.40,xx,y-.04,L-.2,'white',furnitureGroup);}if(bootShelf)boots(x,1.55,L-.21);else for(const dx of [-.20,.20])bin(x+dx,1.64,L-.22);}
 function rightWallBase(){
  // Four 60 cm rails carry small tools/cables; direct hooks support the chairs and ladder.
  for(let i=0;i<4;i++)box(.017,.06,.6,W-.009,1.62,2.05+i*.6,'metal',furnitureGroup);
  for(let i=0;i<20;i++){const z=1.78+i*.122;rod([W-.02,1.62,z],[W-.09,1.62,z],.008,'metal',furnitureGroup);rod([W-.09,1.62,z],[W-.09,1.65,z],.008,'metal',furnitureGroup);}
  for(const z of [2.1,2.75,3.24,3.66])rod([W-.01,1.5,z],[W-.08,1.5,z],.01,'metal',furnitureGroup);
  for(const z of [2.1,2.75]){box(.08,.47,.40,W-.095,1.05,z,'rubber',furnitureGroup);for(const zz of [z-.22,z+.22])rod([W-.14,.50,zz],[W-.14,1.5,zz],.014,'metal',furnitureGroup);for(const y of [.50,1.5])rod([W-.14,y,z-.22],[W-.14,y,z+.22],.014,'metal',furnitureGroup);}
  // Gardintrapp upright, not stacked behind the snow racer.
  for(const z of [3.24,3.66])rod([W-.10,.05,z],[W-.10,1.95,z],.022,'white',furnitureGroup);for(let y=.18;y<1.9;y+=.26)rod([W-.10,y,3.24],[W-.10,y,3.66],.020,'white',furnitureGroup);
  // Existing folded table held flat, bottom on floor. Retaining strap is in the BOM.
  box(.07,1.25,.75,W-.05,.65,4.35,'white',furnitureGroup);box(.009,.03,.76,W-.095,1.05,4.35,'accent',furnitureGroup);
  for(const z of [2.35,3.90]){rod([W-.02,1.94,z],[W-.24,1.94,z],.0125,'metal',furnitureGroup);rod([W-.24,1.94,z],[W-.24,2.0,z],.0125,'metal',furnitureGroup);}
  for(let i=0;i<3;i++)box(.045,.024,2.15,W-.055-i*.065,1.965,3.10,'gear',furnitureGroup);
 }
 function register(meshes,key,meta={}){const id='object-'+objects.length;const record={id,key,meta,meshes};objects.push(record);for(const m of meshes)m.userData.objectId=id;return record;}
 function autoTag(mesh,w,h,d,x,y,z,m,parent){if(parent!==furnitureGroup||!furnitureGroup)return;
 if(m==='white'&&Math.abs(h-.02)<.0001&&Math.abs(d-.38)<.0001){register([mesh],w>.7?'shelf':'shelf60',{title:(w>.7?'80':'60')+' cm shelf · '+Math.round((y+.01)*100)+' cm high',height:y+.01,dimensions:[w,.38,.02],note:'Nominal system depth 40 cm; shelf plate depth 38 cm. Height shown is the proposed top surface; thickness and fittings are simplified.'});
 // A shallow folded lip gives the thin steel plate a readable manufactured edge.
 const lip=new T.Mesh(new RoundedBoxGeometry(w,.014,.008,1,.002),materials.white);lip.position.set(x,y-.008,z-d/2+.004);furnitureGroup.add(lip);lip.userData.objectId=mesh.userData.objectId;objects.at(-1).meshes.push(lip);
 }else if(m==='white'&&Math.abs(w-.025)<.0001&&(h===2||h===1)){register([mesh],h===2?'upright':'shortUpright',{title:'BOAXEL upright · '+Math.round(h*100)+' cm',dimensions:[w,d,h],note:'Vertical rail. Exact fixing positions must follow the manufacturer’s installation instructions.'});for(let sy=y-h/2+.04;sy<y+h/2-.025;sy+=.05){const slot=new T.Mesh(new T.PlaneGeometry(.006,.016),materials.metal);slot.rotation.y=Math.PI;slot.position.set(x,sy,z-d/2-.001);furnitureGroup.add(slot);slot.userData.objectId=mesh.userData.objectId;objects.at(-1).meshes.push(slot);}
 }else if(m==='white'&&h===.025&&w>.6){register([mesh],w>.8?'rail':'rail62',{title:'BOAXEL mounting rail',note:'Alignment rail; fix the uprights to suitable structural backing.'});
 }else if(m==='white'&&w===.014&&d===.4){register([mesh],'bracket',{title:'BOAXEL shelf bracket',height:y+.04,note:'40 cm bracket. Can support adjacent shelves on both sides.'});
 }else if(m==='metal'&&w===.017&&d===.6){register([mesh],'hookKit',{title:'60 cm tool rail',note:'Sold as a kit: two 60 cm rails and ten hooks. Two kits provide four rails in this layout.'});}}
 function capture(fn,key,meta,gear=false){const n=furnitureGroup.children.length;fn();const meshes=furnitureGroup.children.slice(n);register(meshes,key,meta);if(gear)equipmentMeshes.push(...meshes);}
 function bin(x,y,z,w=.39,d=.28,h=.28){capture(()=>binBase(x,y,z,w,d,h),h>.2?'small':w<.3?'tiny':'flat',{title:'SAMLA '+(h>.2?'22':w<.3?'5':'11')+' L box',height:y,dimensions:[w,d,h],note:'Box dimensions in its displayed orientation. Lid included in the listed product.'},true);}
 function bror(x,w,d,levels,height=1.9){capture(()=>brorBase(x,w,d,levels,height),height>1.5?'deep':'low',{title:'BROR '+Math.round(height*100)+' cm unit',dimensions:[w,d,height],levels,note:height>1.5?'Sold with five shelves. Four are installed here to preserve tall backpack openings.':'Sold with three shelves, all installed here.'});}
 function pack(x,y,z,colour='gear',h=.75){capture(()=>{
 const fabric=fabricMaterial(colour),dark=fabricMaterial('rubber');
 function soft(w,hh,d,px,py,pz,r,mat=fabric){const m=new T.Mesh(new RoundedBoxGeometry(w,hh,d,5,r),mat);m.position.set(px,py,pz);m.castShadow=m.receiveShadow=true;furnitureGroup.add(m);return m;}
 soft(.43,h-.10,.30,x,y+h/2-.015,z,.065);soft(.46,.14,.34,x,y+h-.085,z,.05);soft(.31,.26,.065,x,y+.23,z-.155,.04);
 for(const dx of [-.227,.227])soft(.075,.26,.21,x+dx,y+.20,z,.025);
 for(const dx of [-.12,.12]){box(.025,h*.65,.009,x+dx,y+h*.51,z-.185,'rubber',furnitureGroup);box(.038,.03,.015,x+dx,y+h-.18,z-.191,'metal',furnitureGroup);}
 for(const yy of [y+.15,y+h-.23])box(.41,.018,.008,x,yy,z-.19,'rubber',furnitureGroup);
 const curve=new T.CatmullRomCurve3([new T.Vector3(x-.065,y+h-.055,z),new T.Vector3(x-.045,y+h-.012,z),new T.Vector3(x+.045,y+h-.012,z),new T.Vector3(x+.065,y+h-.055,z)]);const handle=new T.Mesh(new T.TubeGeometry(curve,16,.009,8,false),dark);furnitureGroup.add(handle);
 },null,{title:'Existing hiking backpack',height:y,dimensions:[.55,.4,h],note:'Estimated storage envelope. Measure the loaded pack; this is a shape proxy, not a product to buy.'},true);}
 function boots(x,y,z){} // Actual footwear inventory is unknown; do not invent six ski-boot pairs.
 function snowRacer(x){capture(()=>snowRacerBase(x),null,{title:'Existing snow racer',dimensions:[.60,.40,1.30],note:'Provisional upright storage envelope including steering wheel. Verify against your snow racer before installation.'},true);}
 function objectBounds(o){scene.updateMatrixWorld(true);const b=new T.Box3();for(const m of o.meshes)b.expandByObject(m);return b;}
 function populateObjects(){const sel=root.querySelector('#object-list');sel.innerHTML='<option value="">Choose a shelf or product</option>';for(const o of objects){const op=document.createElement('option');op.value=o.id;op.textContent=o.meta.title||data.products[o.key]?.name;sel.append(op);}root.querySelector('#selection').innerHTML='<h2>Click a shelf.</h2><p>Inspect its size, height above the floor, price and exact product link. Switch off equipment to see every shelf.</p>';root.querySelector('#focus-item').disabled=true;}
 const dimensionText=k=>({upright:'200 cm high',shortUpright:'100 cm high',rail:'82 cm long',rail62:'62 cm long',shelf:'80 × 40 cm system size',shelf60:'60 × 40 cm system size',bracket:'40 cm deep',deep:'85 × 55 × 190 cm',low:'85 × 55 × 110 cm',small:'39 × 28 × 28 cm',tiny:'28 × 20 × 14 cm',flat:'39 × 28 × 14 cm',hookKit:'2 × 60 cm rails + 10 hooks',shortHook:'7 cm projection',skiHook:'33 × 24 cm',straps:'2 × 2.5 m straps'}[k]||data.products[k]?.dimensionsText||'See product page');
 function selectObject(o){if(selected)for(const m of selected.meshes){if(m.userData.baseMaterial){m.material.dispose();m.material=m.userData.baseMaterial;delete m.userData.baseMaterial;}}if(selectionBox){scene.remove(selectionBox);selectionBox.traverse(m=>{if(m.geometry)m.geometry.dispose();});selectionBox=null;}selected=o||null;const panel=root.querySelector('#selection');root.querySelector('#focus-item').disabled=!o;root.querySelector('#object-list').value=o?.id||'';if(!o){panel.innerHTML='<h2>Click a shelf.</h2><p>Select an object to inspect its size and product details.</p>';render();return;}const p=data.products[o.key],m=o.meta;let html='<h2>'+m.title+'</h2>'+(p?'<p>'+p.name+'</p>':'<p>'+((m.title||'').startsWith('Custom')||(m.title||'').startsWith('Divider')?'Custom construction · provisional dimensions':'Existing equipment · estimated dimensions')+'</p>');let rows=[];
 if(p)rows.push(['Product size',dimensionText(o.key)]);
 if(m.dimensions)rows.push(['Shown W × D × H',m.dimensions.map(v=>Number((v*100).toFixed(1))).join(' × ')+' cm']);
 if(m.height!==undefined)rows.push(['Above floor',Number((m.height*100).toFixed(1))+' cm']);if(m.levels)rows.push(['Shelf heights',m.levels.map(v=>Math.round(v*100)).join(', ')+' cm']);
 if(p){const n=[...data.layouts[current].items,...data.common].filter(([k])=>k===o.key).reduce((s,[k,q])=>s+q,0);rows.push(['Article number',p.sku],['Unit price',money(p.price)],['In this layout',n+' '+(o.key==='deep'||o.key==='low'?'units':'items')],['Total for product',money(p.price*n)]);}
 html+='<dl>'+rows.map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+v+'</dd></div>').join('')+'</dl>';if(m.note)html+='<p>'+m.note+'</p>';if(p)html+='<a class="product-link" target="_blank" rel="noopener" href="'+p.url+'">View product at '+(p.vendor||(p.url.includes('ikea')?'IKEA':'Jula'))+' ↗</a><p class="fine">Price snapshot: 6 September 2026.</p>';panel.innerHTML=html;
 const bounds=objectBounds(o);selectionBox=new T.Group();selectionBox.scale.x=-1;const outline=new T.Box3Helper(bounds,0xc58639);outline.material.depthTest=false;outline.material.transparent=true;outline.material.opacity=.85;outline.renderOrder=100;selectionBox.add(outline);scene.add(selectionBox);for(const m of o.meshes){if(m.material?.emissive){m.userData.baseMaterial=m.material;m.material=m.material.clone();m.material.emissive.set('#b38345');m.material.emissiveIntensity=.15;}}render();}
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
 const panel=root.querySelector('#bike-status');panel.innerHTML='<h3>Three bikes · nested sideways</h3><p>Each bike: <strong>180 × 65 × 110 cm</strong> (L × W × H), estimated. Alternating directions; third bike staggered 15 cm across the garage.</p><p>Packed group: <strong>195 cm across × '+Math.round(depth*100)+' cm deep</strong> at '+Math.round(spacing*100)+' cm between wheel planes. Plus 5 cm to the rear obstruction (wall for F).</p><p>Current floor-level rear gap: <strong>'+Math.round(data.layouts[current].frontGap*100)+' cm</strong>. '+(overlap>0?'This setting extends <strong>'+Math.round(overlap*100)+' cm into the car’s rectangular envelope</strong> (red area).':'The group envelope clears the parked-car envelope at this setting.')+'</p><p class="fine">Spacing is adjustable, not a claimed minimum. Interlocking handlebars/pedals, steering angles and actual car-body clearance are not collision-solved. This comparison does not establish the tightest achievable packing or rule out other arrangements.</p>';
 root.querySelector('#bike-spacing-value').textContent=Math.round(spacing*100)+' cm';
 }
 root.querySelector('#bike-spacing').addEventListener('input',()=>{const old=bikeGroup;const oldIds=new Set();old.traverse(m=>{if(m.userData.objectId)oldIds.add(m.userData.objectId);});selectObject(null);objects=objects.filter(o=>!oldIds.has(o.id));scene.remove(old);old.traverse(m=>{if(m.geometry)m.geometry.dispose();});makeBikes();populateObjects();applyVisibility();});
// Dimensions are metres. All layouts share the same side-wall installation.
function pineShelf(side,center,height,width=2.4){
 const plankMat=materials.wood.clone();
 const rear=side==='rear',left=side==='left',x=rear?W/2:left?.15:W-.15,z=rear?L-.15:center;
 capture(()=>box(rear?width:.3,.018,rear?.3:width,x,height-.009,z,plankMat,furnitureGroup),'plank',{title:(rear?'Rear raised shelf':left?'Left ski shelf':'Right upper shelf')+' · '+Math.round(height*100)+' cm',height,dimensions:[width,.3,.018],note:'240 cm solid pine board. Proposed support spacing ≤ 75 cm; fixing and loading depend on the real wall backing. Check door tracks and hems beams. Shelf dimensions follow the board, not room axes.'});
 for(let i=0;i<4;i++){const t=-width/2+.10+i*(width-.2)/3,xx=rear?W/2+t:left?.015:W-.015,zz=rear?L-.015:center+t;
 capture(()=>{if(rear){box(.025,.20,.025,xx,height-.118,zz,'metal',furnitureGroup);box(.025,.018,.30,xx,height-.027,L-.15,'metal',furnitureGroup);rod([xx,height-.218,L-.02],[xx,height-.035,L-.28],.009,'metal',furnitureGroup);}else{box(.025,.20,.025,xx,height-.118,zz,'metal',furnitureGroup);box(.30,.018,.025,left?.15:W-.15,height-.027,zz,'metal',furnitureGroup);rod([xx,height-.218,zz],[left?.28:W-.28,height-.035,zz],.009,'metal',furnitureGroup);}},'pineBracket',{title:'30 cm shelf bracket',height:height-.018,note:'20 cm vertical leg, 30 cm projection. Fix into structural backing; paneling alone is not an assumed fixing substrate.'});
 }
}
function rightWall(){
 pineShelf('left',3.15,1.95);pineShelf('right',1.7,1.95);
 // Perforation pattern represented with a repeating texture; external board size is exact.
 const c=document.createElement('canvas');c.width=c.height=48;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,48,48);ctx.fillStyle='#101716';ctx.beginPath();ctx.arc(24,24,8,0,Math.PI*2);ctx.fill();const tex=new T.CanvasTexture(c);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(.955/.012,.82/.012);
 const pm=new T.MeshStandardMaterial({color:'#465659',metalness:.6,roughness:.5,map:tex,transparent:false,alphaTest:0,side:T.DoubleSide});
 for(const z of [1.05,2.06]){
 capture(()=>{const m=new T.Mesh(new T.PlaneGeometry(.955,.82),pm);m.rotation.y=-Math.PI/2;m.position.set(W-.021,1.20,z);furnitureGroup.add(m);for(const yy of [.79,1.61])box(.025,.015,.955,W-.012,yy,z,'metal',furnitureGroup);for(const zz of [z-.4775,z+.4775])box(.025,.82,.015,W-.012,1.2,zz,'metal',furnitureGroup);},'pegboard',{title:'Right wall · perforated tool board',dimensions:[.955,.025,.82],height:.79,note:'Steel plate with 4 mm holes at 12 mm centres. Hook systems are not universal: 25 mm pitch accessories do not match. Allow 2.5 cm mounting stand-off in this model.'});
 capture(()=>{box(.135,.008,.36,W-.0925,1.08,z,'metal',furnitureGroup);box(.008,.11,.36,W-.029,1.131,z,'metal',furnitureGroup);box(.008,.03,.36,W-.156,1.095,z,'metal',furnitureGroup);},'tray',{title:'Movable magnetic tray',dimensions:[.36,.135,.11],height:1.08,note:'Magnetic mounting on the steel board; position is movable. About 16 cm total wall projection including stand-off. Reserve for small items; verify holding capacity.'});
 }
 for(let i=0;i<4;i++)box(.017,.06,.6,W-.009,1.62,2.85+i*.6,'metal',furnitureGroup);
 capture(()=>{for(let i=0;i<20;i++){const z=2.6+i*.118;rod([W-.02,1.62,z],[W-.09,1.62,z],.006,'metal',furnitureGroup);rod([W-.09,1.62,z],[W-.09,1.66,z],.006,'metal',furnitureGroup);}},'hookKit',{title:'20 adjustable rail hooks',note:'Two kits supply four 60 cm rails and twenty movable hooks. Separate from the perforated-board system.'});
 for(const z of [2.86,3.44,3.99,4.41])capture(()=>rod([W-.01,1.5,z],[W-.08,1.5,z],.01,'metal',furnitureGroup),'shortHook',{title:'Folded-gear wall hook',height:1.5});
 for(const z of [2.86,3.44])capture(()=>{box(.08,.47,.4,W-.095,1.05,z,'rubber',furnitureGroup);for(const zz of [z-.22,z+.22])rod([W-.14,.5,zz],[W-.14,1.5,zz],.014,'metal',furnitureGroup);for(const y of [.5,1.5])rod([W-.14,y,z-.22],[W-.14,y,z+.22],.014,'metal',furnitureGroup);},null,{title:'Existing folding chair',dimensions:[.5,.15,1],note:'Estimated folded size; separate hooks avoid stacking into the car clearance.'},true);
 capture(()=>{for(const z of [3.99,4.41])rod([W-.10,.05,z],[W-.10,1.95,z],.022,'white',furnitureGroup);for(let y=.18;y<1.9;y+=.26)rod([W-.10,y,3.99],[W-.10,y,4.41],.02,'white',furnitureGroup);},null,{title:'Existing stepladder / gardintrapp',dimensions:[.5,.15,1.9],note:'Provisional folded dimensions.'},true);
 capture(()=>{box(.07,1.25,.75,W-.05,.65,4.9,'white',furnitureGroup);box(.009,.03,.76,W-.095,1.05,4.9,'accent',furnitureGroup);},null,{title:'Existing folding table',dimensions:[.75,.08,1.25],note:'Estimated folded envelope; retained by strap.'},true);
 capture(()=>{for(let i=0;i<2;i++)box(.055,.025,2.15,.10+i*.09,1.9675,3.15,'gear',furnitureGroup);},null,{title:'Left shelf · ski bundle',dimensions:[.20,2.15,.025],note:'Illustrative 215 cm ski length; count and actual lengths unmeasured. Top stays below 2 m.'},true);
}
function expandedStorage(a){
 if(a.id==='F'){pineShelf('rear',0,1.45);pineShelf('rear',0,1.95);return;}
 const w=a.rackWidth,d=a.depth,h=a.top,x=.10+w/2,key=a.id==='D'?'rack60':'rack80';
 const steel=new T.MeshStandardMaterial({color:'#9da6a8',metalness:.72,roughness:.38}),beam=steel.clone();if(a.id==='E')beam.color.set('#bf4f2b');const board=materials.wood.clone();board.color.set('#b0a187');
 capture(()=>{for(const xx of [x-w/2+.025,x+w/2-.025])for(const zz of [L-d+.025,L-.025]){box(.049,h,.049,xx,h/2,zz,steel,furnitureGroup);for(let y=.075;y<h;y+=.05)box(.012,.018,.001,xx,y,zz-.025,'rubber',furnitureGroup);}for(const y of a.shelves[0]){box(w-.10,.022,d-.02,x,y-.011,L-d/2,board,furnitureGroup);for(const zz of [L-d+.025,L-.025])box(w-.05,.056,.035,x,y-.05,zz,beam,furnitureGroup);}},key,{title:a.system,dimensions:[w,d,h],levels:a.shelves[0],note:a.id==='D'?'Four chipboard shelves supplied; three installed for tall backpack openings, one spare. Wall anchoring required; protect board surfaces against moisture. Nominal external dimensions; confirm assembly clearances.':'Three 22 mm shelf plates. External width 144.8 cm, clear beam span 133.5 cm; 80 cm depth. Price shown includes 25% VAT. Two full units would be 289.6 cm wide and do not fit.'});
 rearExtension(a);for(const x of [.45,1.05])pack(x,.1,L-.26);pack(.55,a.shelves[0][1],L-.26,'accent');
}

function rearExtension(a){
 const x0=.10+a.rackWidth+.02,w=a.extensionWidth,d=a.depth,x=x0+w/2;
 const wood=materials.wood.clone();wood.color.set('#b69972');
 const note='Custom timber / plywood extension, not a retail rack. 45 mm frame and 18 mm shelf geometry are provisional; connections and safe load must be designed for the actual contents. A 1,500 kr materials allowance is included separately in the planning budget, not in the catalogue-product total.';
 capture(()=>{for(const xx of [x0+.0225,x0+w-.0225])for(const zz of [L-d+.0225,L-.0225])box(.045,1.95,.045,xx,.975,zz,wood,furnitureGroup);},null,{title:'Custom full-depth extension · frame',dimensions:[w,d,1.95],note});
 const sledClear=.65,divider=x0+w-.045-sledClear-.0225,narrow=divider-.0225-(x0+.045),nx=x0+.045+narrow/2;
 capture(()=>{for(const zz of [L-d+.0225,L-.0225])box(.045,1.36,.045,divider,.68,zz,wood,furnitureGroup);},null,{title:'Divider · 65 cm clear sled slot',dimensions:[.045,d,1.36],note:'Keeps a dedicated 65 cm wide opening for the estimated 60 cm snow racer. Measure its steering wheel and protrusions.'});
 for(const y of [1.45,1.95])capture(()=>{box(w-.09,.018,d,x,y-.009,L-d/2,wood,furnitureGroup);for(const zz of [L-d+.0225,L-.0225])box(w-.09,.07,.045,x,y-.053,zz,wood,furnitureGroup);},null,{title:'Custom upper shelf · '+Math.round(y*100)+' cm',dimensions:[w-.09,d,.018],height:y,note:note+' Lowest front beam underside: 137 cm, above the provisional 130 cm sled.'});
 for(const y of [.1,.65])capture(()=>{box(narrow,.018,d,nx,y-.009,L-d/2,wood,furnitureGroup);for(const zz of [L-d+.0225,L-.0225])box(narrow,.07,.045,nx,y-.053,zz,wood,furnitureGroup);},null,{title:'Custom small-gear shelf · '+Math.round(y*100)+' cm',dimensions:[narrow,d,.018],height:y,note});
 snowRacer(x0+w-.045-sledClear/2);
}

 function storage(){const a=data.layouts[current];furnitureGroup=new T.Group();scene.add(furnitureGroup);
 if(['D','E','F'].includes(a.id)){expandedStorage(a);}else if(a.id==='A'){
  const centers=[.505,1.215,1.825,2.435],widths=[.8,.6,.6,.6],rails=[.10,.91,1.52,2.13,2.74];for(const x of rails)box(.025,2,.02,x,1.025,L-.01,'white',furnitureGroup);
  for(let i=0;i<4;i++)box(widths[i]+.01,.025,.012,centers[i],2.012,L-.02,'white',furnitureGroup);
  const brackets=new Set();a.shelves.forEach((levels,i)=>{for(const h of levels){box(widths[i],.02,.38,centers[i],h-.01,L-.21,'white',furnitureGroup);brackets.add(i+':'+h);brackets.add((i+1)+':'+h);}});for(const key of brackets){const [i,h]=key.split(':').map(Number);box(.014,.055,.4,rails[i],h-.04,L-.2,'white',furnitureGroup);}
  snowRacer(centers[0]);for(const dx of [-.20,.20])bin(centers[0]+dx,1.64,L-.22);
  pack(1.215,.1,L-.1975);pack(1.825,.1,L-.1975);pack(1.215,1.0,L-.1975,'accent');box(.32,.35,.28,1.75,1.175,L-.21,'gear',furnitureGroup);
  for(const y of [.1,.55,1.0])boots(centers[3],y,L-.21);bin(centers[3],1.45,L-.22);for(const dx of [-.15,.15])bin(centers[3]+dx,1.8,L-.22,.28,.20,.14);
  for(let i=0;i<2;i++){const m=new T.Mesh(new T.CylinderGeometry(.065,.065,.65,16),materials.gear);m.position.set(2.025,1.325,L-.12-i*.15);furnitureGroup.add(m);}
 }else if(a.id==='B'){
  bror(.56,.85,.55,a.shelves[0]);bror(1.42,.85,.55,a.shelves[1]);for(const y of [.1,.58])boots(.56,y,L-.28);
  pack(.415,1.06,L-.29);bin(.835,1.06,L-.28,.28,.39);
  for(const y of [.1,.95]){pack(1.275,y,L-.29,y===.95?'accent':'gear');bin(1.695,y,L-.28,.28,.39);}
  for(const x of [.56,1.42])for(const dx of [-.20,.20])bin(x+dx,1.9,L-.28,.39,.28,.14);
  snowRacer(2.27);upperSledShelves(2.27,true);
 }else{
  for(const x of [.56,1.42])bror(x,.85,.55,[.1,.6,1.1],1.1);
  for(const y of [.1,.6])boots(.56,y,L-.28);boots(1.42,.1,L-.28);box(.55,.35,.4,1.42,.775,L-.29,'gear',furnitureGroup);
  pack(.415,1.1,L-.29);pack(.99,1.1,L-.29);pack(1.565,1.1,L-.29,'accent');
  snowRacer(2.27);upperSledShelves(2.27);
 }
 if(['B','C'].includes(a.id))for(let i=0;i<2;i++){let m=new T.Mesh(new T.CylinderGeometry(.065,.065,.70,16),materials.gear);m.position.set(2.745,.40,L-.17-i*.15);furnitureGroup.add(m);}
 box(.055,1.90,.035,.065,.95,L-.12,'wood',furnitureGroup);
 rightWall();
 }
 function build(){if(scene)scene.traverse(o=>{if(o.geometry)o.geometry.dispose();});objects=[];equipmentMeshes=[];selected=null;selectionBox=null;labels=[];scene=new T.Scene();scene.scale.x=-1;scene.background=new T.Color('#e9e9e0');scene.environment=environment;materials={};for(const k of ['wood','metal','floor','white','glass','bin','gear','rubber','accent'])materials[k]=mat(k);dimensionGroup=new T.Group();scene.add(dimensionGroup);
 scene.add(new T.HemisphereLight(0xf5f7ff,0x9b896f,1.6));
 const sun=new T.DirectionalLight(0xfff3dc,1.7);sun.position.set(1,5,-3);sun.target.position.set(-1,0,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-5,right:5,top:7,bottom:-5,near:.1,far:20});sun.shadow.bias=-.0002;sun.shadow.normalBias=.008;sun.shadow.radius=4;scene.add(sun,sun.target);
 const fill=new T.DirectionalLight(0xdce9ff,.65);fill.position.set(-4,3,1);scene.add(fill);
 box(W+.16,.12,L+.1,W/2,-.065,L/2,'floor');
 const concrete=materials.floor.clone();concrete.color.set('#8d9088');box(.06,.13,L,W-.005,.065,L/2,concrete);box(.06,.13,L,.005,.065,L/2,concrete);
 // Individual pine boards: actual room interior faces remain x=2.83 and z=6.10.
 for(let i=0;i<20;i++){const w=W/20;const m=materials.wood.clone();m.color.multiplyScalar(.92+random()*.15);box(w-.003,H,.034,(i+.5)*w,H/2,L+.017,m);}
 for(let i=0;i<43;i++){const d=L/43;const m=materials.wood.clone();m.color.multiplyScalar(.92+random()*.15);box(.034,H,d-.003,W+.017,H/2,(i+.5)*d,m);}
 // Left wall: exposed studs and horizontal battens, as in the garage photo.
 // Stud faces define the measured usable x=0 boundary; cladding sits behind them.
 for(let i=0;i<43;i++){const d=L/43;const m=materials.wood.clone();m.color.multiplyScalar(.92+random()*.15);const board=box(.034,H,d-.003,-.061,H/2,(i+.5)*d,m);board.userData.wall='left';board.userData.wallPart='panel';}
 for(let z=.25;z<L;z+=.61){const stud=box(.044,H,.07,-.022,H/2,z,'wood');stud.userData.wall='left';stud.userData.wallPart='stud';}
 for(const y of [.7,1.43]){const batten=box(.025,.06,L,-.0315,y,L/2,'wood');batten.userData.wall='left';batten.userData.wallPart='batten';}
 for(const z of [2.03,4.06])box(W,.001,.004,W/2,.001,z,new T.MeshStandardMaterial({color:'#777c75',roughness:1}));
 const studio=new T.MeshStandardMaterial({color:'#e9e9e0',roughness:1});box(200,.02,200,W/2,-.145,L/2,studio);

 for(const m of scene.children){if(m.userData.wall)continue;if(m.isMesh&&m.position.z>=L-.05)m.userData.wall='back';else if(m.isMesh&&m.position.x>=W-.05)m.userData.wall='right';}
 const accent=materials.accent.clone();accent.transparent=true;accent.opacity=.10;box(.58,.005,4.797,.29,.008,2.6485,accent);
 const a=data.layouts[current];box(W,.005,a.frontGap,W/2,.009,5.047+a.frontGap/2,accent);
 loftGroup=new T.Group();scene.add(loftGroup);let lm=materials.wood.clone();lm.transparent=true;lm.opacity=.13;lm.depthWrite=false;box(W,.04,L,W/2,H+.02,L/2,lm,loftGroup);for(let z=.6;z<6;z+=1.2)line([0,H,z],[W,H,z],token('--garage-metal'),loftGroup);loftGroup.visible=root.querySelector('#garage-loft').checked;
 storage();for(const m of furnitureGroup.children){if(!m.userData.objectId&&(m.material===materials.gear||m.material===materials.wood)){register([m],null,{title:'Existing camping gear',note:'Representative camping bag, mat or long item; dimensions need measuring.'});equipmentMeshes.push(m);}}makeCar();register(carGroup.children.filter(m=>m.isMesh),null,{title:'Model Y parking envelope',dimensions:[data.car.foldedWidth,data.car.length,data.car.height],note:'Official planning dimensions; simplified body shape. Folded mirrors: 198.2 cm; body: 192 cm; open mirrors: 212.9 cm. Driver-door and hatch movement are not modelled.'});carGroup.traverse(m=>{if(m.isMesh){m.material=m.material.clone();m.material.transparent=true;m.material.opacity=.27;m.material.depthWrite=false;}});
 dimension([0,2.18,L-.20],[W,2.18,L-.20],'2.83 m',[W/2,2.24,L-.20],.8);dimension([0,.04,-.35],[W,.04,-.35],'2.83 m',[W/2,.05,-.55],1.8);
 dimension([-.30,.03,0],[-.30,.03,L],'6.10 m',[-.45,.10,3.0],1.8);
 makeBikes();updateCamera(); updateTable(); populateObjects(); applyVisibility();render();root.dataset.ready='true';
 }
 function updateCamera(){const w=host.clientWidth,h=host.clientHeight,aspect=w/h;renderer.setSize(w,h,false);controls?.dispose();let pos,target=[-W/2,.9,L/2];const orth=['plan','front','back','left','side-right','right','left-wall'].includes(view);
 if(orth){const span=(view==='plan'?7.1:['left','side-right','right','left-wall'].includes(view)?Math.max(3.3,6.9/aspect):Math.max(3.2,3.3/aspect));camera=new T.OrthographicCamera(-span*aspect/2,span*aspect/2,span/2,-span/2,.03,100);camera.userData.span=span;}else camera=new T.PerspectiveCamera(43,aspect,.03,100);
 if(view==='rear'){pos=[-1.08,2.05,1.05];target=[-1.42,1.05,5.85];}else if(view==='left-wall'){pos=[-2.5,1.05,L/2];target=[0,1.05,L/2];}else if(view==='right'){pos=[-.20,1.05,L/2];target=[-W,1.05,L/2];}else if(view==='plan'){pos=[-W/2,12,3.05];target=[-W/2,0,3.05];camera.up.set(0,0,1);}else if(view==='front'){pos=[-W/2,.9,-8];}else if(view==='back'){pos=[-W/2,.9,14];}else if(view==='left'){pos=[8,.9,L/2];}else if(view==='side-right'){pos=[-10,.9,L/2];}else{pos=[4.15,5.5,-4.8];target=[-1.42,.65,3.10];}
 if(aspect<1&&view==='rear')pos[2]-=1.7;
 camera.position.set(...pos);camera.lookAt(new T.Vector3(...target));controls=new OrbitControls(camera,renderer.domElement);controls.target.set(...target);controls.enableDamping=true;controls.dampingFactor=.12;controls.minDistance=.45;controls.maxDistance=18;controls.maxPolarAngle=Math.PI*.5;controls.update();
 composer?.dispose();composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));ao=new SSAOPass(scene,camera,w,h);ao.enabled=!orth;ao.kernelRadius=8;ao.minDistance=.002;ao.maxDistance=.12;composer.addPass(ao);composer.addPass(new OutputPass());composer.addPass(new SMAAPass(w,h));controls.addEventListener('change',()=>{updateWalls();render();});composer.setSize(w,h);root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));applyVisibility();render();}
 function applyVisibility(){if(!scene)return;if(bikeGroup)bikeGroup.visible=root.querySelector('#garage-bikes').checked;root.querySelector('#bike-controls').hidden=!root.querySelector('#garage-bikes').checked;root.querySelector('#bike-status').hidden=!root.querySelector('#garage-bikes').checked;updateWalls();carGroup.visible=root.querySelector('#garage-car').checked;for(const o of equipmentMeshes)o.visible=root.querySelector('#garage-gear').checked;labels.forEach((l,i)=>{l.visible=root.querySelector('#garage-dims').checked&&(['overview','plan'].includes(view)||['rear','front','back'].includes(view)&&i===0);});loftGroup.visible=root.querySelector('#garage-loft').checked;render();}
 function focusObject(){if(!selected)return;const b=objectBounds(selected),center=b.getCenter(new T.Vector3()),size=b.getSize(new T.Vector3());const distance=Math.max(.85,size.length()*1.35);const dir=new T.Vector3(.2,.32,-1).normalize();camera.up.set(0,1,0);camera.position.copy(center).addScaledVector(dir,distance);controls.target.copy(center);controls.update();render();}
 root.querySelector('#reset-view').addEventListener('click',updateCamera);root.querySelector('#focus-item').addEventListener('click',focusObject);root.querySelector('#object-list').addEventListener('change',e=>selectObject(objects.find(o=>o.id===e.target.value)));
 for(const id of ['garage-gear','garage-dims','garage-bikes','garage-cutaway'])root.querySelector('#'+id).addEventListener('change',()=>{if(id==='garage-bikes'&&root.querySelector('#garage-bikes').checked)root.querySelector('#garage-car').checked=true;applyVisibility();});
 const raycaster=new T.Raycaster(),pointer=new T.Vector2();let down=null;
 renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,time:performance.now()};});
 function pick(e){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(scene.children,true);for(const hit of hits){let o=hit.object,visible=true;while(o){if(!o.visible)visible=false;o=o.parent;}if(!visible||!hit.object.isMesh)continue;return objects.find(o=>o.id===hit.object.userData.objectId)||null;}return null;}
 renderer.domElement.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<6&&performance.now()-down.time<700)selectObject(pick(e));down=null;});
 renderer.domElement.addEventListener('pointermove',e=>{if(e.buttons)return;renderer.domElement.style.cursor=pick(e)?'pointer':'grab';});

 root.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;root.querySelector('#garage-view').value=view;updateCamera();}));

 function updateWalls(){if(!scene||!camera)return;const cut=root.querySelector('#garage-cutaway').checked;scene.traverse(m=>{const side=m.userData.wall;if(side)m.visible=!(cut&&(side==='left'&&camera.position.x>0||side==='right'&&camera.position.x<-W||side==='back'&&camera.position.z>L));});}
 const money=v=>new Intl.NumberFormat('nb-NO',{maximumFractionDigits:2}).format(v)+' kr';
 function updateTable(){const a=data.layouts[current];root.querySelector('#garage-title').textContent=a.id+' · '+a.name;root.querySelector('#garage-price').textContent=money(a.productsTotal)+' products';root.querySelector('#garage-metrics').innerHTML='<span>Floor rear gap <strong>'+Math.round(a.frontGap*100)+' cm</strong></span><span>Rear depth <strong>'+Math.round(a.depth*100)+' cm</strong></span><span>Starter boxes <strong>'+a.binLitres+' L</strong></span>';
 root.querySelector('#garage-equipment').textContent=a.summary+' '+a.equipment;root.querySelector('#garage-products').innerHTML=[...a.items,...data.common].map(([k,n])=>{const p=data.products[k];return '<tr><td><a href="'+p.url+'" target="_blank" rel="noopener noreferrer">'+p.name+'</a></td><td class="text-end">'+n+'</td><td class="text-end text-nowrap">'+money(p.price)+'</td><td class="text-end text-nowrap">'+money(n*p.price)+'</td></tr>'}).join('');root.querySelector('#garage-totals').innerHTML='<tr><th colspan="3">Product total</th><th class="text-end text-nowrap">'+money(a.productsTotal)+'</th></tr><tr><td colspan="3">Construction / fixings allowance (estimate)</td><td class="text-end text-nowrap">'+money(a.allowance)+'</td></tr><tr><th colspan="3">Planning budget</th><th class="text-end text-nowrap">'+money(a.budgetTotal)+'</th></tr>';
 }
 root.querySelectorAll('[data-layout]').forEach(b=>b.addEventListener('click',()=>{current=Number(b.dataset.layout);root.querySelectorAll('[data-layout]').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));build();}));
 root.querySelector('#garage-view').addEventListener('change',e=>{view=e.target.value;updateCamera();});root.querySelector('#garage-car').addEventListener('change',applyVisibility);root.querySelector('#garage-loft').addEventListener('change',e=>{loftGroup.visible=e.target.checked;render();});
 new ResizeObserver(()=>{if(!camera)return; const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);if(camera.isOrthographicCamera){const span=camera.userData.span;camera.left=-span*w/h/2;camera.right=span*w/h/2;}else camera.aspect=w/h;camera.updateProjectionMatrix();composer?.setSize(w,h);render();}).observe(host);
 build();
 renderer.setAnimationLoop(()=>{controls?.update();});
 window.garageModel={data,setLayout:i=>{root.querySelector('[data-layout="'+i+'"]').click()},setView:v=>{root.querySelector('#garage-view').value=v;root.querySelector('#garage-view').dispatchEvent(new Event('change'))},capture:()=>renderer.domElement.toDataURL('image/png'),getScene:()=>scene,getObjects:()=>objects.map(({id,key,meta})=>({id,key,meta})),select:id=>selectObject(objects.find(o=>o.id===id)),project:id=>{const o=objects.find(o=>o.id===id);const b=objectBounds(o);return b.getCenter(new T.Vector3()).project(camera).toArray();}};

