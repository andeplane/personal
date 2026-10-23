import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
const photoPlans=[{"id":"rear-wall","label":"Wall shelves \u00b7 38 cm","depthCm":38,"output":"assets/garage-rear-wall.jpg","outputSHA256":"70ec01bff6dc0f86d76816697fa36f83fcf28b11811e6d05a10cd8863ea0c975","source3D":"assets/garage-rear-wall-source.png","source3DHash":"f4b4fc527b0297ea3d01e0310d2a84264f601120e634ba7892766cb7dcb6f5a6"},{"id":"rear-double","label":"Two racks \u00b7 55 cm","depthCm":55,"output":"assets/garage-rear-double.jpg","outputSHA256":"f66da7bdf02f5424fe61dbc69d82e1be05ab25bc2178834bda7cde3dc5d0ad04","source3D":"assets/garage-rear-double-source.png","source3DHash":"20a460b41038c3bc66db2d98d0624e53c967a6fb880b695a3da1f4e764c2625f"},{"id":"rear-single","label":"One rack + open bay \u00b7 55 cm","depthCm":55,"output":"assets/garage-rear-single.jpg","outputSHA256":"804e471c1138050f95a0d5b55f0fa14f6543bd1fab6373f041ba7536961a9c06","source3D":"assets/garage-rear-single-source.png","source3DHash":"4f7f63e11c37d291ccfe2f47a89e1226471a14ed018914a7dcb6163ac1bf23f8"},{"id":"rear-bulk","label":"Industrial racks \u00b7 80 cm","depthCm":80,"output":"assets/garage-rear-bulk.jpg","outputSHA256":"d78e63ae21c3477856cad4c6f2e072e054521f0fd9ad05098a2929f844aa16ce","source3D":"assets/garage-rear-bulk-source.png","source3DHash":"d01ecfdaec0b6a51351e14b0bca00c1ccf62fce536c17a46b17426b337b1b186"},{"id":"left-built","label":"Built left wall \u00b7 20 / 28 / 38 cm","depthCm":38,"output":"assets/garage-left-built.jpg","outputSHA256":"84cca45d875b5f6da5375907906406a508838165988ffd5ced3c77c0f56a365f","source3D":"assets/garage-left-built-source.png","source3DHash":"31b03b5c87f8d3401850ed44fd2700aa6750407c244c10a05393e6eacc9c84b3"},{"id":"left-lower","label":"Built left wall \u00b7 20 / 28 cm","depthCm":28,"output":"assets/garage-left-lower.jpg","outputSHA256":"e7c75f4f964b65ba84dd1f3b96b178b5fccf8666c6790524f5e5dcde5617db4e","source3D":"assets/garage-left-lower-source.png","source3DHash":"72b441e9bd2b98efc6b95de1ac10f6b0d6a4f24e01d7c8f24cdb111526256882"},{"id":"left-high","label":"High left run \u00b7 38 cm","depthCm":38,"output":"assets/garage-left-high.jpg","outputSHA256":"5cc9171ef9205b930d56dc58c97e95e7f5d1f3db7495cda95969a95b1823b962","source3D":"assets/garage-left-high-source.png","source3DHash":"af656d1e89df8480bdab16f6a4735212cffd23fb6020ce5e290b728d96eebd3e"},{"id":"right-high","label":"High right extension \u00b7 28 cm","depthCm":28,"output":"assets/garage-right-high.jpg","outputSHA256":"42d98daa7b48b6196d11fbadff892371ff5fae93d3c0a180000b9449a695d6c9","source3D":"assets/garage-right-high-source.png","source3DHash":"eb8383d9f98590d5e4961cdef13df78c3447ff847c84061135afa2884cb97275"},{"id":"rear-high","label":"High rear shelves \u00b7 38 cm","depthCm":38,"output":"assets/garage-rear-high.jpg","outputSHA256":"5e77f8a51100cbcfed8cb985aa3ede4211a7ec135e8fc1e7ab03c25d2e053501","source3D":"assets/garage-rear-high-source.png","source3DHash":"66441daa1cefc285ab2dfb69bba7fc0aaf5562e20a61494dad12e69efc9aae0b"}];


 const root=document.getElementById('garage-options');
 const data=await (await fetch('./design-data.json',{cache:'no-store'})).json();
 const host=root.querySelector('#garage-scene');
 const  W=data.room.width,L=data.room.length,H=data.room.loftUnderside;
 let current=1, view='left-wall', scene,camera,carGroup,loftGroup, furnitureGroup;
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
// Independent choices; rear storage never changes the user's wall selections.
function configuration(){return {
 rear:root.querySelector('#rear-storage').value,
 recess:root.querySelector('#recess-storage').value,
 upperLeft:Number(root.querySelector('#upper-left').value),
 upperRight:root.querySelector('#upper-right').checked,
 upperRear:root.querySelector('#upper-rear').checked
};}
function composePlan(c=configuration()){
 const rear=data.rearOptions.find(a=>a.id===c.rear)||data.rearOptions.find(a=>a.id===data.defaults.rear);
 return {...rear,recessMode:c.recess,upperRuns:c.upperLeft,upperRight:c.upperRight,upperRear:c.upperRear};
}
function currentPlan(){return composePlan();}
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
 g.scale.y=1.3/1.38;g.position.y=base;g.position.z=-currentPlan().standOff-.006;furnitureGroup.add(g);
 register([g],null,{title:'Rattkjelke · one existing snow racer',kind:'existing',dimensions:[.60,.40,1.30],note:'One existing sled, estimated upright envelope. Stored on the lowest shelf; the next shelf is above its ski tips.'});equipmentMeshes.push(g);
}
function objectBounds(o){scene.updateMatrixWorld(true);const b=new T.Box3();for(const m of o.meshes)b.expandByObject(m);return b;}
const productLink=(key,label)=>'<a href="'+data.products[key].url+'" target="_blank" rel="noopener">'+(label||data.products[key].name)+' ↗</a>';
function populateObjects(){
 const sel=root.querySelector('#object-list');sel.innerHTML='<option value="">Choose a product</option>';
 const seen=new Set();
 for(const o of objects.filter(o=>o.key)){if(seen.has(o.key))continue;seen.add(o.key);const op=document.createElement('option');op.value=o.id;op.textContent=data.products[o.key].name;sel.append(op);}
 root.querySelector('#selection').innerHTML='<h2>Click a storage product.</h2><p>Every selectable item has a retailer, SKU, price and direct buying link. Existing walls and belongings are context.</p>';root.querySelector('#focus-item').disabled=true;
}
function selectObject(o){
 if(selectionBox){scene.remove(selectionBox);selectionBox.traverse(m=>{m.geometry?.dispose();});selectionBox=null;}
 if(o&&!o.key)o=null;
 selected=o||null;const panel=root.querySelector('#selection');root.querySelector('#focus-item').disabled=!o;root.querySelector('#object-list').value=o?objects.find(x=>x.key===o.key).id:'';
 if(!o){panel.innerHTML='<h2>Click a storage product.</h2><p>Choose a shelf, basket or rail for its price and purchase link.</p>';render();return;}
 root.querySelector('#object-panel').open=true;
 const m=o.meta,p=data.products[o.key],rows=[['Retailer / SKU',p.retailer+' · '+p.sku],['Price incl. VAT',(p.priceQualifier?'From ':'')+money(p.price)+(p.packSize?' / '+p.packSize+' pack':' / item')],['Retail dimensions',p.dimensionsText||p.dimensions.map(v=>Number((v*100).toFixed(1))).join(' × ')+' cm']];
 if(m.dimensions)rows.push([m.dimensionLabel||'Model W × D × H',m.dimensions.map(v=>Number((v*100).toFixed(1))).join(' × ')+' cm']);
 if(m.height!==undefined)rows.push(['Above floor',Number((m.height*100).toFixed(1))+' cm']);
 if(m.projection!==undefined)rows.push(['Beyond stud faces',Number((m.projection*100).toFixed(1))+' cm']);
 panel.innerHTML='<h2>'+m.title+'</h2><p class="purchase-link">'+productLink(o.key,'View / buy at '+p.retailer)+'</p><dl>'+rows.map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+v+'</dd></div>').join('')+'</dl><p>'+p.note+'</p>'+(m.note?'<p>'+m.note+'</p>':'')+'<p class="fine">Price checked '+p.checked+'. '+p.availability+'. Shipping is extra where applicable.</p>';
 selectionBox=new T.Group();selectionBox.scale.x=-1;const outline=new T.Box3Helper(objectBounds(o),0xc58639);outline.material.depthTest=false;outline.material.transparent=true;outline.material.opacity=.85;outline.renderOrder=100;selectionBox.add(outline);scene.add(selectionBox);render();
}
 // Typical adult hybrid-bike planning proxies, not measured user bikes.
 // Bike: 1.80 m long × 0.65 m handlebar width × 1.10 m high.
 function makeBikes(){bikeGroup=new T.Group();scene.add(bikeGroup);const spacing=Number(root.querySelector('#bike-spacing').value)/100,depth=.65+2*spacing;const end=L-(currentPlan().bikeBlockingDepth??currentPlan().depth)-.05,start=end-depth;
 for(let i=0;i<3;i++){const g=new T.Group();bikeGroup.add(g);g.position.set(W/2+(i===2?.15:0),0,start+.325+i*spacing);g.rotation.y=i===1?-Math.PI/2:Math.PI/2;g.userData.bikeIndex=i;const frame=materials.metal.clone();frame.color.set(['#47756d','#b36b39','#546880'][i]);const metal=new T.MeshStandardMaterial({color:'#b9c4c7',metalness:.8,roughness:.3});
 const tube=(a,b,r=.018,mat=frame)=>{const va=new T.Vector3(...a),vb=new T.Vector3(...b),v=vb.clone().sub(va);const m=new T.Mesh(new T.CylinderGeometry(r,r,v.length(),12),mat);m.position.copy(va.add(vb).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());m.castShadow=true;g.add(m);};
 for(const z of [-.55,.55]){const wheel=new T.Mesh(new T.TorusGeometry(.326,.024,10,56),materials.rubber);wheel.rotation.y=Math.PI/2;wheel.position.set(0,.35,z);wheel.castShadow=true;g.add(wheel);const rim=new T.Mesh(new T.TorusGeometry(.304,.008,8,48),metal);rim.rotation.y=Math.PI/2;rim.position.copy(wheel.position);g.add(rim);for(let k=0;k<20;k++){const a=k/20*Math.PI*2;tube([0,.35,z],[0,.35+Math.sin(a)*.3,z+Math.cos(a)*.3],.0015,metal);}}
 const rear=[0,.35,-.55],bb=[0,.30,-.12],seat=[0,.78,-.22],head=[0,.77,.40],front=[0,.35,.55];for(const [a,b] of [[rear,bb],[rear,seat],[bb,seat],[seat,head],[bb,head],[head,front]])tube(a,b);tube(seat,[0,.97,-.25],.013,metal);tube(head,[0,1.075,.36],.014,metal);tube([-.325,1.075,.36],[.325,1.075,.36],.012,metal);
 for(const x of [-.275,.275])tube([x-.05,1.075,.36],[x+.05,1.075,.36],.025,materials.rubber);
 box(.18,.045,.25,0,.978,-.27,'rubber',g);tube([-.13,.3,-.12],[.13,.3,-.12],.01,metal);box(.08,.025,.10,-.16,.3,-.12,'rubber',g);box(.08,.025,.1,.16,.3,-.12,'rubber',g);
 register(g.children.filter(m=>m.isMesh),null,{title:'Bike '+(i+1)+' · adult hybrid estimate',dimensions:[1.80,.65,1.10],note:'Turned 90 degrees across the garage. Alternating directions, with bike 3 offset 15 cm across the room to stagger handlebars. Shown dimensions follow garage axes. Original bike size: 180 cm long × 65 cm handlebars × 110 cm high. Nesting is a planning approximation: verify pedals, bars and brake cables against your actual bikes.'});}
 const overlap=Math.max(0,data.car.entranceGap+data.car.length-start);if(overlap>0){const red=new T.MeshStandardMaterial({color:'#c44d34',transparent:true,opacity:.30,depthWrite:false});box(1.92,.012,overlap,data.car.centerX,.016,start+overlap/2,red,bikeGroup);}
 const outline=new T.Box3Helper(new T.Box3(new T.Vector3(W/2-.9,0,start),new T.Vector3(W/2+1.05,1.1,end)),0xb38345);bikeGroup.add(outline);
 const panel=root.querySelector('#bike-status');panel.innerHTML='<h3>Three bikes · nested sideways</h3><p>Each bike: <strong>180 × 65 × 110 cm</strong> (L × W × H), estimated. Alternating directions; third bike staggered 15 cm across the garage.</p><p>Packed group: <strong>195 cm across × '+Math.round(depth*100)+' cm deep</strong> at '+Math.round(spacing*100)+' cm between wheel planes. Plus 5 cm to the rear shelves.</p><p>Current floor-level rear gap: <strong>'+Math.round(currentPlan().frontGap*100)+' cm</strong>. '+(overlap>0?'This setting extends <strong>'+Math.round(overlap*100)+' cm into the car’s rectangular envelope</strong> (red area).':'The group envelope clears the parked-car envelope at this setting.')+'</p><p class="fine">This optional packing study is not part of the default storage allocation. Actual nesting, access and the loft approach need checking; three bicycles are not claimed to fit with the parked car.</p>';
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
  box(.055,.35,.30,W-.085,.20,1.65,'rubber',furnitureGroup);
  rod([W-.085,.32,1.65],[W-.085,1.50,1.65],.016,'wood',furnitureGroup);
  rod([W-.085,1.50,1.56],[W-.085,1.50,1.74],.018,'rubber',furnitureGroup);
 },null,{title:'Existing snow shovel / long tool · estimated envelope',side:'right',dimensions:[.32,.12,1.55],dimensionLabel:'Along wall × projection × height',note:'Long-tool example for the observed equipment category, using a shallow wall position. Exact shape, length and placement are unmeasured.'},true);
 for(const z of [2.6,3.2,4.15,4.95])capture(()=>rod([W-.01,1.5,z],[W-.08,1.5,z],.01,'metal',furnitureGroup),null,{title:'Right wall · folded-gear mounting point',kind:'existing-storage',height:1.5,note:'Reuse the observed hooks and straps. About 15 cm total folded-gear projection is assumed; actual gear and fixing locations need checking.'});
 for(const z of [2.6,3.2])capture(()=>{
  box(.08,.47,.4,W-.095,1.05,z,'rubber',furnitureGroup);
  for(const zz of [z-.22,z+.22])rod([W-.14,.5,zz],[W-.14,1.5,zz],.014,'metal',furnitureGroup);
  for(const y of [.5,1.5])rod([W-.14,y,z-.22],[W-.14,y,z+.22],.014,'metal',furnitureGroup);
 },null,{title:'Existing folding chair',side:'right',dimensions:[.5,.16,1],dimensionLabel:'Along wall × projection × height',note:'Provisional folded size. Separate places avoid stacking the chairs farther into the garage.'},true);
 capture(()=>{
  for(const z of [3.94,4.36])rod([W-.10,.05,z],[W-.10,1.95,z],.022,'white',furnitureGroup);
  for(let y=.18;y<1.9;y+=.26)rod([W-.10,y,3.94],[W-.10,y,4.36],.02,'white',furnitureGroup);
 },null,{title:'Existing stepladder / gardintrapp',side:'right',dimensions:[.5,.15,1.9],dimensionLabel:'Along wall × projection × height',note:'Accessible folded wall position; estimated dimensions. This is not a specified loft-access ladder.'},true);
 const tableZ=Math.min(4.92,L-currentPlan().footprintDepth-.45);
 capture(()=>{
  box(.07,1.25,.75,W-.05,.65,tableZ,'white',furnitureGroup);
  box(.009,.03,.76,W-.095,1.05,tableZ,'accent',furnitureGroup);
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
  group.position.set(px,slot.y+.003,(slot.zBack??L)-slot.depth+d/2+.005);
  furnitureGroup.add(group);
  register([group],null,{title:item.title,kind:'example',dimensions:item.size,height:slot.y,note:'Representative size only; not a measurement of your belongings or a fixed quantity. Mixed packed / compressed bags can stand, lie down or hang. Remaining space is intentionally unallocated.'});equipmentMeshes.push(group);
 }
}
// Built shelves use the recess AND project beyond it. Existing structural timber is retained.
let leftWallStats={existing:0,added:0,area:0};
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
 // Retain the complete existing braces around all new recess storage.
 for(const ends of wall.braces){
  const [a,b]=ends,dy=b[1]-a[1],dz=b[0]-a[0],length=Math.hypot(dy,dz);
  const mesh=new T.Mesh(new RoundedBoxGeometry(d*.8,length,.065,2,.003),materials.wood);
  mesh.position.set(-d/2,(a[1]+b[1])/2,(a[0]+b[0])/2);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(0,dy,dz).normalize());
  mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
  register([mesh],null,{title:'Left wall · retained diagonal brace',kind:'existing-storage',side:'left',note:'Existing bracing is visible in the new photos. Its placement is schematic; new storage is placed in clear parts of the recesses. No brace is removed, notched or altered.'});
 }
}

function leftWallBlocked(z0,z1,y0,y1){
 const k=data.leftWall.chargerKeepout;return z1>k.z[0]&&z0<k.z[1]&&y1>k.y[0]&&y0<k.y[1];
}
function leftShelfRows(a){
 return [...(a.recessMode==='cut'?data.leftWall.builtShelfRows:[]),...(a.upperRuns?[{height:data.leftWall.highShelfHeight,key:'pine38',high:true}]:[])];
}
function leftBoardPlacements(a){
 const out=[],limit=L-a.footprintDepth-.04,wall=data.leftWall;
 for(const row of leftShelfRows(a))for(const [i,bay] of leftWallBays().entries()){
  const start=bay.start-wall.studWidth/2+.0025,end=bay.end+wall.studWidth/2-.0025;
  if(end>limit||leftWallBlocked(bay.start,bay.end,row.height-.018,row.height))continue;
  out.push({...row,bay:i,start,end,width:end-start,z:(start+end)/2,depth:data.products[row.key].dimensions[1],y:row.height});
 }
 return out;
}
function recessPlacements(a){return leftBoardPlacements(a).filter(p=>!p.high);}
function sideRuns(a){return leftBoardPlacements(a).filter(p=>p.high).map(p=>p.start);}
// Rear notches are sized against the complete thickness of the board and brace.
// They only remove new shelf material; every existing stud and brace remains intact.
function leftNotches(p){
 const wall=data.leftWall,gaps=[];
 for(let z=wall.firstStud;z<L;z+=wall.clearWidth+wall.studWidth)gaps.push([z-wall.studWidth/2-.003,z+wall.studWidth/2+.003]);
 for(const b of wall.braces){
  const dy=b[1][1]-b[0][1],dz=b[1][0]-b[0][0],len=Math.hypot(dy,dz),hy=.0325*Math.abs(dz)/len,hz=.0325*Math.abs(dy)/len;
  const ys=[p.y-.018-.004-hy,p.y+.004+hy];
  const t=ys.map(y=>(y-b[0][1])/dy).sort((a,b)=>a-b),lo=Math.max(0,t[0]),hi=Math.min(1,t[1]);
  if(lo>hi)continue;
  const zs=[b[0][0]+lo*dz,b[0][0]+hi*dz].sort((a,b)=>a-b);gaps.push([zs[0]-hz-.004,zs[1]+hz+.004]);
 }
 const clipped=gaps.map(([a,b])=>[Math.max(a,p.start),Math.min(b,p.end)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]),merged=[];
 for(const g of clipped){const last=merged.at(-1);if(last&&g[0]<=last[1])last[1]=Math.max(last[1],g[1]);else merged.push([...g]);}
 return merged;
}
function leftBoardParts(p){
 const rear=-data.leftWall.recessDepth+.005,front=rear+p.depth,parts=[{x0:.003,x1:front,z0:p.start,z1:p.end}];
 let z=p.start;
 for(const [a,b] of leftNotches(p)){if(a>z)parts.push({x0:rear,x1:.003,z0:z,z1:a});z=b;}
 if(z<p.end)parts.push({x0:rear,x1:.003,z0:z,z1:p.end});
 return parts;
}
function leftSupports(a){
 const out=[],seen=new Set(),wall=data.leftWall;
 for(const p of leftBoardPlacements(a))for(const z of [p.start-.0025,p.end+.0025]){
  const id=p.y.toFixed(3)+'/'+z.toFixed(4);if(seen.has(id))continue;seen.add(id);
  const key=p.high?'bracket30':p.key==='pine28'?'bracket20':'bracket10',arm=p.high?.20:p.key==='pine28'?.15:.10,height=p.high?.30:p.key==='pine28'?.20:.125;
  out.push({z,y:p.y,key,arm,height,high:p.high});
 }
 return out;
}
function leftWallStorage(){
 const wall=data.leftWall,d=wall.recessDepth,group=new T.Group();group.userData.wall='left';furnitureGroup.add(group);
 leftWallStats={existing:0,added:0,area:0,highArea:0,lowArea:0,highLength:0};
 function item(fn,key,meta){const n=group.children.length;fn();return register(group.children.slice(n),key,meta);}
 for(const [index,bay] of leftWallBays().entries())for(const y of wall.ledgeTops){
  item(()=>box(d,.045,bay.width,-d/2,y-.0225,bay.center,'wood',group),null,{title:'Left wall · existing ledge '+(index+1)+' / '+Math.round(y*100)+' cm',kind:'existing-storage',side:'left'});leftWallStats.existing++;
 }
 const placements=leftBoardPlacements(currentPlan());
 for(const p of placements){
  const parts=leftBoardParts(p),front=-d+.005+p.depth,area=parts.reduce((a,r)=>a+(r.x1-r.x0)*(r.z1-r.z0),0);
  item(()=>{for(const r of parts){const mesh=new T.Mesh(new T.BoxGeometry(r.x1-r.x0,.018,r.z1-r.z0),materials.wood);mesh.position.set((r.x0+r.x1)/2,p.y-.009,(r.z0+r.z1)/2);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);}},p.key,{
   title:'Built left shelf · '+Math.round(p.depth*100)+' cm deep / bay '+(p.bay+1)+' / '+Math.round(p.y*100)+' cm high',kind:'product',side:'left',insert:true,cut:true,high:Boolean(p.high),purchaseShare:.5,dimensions:[p.width,p.depth,.018],height:p.y,projection:front,usableArea:area,
   note:'CUT: 585 × '+Math.round(p.depth*1000)+' × 18 mm from a 1180 mm stock board; two blanks per board with 3 mm saw kerfs. Starts 5 mm off the back boards and includes the recess. Rear notches fit around existing studs and braces; only the new shelf is cut. Brackets attach to stud faces and are shared at board joints. Secure those joints with suitable joint plates / screws (unpriced). The 585 mm repeating cut and notch positions are schematic: measure each real bay before cutting. Installed load is not established.'
  });
  leftWallStats.added++;leftWallStats.area+=area;leftWallStats[p.high?'highArea':'lowArea']+=area;if(p.high)leftWallStats.highLength+=p.width;
 }
 for(const s of leftSupports(currentPlan()))item(()=>{
  const w=data.products[s.key].dimensions[0];
  box(.003,s.height,w,.0015,s.y-.018-s.height/2,s.z,'metal',group);
  box(s.arm,.003,w,s.arm/2,s.y-.0195,s.z,'metal',group);
  if(s.key==='bracket30')rod([.008,s.y-.018-s.height+.01,s.z],[s.arm-.01,s.y-.028,s.z],.005,'metal',group);
 },s.key,{title:'Built left shelf · stud support / '+Math.round(s.y*100)+' cm',kind:'product',side:'left',height:s.y-.018-s.height,projection:s.arm,dimensions:[data.products[s.key].dimensions[0],s.arm,s.height],note:'Complete retail bracket, oriented with its shorter leg under the shelf. Attached to a structural stud face. Shared support at adjacent board joints; joint plates and substrate-specific fasteners must be specified for the final installation.'});
 const cz=2.28;
 item(()=>{
  box(.12,.32,.19,.065,1.13,cz,'rubber',group);
  rod([.09,.97,cz],[.10,.70,cz],.012,'rubber',group);
  for(let i=0;i<3;i++){
   const points=[];for(let j=0;j<=48;j++){const a=j/48*Math.PI*2;points.push(new T.Vector3(.07+i*.018,.48+.23*Math.sin(a),cz+.19*Math.cos(a)));}
   group.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points),48,.011,8,false),materials.rubber));
  }
  rod([.005,.73,cz],[.14,.73,cz],.012,'metal',group);
 },null,{title:'Left wall · existing charger / cable space',kind:'existing-storage',side:'left',note:wall.chargerNote});
 leftWallExamples(placements,group);
}
function leftWallExamples(placements,group){
 // Deliberately sparse normal-size examples. They occupy real shelf surfaces.
 const examples=[{bay:0,row:.838,size:[.30,.16,.18],colour:'rubber'},{bay:2,row:1.178,size:[.32,.17,.16],colour:'gear'},{bay:5,row:1.518,size:[.34,.23,.22],colour:'rubber'},{bay:6,row:.498,size:[.30,.17,.22],colour:'gear'},... [1,4,6].map(bay=>({bay,row:1.84,size:[.46,.29,.22],colour:'gear'}))];
 for(const e of examples){
  const p=placements.find(p=>p.bay===e.bay&&Math.abs(p.y-e.row)<.001);if(!p)continue;
  const [w,dep,h]=e.size,front=-data.leftWall.recessDepth+.005+p.depth,x=front-dep/2-.008;
  // Don't put an example into retained diagonal timber; leave that shelf empty.
  if(leftWallBraceCrosses({start:p.z-w/2,end:p.z+w/2},p.y+h/2,h/2+.02))continue;
  const m=new T.Mesh(new RoundedBoxGeometry(dep,h,w,3,.025),fabricMaterial(e.colour));m.position.set(x,p.y+.003+h/2,p.z);m.castShadow=m.receiveShadow=true;group.add(m);
  register([m],null,{title:'Left shelf · compact bag / equipment example',kind:'example',side:'left',dimensions:[w,dep,h],height:p.y,note:'Illustrative compact contents; remaining surfaces are unallocated.'});equipmentMeshes.push(m);
 }
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
 const carLeft=data.car.centerX-data.car.foldedWidth/2,z0=data.car.entranceGap,z1=L-currentPlan().footprintDepth;
 const leftEdge=currentPlan().recessMode==='cut'?.22:.14;
 planPatch(parkingPath,leftEdge,carLeft-.02,z0,z1,.018,'#3d7162',.13);
 const clear=1.70;
 for(const x of [leftEdge,carLeft-.02]){
  line([x,clear,z0],[x,clear,z1],'#3d7162',parkingPath);
  for(const z of [z0,z1])line([x,.025,z],[x,clear,z],'#3d7162',parkingPath);
 }
 emptyFloor=new T.Group();accessGroup.add(emptyFloor);
 planPatch(emptyFloor,.18,W-.32,.25,z1-.08,.014,'#3d7162',.10);
}
function updateSpaceStatus(){
 const parked=root.querySelector('#garage-car').checked,loft=root.querySelector('#garage-loft').checked;
 const rearStart=L-currentPlan().footprintDepth;
 const blocked=loftStats.accessEnd>rearStart-.03;
 accessGroup.visible=root.querySelector('#garage-access').checked;
 loftGroup.userData.allocation.visible=accessGroup.visible;
 // A top comparison hides the deck by view, while the floor plan remains visible.
 loftGroup.visible=loft&&view!=='plan';
 loftGroup.userData.structure[0].material.opacity=['loft','photo'].includes(view)?1:.12;
 root.querySelector('#plan-note').hidden=view!=='plan';
 parkingPath.visible=parked;emptyFloor.visible=!parked;
 root.querySelector('#loft-length-value').textContent=loftStats.length.toFixed(1)+' m';
 root.querySelector('#loft-status').textContent=blocked?'The assumed loft approach overlaps rear storage / the rear wall. Revise the loft edge or access arrangement.':parked?'Move car out for the reserved loft approach and a usable work area.':'The reserved loft approach is clear of rear storage in this model. Final access method still needs checking.';
 root.querySelector('#space-status').innerHTML=parked?'<strong>Car parked:</strong> '+Math.round(currentPlan().frontGap*100)+' cm rear gap. Left side: about 55 cm from studs to the folded-mirror envelope. '+(currentPlan().recessMode==='cut'?'Built shelves leave about 43 cm at lower levels and 35 cm at the 1.52 m ledge. ':'')+(currentPlan().upperRuns?'High left shelf: 29.5 cm projection at 1.84 m; supports descend to 1.52 m. ':'')+'Door movement is unmodelled.':'<strong>Car out:</strong> the centre becomes working and retrieval space; keep the marked loft approach available.';
}
// Retail furniture and uncut wall boards share one plan-specific allocation.
let shelfZones=[];
function shelfZone(x,width,depth,y,next,thickness=.032,zBack=L){shelfZones.push({x,width,depth,y,clear:next-y-thickness,area:width*depth,zBack});}
function storageHeight(){return root.querySelector('#garage-upper').checked?Number(root.querySelector('#rear-height').value)/100:H;}
function upperClearance(){return H+(storageHeight()-H)*(L-.4-4)/(L-4);}
function upperLevels(){return upperClearance()>=2.38?[2.20]:[];}
function rearBoards(a){return [...a.rearPine,...(a.upperRear?upperLevels():[]).flatMap(y=>[[.76,y],[2.03,y]])];}
// All boards keep retail dimensions. Brackets are modeled below the boards.
function pineShelf(key,side,along,y,title){
 const [length,depth,t]=data.products[key].dimensions,group=new T.Group();
 group.position.set(side==='left'?0:side==='right'?W:along,y,side==='back'?L:along);
 group.rotation.y=side==='left'?-Math.PI/2:side==='right'?Math.PI/2:0;
 furnitureGroup.add(group);
 const item=(fn,k,m)=>{const n=group.children.length;fn();register(group.children.slice(n),k,m);};
 item(()=>box(length,t,depth,0,-t/2,-depth/2,'wood',group),key,{title,kind:'product',side,dimensions:[length,depth,t],height:y,note:'Uncut retail board. Three 30 cm Habo supports are included below it; their full 20 cm height is shown. Fix to suitable structural backing. Side shelves at 195 cm have only about 15 cm above them under the assumed loft: flat, light items only; this is not full-height walking space beneath the brackets.'});
 for(const x of [-.50,0,.50])item(()=>{
  box(.03,.20,.008,x,-t-.10,-.004,'metal',group);
  box(.03,.008,.30,x,-t-.004,-.15,'metal',group);
  rod([x,-t-.19,-.01],[x,-t-.01,-.29],.007,'metal',group);
 },'bracket30',{title:title+' · Habo support',kind:'product',side,height:y-t-.20});
}
function wallShelves(){
 const a=currentPlan();
 // The fitted left runs, including their supports, are built in leftWallStorage().
 if(a.upperRight)pineShelf('pine28','right',.79,1.95,'High right · front extension to existing ski shelf');
 const boards=rearBoards(a);
 for(const [x,y] of boards){
  pineShelf('pine38','back',x,y,'Rear wall · uncut 118 × 38 cm / '+Math.round(y*100)+' cm');
  const above=boards.filter(p=>p[0]===x&&p[1]>y).map(p=>p[1]).sort((a,b)=>a-b)[0];
  shelfZone(x,1.18,.38,y,above??upperClearance(),.22,L);
 }
}
function transformStorage(){
 const a=currentPlan();furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];
 const start=.06,zBack=L-a.standOff;
 const centers=[start+.4875,start+.975+.455,start+.975+.91+.455];
 for(let bay=0;bay<a.rackCount;bay++){
  const x=centers[bay],key=bay===0?a.baseKey:a.extensionKey;
  capture(()=>{
   // Nominal rack members; outer width / depth / height follow the retail specification.
   const ends=bay===0?[start+.0175,start+.9575]:[start+.975+bay*.91-.0175];
   for(const xx of ends){
    for(const z of [zBack-.0175,zBack-a.depth+.0175])box(.035,a.top,.035,xx,a.top/2,z,'metal',furnitureGroup);
    for(const y of [.3,1.05,1.8]){box(.025,.025,a.depth,xx,y,zBack-a.depth/2,'metal',furnitureGroup);}
    rod([xx,.32,zBack-.03],[xx,1.78,zBack-a.depth+.03],.007,'metal',furnitureGroup);
   }
   a.shelves[bay].forEach(y=>{
    box(.9,.032,a.depth,x,y-.016,zBack-a.depth/2,'metal',furnitureGroup);
   });
  },key,{title:'Rear bay '+(bay+1)+' · TRANSFORM '+(bay===0?'starter':'extension')+' / '+Math.round(a.depth*100)+' cm',kind:'product',dimensions:[bay===0?.975:.91,a.depth,a.top],note:'Four included shelves are repositioned in this bay; no extra shelf is assumed. Heights are nominal positions on the 32 mm grid. Run: 188.5 cm wide, leaving a separate tall sled bay. Outer rack members are simplified.'});
  a.shelves[bay].forEach((y,i)=>shelfZone(x,.9,a.depth,y,a.shelves[bay][i+1]??Math.min(2.18,storageHeight()),.032,zBack));
 }
 snowRacer(2.30,0);

}
function brorStorage(){
 const a=currentPlan();
 for(let bay=0;bay<a.rackCount;bay++){
  const x=.48+bay*.87,zBack=L-a.standOff;
  capture(()=>{
   for(const xx of [x-.4125,x+.4125])for(const z of [zBack-.0125,zBack-.5375])box(.025,1.9,.025,xx,.95,z,'metal',furnitureGroup);
   for(const xx of [x-.4125,x+.4125])for(const y of [.2,1.0,1.85])box(.02,.02,.55,xx,y,zBack-.275,'metal',furnitureGroup);
   for(const y of a.shelves[bay])box(.84,.02,.54,x,y-.01,zBack-.275,'metal',furnitureGroup);
   rod([x-.40,.15,zBack-.0125],[x+.4,1.85,zBack-.0125],.006,'metal',furnitureGroup);
  },'deep',{title:'Rear bay '+(bay+1)+' · BROR 85 × 55 × 190 cm',kind:'product',dimensions:[.85,.55,1.9],note:'All five supplied 84 × 54 cm shelves are used, at nominal mixed heights. Stock outside size is 85 × 55 × 190 cm. Two units remain independent and wall-anchored; no connection kit is assumed.'});
  a.shelves[bay].forEach((y,i)=>shelfZone(x,.84,.54,y,a.shelves[bay][i+1]??Math.min(2.18,storageHeight()),.04,zBack-.005));
 }
 snowRacer(2.30,0);
}
function storage(){
 const a=currentPlan();
 if(a.type==='transform')transformStorage();
 else{furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];if(a.type==='bror')brorStorage();else snowRacer(2.30,0);}
 rightWall();wallShelves();exampleContents();leftWallStorage();
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
 const carEnd=data.car.entranceGap+data.car.length,rearGap=currentPlan().frontGap;dimension([W+.16,.04,carEnd],[W+.16,.04,carEnd+rearGap],Math.round(rearGap*100)+' cm rear gap',[W+.62,.08,carEnd+rearGap/2],1.05);labels.at(-1).userData.floorGap=true;
 dimension([-.30,.03,0],[-.30,.03,L],'6.10 m',[-.45,.10,3.0],1.8);
 makeBikes();if(camera)updateComposer();else updateCamera(); updateTable(); populateObjects(); applyVisibility();render();root.dataset.ready='true';
 }
 function updateCamera(){const w=host.clientWidth,h=host.clientHeight,aspect=w/h;renderer.setSize(w,h,false);controls?.dispose();let pos,target=[-W/2,.9,L/2];const orth=['plan','loft','front','back','left','side-right','right'].includes(view);
 if(orth){const span=(view==='plan'?7.1:view==='loft'?Math.max(5.8,3.6/aspect):['left','side-right','right'].includes(view)?Math.max(3.3,6.9/aspect):Math.max(3.2,3.3/aspect));camera=new T.OrthographicCamera(-span*aspect/2,span*aspect/2,span/2,-span/2,.03,100);camera.userData.span=span;}else camera=new T.PerspectiveCamera(view==='photo'?66:43,aspect,.03,100);
 if(view==='photo'){pos=[-W/2,1.70,-.10];target=[-W/2,1.12,5.90];}else if(view==='rear'){pos=[-1.08,2.05,1.05];target=[-1.42,1.05,5.85];}else if(view==='left-wall'){pos=[-6.2,2.65,.75];target=[0,1.05,3.05];}else if(view==='right'){pos=[-.20,1.05,L/2];target=[-W,1.05,L/2];}else if(view==='plan'){pos=[-W/2,12,3.05];target=[-W/2,0,3.05];camera.up.set(0,0,1);}else if(view==='loft'){pos=[-W/2,12,loftStats.length/2];target=[-W/2,loftStats.top,loftStats.length/2];camera.up.set(0,0,1);}else if(view==='front'){pos=[-W/2,.9,-8];}else if(view==='back'){pos=[-W/2,.9,14];}else if(view==='left'){pos=[8,.9,L/2];}else if(view==='side-right'){pos=[-10,.9,L/2];}else{pos=[-4.4,4.9,-4.2];target=[-1.42,1.0,3.10];}
 if(aspect<1&&view==='rear')pos[2]-=1.7;
 camera.position.set(...pos);camera.lookAt(new T.Vector3(...target));controls=new OrbitControls(camera,renderer.domElement);controls.target.set(...target);controls.enableDamping=true;controls.dampingFactor=.12;controls.minDistance=.45;controls.maxDistance=18;controls.maxPolarAngle=Math.PI*.5;controls.update();controls.addEventListener('change',()=>{updateWalls();render();});
 root.querySelector('#garage-view').value=view;updateComposer();root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));applyVisibility();render();}
 // A layout rebuild replaces the scene, but keeps the camera and orbit controls.
 function updateComposer(){const w=host.clientWidth,h=host.clientHeight;
 composer?.dispose();composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));ao=new SSAOPass(scene,camera,w,h);ao.enabled=!camera.isOrthographicCamera;ao.kernelRadius=8;ao.minDistance=.002;ao.maxDistance=.12;composer.addPass(ao);composer.addPass(new OutputPass());composer.addPass(new SMAAPass(w,h));composer.setSize(w,h);}
 function applyVisibility(){if(!scene)return;if(bikeGroup)bikeGroup.visible=root.querySelector('#garage-bikes').checked;root.querySelector('#bike-controls').hidden=!root.querySelector('#garage-bikes').checked;root.querySelector('#bike-status').hidden=!root.querySelector('#garage-bikes').checked;updateWalls();carGroup.visible=root.querySelector('#garage-car').checked;for(const o of equipmentMeshes)o.visible=root.querySelector('#garage-gear').checked;labels.forEach((l,i)=>{l.visible=root.querySelector('#garage-dims').checked&&(l.userData.floorGap?view==='plan':['overview','plan'].includes(view)||['rear','front','back'].includes(view)&&i===0);});updateSpaceStatus();updateWalls();render();}
 function focusObject(){if(!selected)return;const b=objectBounds(selected),center=b.getCenter(new T.Vector3()),size=b.getSize(new T.Vector3());const distance=Math.max(.85,size.length()*1.35);const dir=new T.Vector3(.2,.32,-1).normalize();camera.up.set(0,1,0);camera.position.copy(center).addScaledVector(dir,distance);controls.target.copy(center);controls.update();render();}
 for(const id of ['rear-storage','recess-storage','upper-left','upper-right','upper-rear','garage-upper'])root.querySelector('#'+id).addEventListener('change',build);
 for(const id of ['loft-length']){
  root.querySelector('#'+id).addEventListener('change',build);
  root.querySelector('#'+id).addEventListener('input',e=>{root.querySelector('#'+id+'-value').textContent=(id==='loft-length'?(e.target.value/100).toFixed(1)+' m':e.target.value+' cm');});
 }
 root.querySelector('#rear-height').addEventListener('change',build);
 root.querySelector('#rear-height').addEventListener('input',e=>{root.querySelector('#rear-height-value').textContent=e.target.value+' cm';});
 root.querySelector('#reset-view').addEventListener('click',updateCamera);root.querySelector('#focus-item').addEventListener('click',focusObject);root.querySelector('#object-list').addEventListener('change',e=>selectObject(objects.find(o=>o.id===e.target.value)));
 for(const id of ['garage-gear','garage-dims','garage-bikes','garage-cutaway','garage-access'])root.querySelector('#'+id).addEventListener('change',()=>{if(id==='garage-bikes'&&root.querySelector('#garage-bikes').checked)root.querySelector('#garage-car').checked=true;applyVisibility();});
 const raycaster=new T.Raycaster(),pointer=new T.Vector2();let down=null;
 renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,time:performance.now()};});
 function pick(e){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(scene.children,true);for(const hit of hits){let o=hit.object,visible=true;while(o){if(!o.visible)visible=false;o=o.parent;}if(!visible||!hit.object.isMesh)continue;const product=objects.find(o=>o.key&&o.id===hit.object.userData.objectId);return product||null;}return null;}
 renderer.domElement.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<6&&performance.now()-down.time<700)selectObject(pick(e));down=null;});
 renderer.domElement.addEventListener('pointermove',e=>{if(e.buttons)return;renderer.domElement.style.cursor=pick(e)?'pointer':'grab';});

 root.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;root.querySelector('#garage-view').value=view;updateCamera();}));

 function updateWalls(){if(!scene||!camera)return;const cut=root.querySelector('#garage-cutaway').checked;
 const hidden=side=>cut&&(side==='left'&&camera.position.x>0||side==='right'&&camera.position.x<-W||side==='back'&&camera.position.z>L);
 scene.traverse(m=>{const side=m.userData.wall;if(side)m.visible=!hidden(side);});
 for(const o of objects){if(!o.meta.side)continue;for(const m of o.meshes)m.visible=!hidden(o.meta.side)&&(!equipmentMeshes.includes(m)||root.querySelector('#garage-gear').checked);}
 }
// Deterministic full-resolution reference export, also used by capture.html.
 function captureReference(width=2048,height=1280){
 const oldSize=renderer.getSize(new T.Vector2()),ratio=renderer.getPixelRatio(),aspect=camera.aspect,left=camera.left,right=camera.right,top=camera.top,bottom=camera.bottom;
 try{
  renderer.setPixelRatio(1);renderer.setSize(width,height,false);
  if(camera.isOrthographicCamera){const span=camera.userData.span;camera.left=-span*width/height/2;camera.right=span*width/height/2;}else camera.aspect=width/height;
  camera.updateProjectionMatrix();composer?.setPixelRatio(1);composer?.setSize(width,height);render();return renderer.domElement.toDataURL('image/png');
 }finally{
  renderer.setPixelRatio(ratio);renderer.setSize(oldSize.x,oldSize.y,false);camera.aspect=aspect;camera.left=left;camera.right=right;camera.top=top;camera.bottom=bottom;camera.updateProjectionMatrix();composer?.setPixelRatio(ratio);composer?.setSize(oldSize.x,oldSize.y);render();
 }
 }
 const money=v=>new Intl.NumberFormat('nb-NO',{maximumFractionDigits:2}).format(v)+' kr';
function rearSurface(a){
 const racks=a.type==='bror'?a.rackCount*5*.84*.54:a.type==='transform'?a.rackCount*4*.9*a.depth:0;
 return racks+rearBoards(a).length*1.18*.38;
}
function shoppingEntries(a){
 const rows=[];const add=(key,qty,use,zone)=>{if(qty)rows.push({key,qty,use,zone});};
 if(a.type==='bror')add('deep',a.rackCount,'Rear · all five supplied shelves per complete BROR unit','rear');
 if(a.type==='transform'){add('base80',1,'Rear · starter with four shelves','rear');add('extension80',1,'Rear · extension with four shelves','rear');}
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
 root.querySelector('#garage-view').addEventListener('change',e=>{view=e.target.value;updateCamera();});root.querySelector('#garage-car').addEventListener('change',applyVisibility);root.querySelector('#garage-loft').addEventListener('change',applyVisibility);
 new ResizeObserver(()=>{if(!camera)return; const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);if(camera.isOrthographicCamera){const span=camera.userData.span;camera.left=-span*w/h/2;camera.right=span*w/h/2;}else camera.aspect=w/h;camera.updateProjectionMatrix();composer?.setSize(w,h);render();}).observe(host);
 build();
 renderer.setAnimationLoop(()=>{controls?.update();});
 window.garageModel={data,setView:v=>{root.querySelector('#garage-view').value=v;root.querySelector('#garage-view').dispatchEvent(new Event('change'))},capture:captureReference,getCameraState:()=>({position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),zoom:camera.zoom,target:controls.target.toArray(),type:camera.type}),getScene:()=>scene,getObjects:()=>objects.map(({id,key,meta})=>({id,key,meta})),select:id=>selectObject(objects.find(o=>o.id===id)),project:id=>{const o=objects.find(o=>o.id===id);const b=objectBounds(o);return b.getCenter(new T.Vector3()).project(camera).toArray();}};

