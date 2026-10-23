import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
// Actual pinned Three.js geometry, without WebGL. Independent of browser QA.
const threeRoot=process.argv[2];assert(threeRoot,'Pass the installed three@0.158.0 package directory');
const T=await import(pathToFileURL(path.join(threeRoot,'build/three.module.js')));
const {RoundedBoxGeometry}=await import(pathToFileURL(path.join(threeRoot,'examples/jsm/geometries/RoundedBoxGeometry.js')));
const {OBB}=await import(pathToFileURL(path.join(threeRoot,'examples/jsm/math/OBB.js')));
const dir=fileURLToPath(new URL('..',import.meta.url)),viewer=fs.readFileSync(dir+'/garage/viewer.js','utf8');
const segment=(start,end)=>{const a=viewer.indexOf(start),b=viewer.indexOf(end,a);assert(a>=0&&b>a,`Missing generated helper: ${start}`);return viewer.slice(a,b);};
const data=JSON.parse(fs.readFileSync(dir+'/garage/design-data.json','utf8')),controls={};
const context=vm.createContext({T,RoundedBoxGeometry,data,console,root:{querySelector:key=>controls[key]??(controls[key]={checked:false,value:'',textContent:'',innerHTML:'',hidden:true})}});
vm.runInContext(`const W=data.room.width,L=data.room.length,H=data.room.loftUnderside;let current=0,view='overview',scene,furnitureGroup,carGroup,loftGroup,objects=[],equipmentMeshes=[],selected,selectionBox;let materials={};const money=v=>v.toFixed(2)+' kr';const fabricMaterial=k=>materials[k];const token=()=>'#667766';const random=()=>.5;`+
segment(' function box(',' function rod(')+segment(' function rod(',' function line(')+segment(' function line(',' function label(')+segment(' function makeCar(',' function snowRacerBase(')+segment(' function snowRacerBase(','function register(')+
['configuration.js','products.js','expanded-storage.js','example-contents.js','left-wall.js','space.js','storage.js','summary.js'].map(f=>fs.readFileSync(dir+'/garage/'+f,'utf8')).join('\n')+`
 globalThis.buildCase=(c,p)=>{view='overview';for(const [key,value] of Object.entries({'garage-upper':p.height>210,'rear-height':p.height,'rear-storage':c.rear,'recess-storage':c.recess,'upper-left':c.upperLeft,'upper-right':c.upperRight,'upper-rear':c.upperRear,'loft-length':p.loftLength,'garage-car':p.parked,'garage-loft':true,'garage-access':true})){const c=root.querySelector('#'+key);if(typeof value==='boolean')c.checked=value;else c.value=String(value);}scene=new T.Scene();scene.scale.x=-1;objects=[];equipmentMeshes=[];materials={};for(const k of ['wood','metal','floor','white','glass','bin','gear','rubber','accent'])materials[k]=new T.MeshStandardMaterial();leftWallFrame();makeLoft();storage();makeCar();updateSpaceStatus();scene.updateMatrixWorld(true);return {scene,objects,equipmentMeshes,shelfZones,leftWallStats,loftStats,area:rearSurface(currentPlan()),shopping:shoppingList(currentPlan()),carGroup,a:currentPlan(),choices:configuration()};};`,context);
const configs=[];
for(const rear of data.rearOptions.map(a=>a.id))for(const recess of ['none','cut'])for(const upperLeft of [0,4])for(const upperRight of [false,true])for(const upperRear of [false,true])configs.push({rear,recess,upperLeft,upperRight,upperRear});
const cases=configs.map(c=>({c,p:{height:245,loftLength:420,parked:true}}));
for(const rear of data.rearOptions.map(a=>a.id))for(const height of [210,240,275,300])for(const recess of ['none','cut'])cases.push({c:{...data.defaults,rear,recess},p:{height,loftLength:height===210?200:540,parked:false}});
const results=[];
for(const {c,p} of cases){
 const {objects,shelfZones,leftWallStats,loftStats,area,shopping,carGroup,a,choices}=context.buildCase(c,p);
 assert.deepEqual(JSON.parse(JSON.stringify(choices)),c,'Building must not mutate any independent choice');
 const bounds=o=>{const b=new T.Box3();for(const m of o.meshes)b.expandByObject(m);return b;};
 const exampleObjects=objects.filter(o=>o.meta.kind==='example'),hardware=[];
 for(const o of objects){
  const title=o.meta.title||'';
  if(o.meta.kind==='example'||/Existing|ski bundle|Rattkjelke/.test(title))continue;
  for(const root of o.meshes)root.traverse(m=>{if(m.isMesh){m.geometry.computeBoundingBox();hardware.push({title,bounds:new T.Box3().setFromObject(m),obb:new OBB().fromBox3(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)});}});
 }
 for(const o of exampleObjects){
  const b=bounds(o),sz=b.getSize(new T.Vector3());const d=o.meta.side==='left'?[o.meta.dimensions[1],o.meta.dimensions[0],o.meta.dimensions[2]]:o.meta.dimensions;
  assert(sz.x<d[0]+.012&&sz.y<d[2]+.012&&sz.z<d[1]+.012,`${a.id} ${o.meta.title}: exceeds stated size`);
  assert(b.min.y>=0&&b.max.y<=p.height/100+.001,`${o.meta.title}: height`);
  for(const h of hardware){const s=b.clone().intersect(h.bounds).getSize(new T.Vector3());if(s.x*s.y*s.z>=.000001)assert(!new OBB().fromBox3(b).intersectsOBB(h.obb),`${a.id}: ${o.meta.title} intersects ${h.title}`);}
 }
 for(let x=0;x<exampleObjects.length;x++)for(let y=x+1;y<exampleObjects.length;y++){
  const s=bounds(exampleObjects[x]).intersect(bounds(exampleObjects[y])).getSize(new T.Vector3());assert(s.x*s.y*s.z<.000001,`${a.id}: example contents overlap`);
 }
 const sleds=objects.filter(o=>o.meta.title?.startsWith('Rattkjelke'));
 assert.equal(sleds.length,1);assert.equal(objects.filter(o=>o.meta.title?.includes('stepladder')).length,1);
 assert(!objects.some(o=>o.meta.title?.includes('SAMLA')));
 const sledBounds=bounds(sleds[0]);
 for(const h of hardware.filter(h=>h.title.startsWith('Above sled')||h.title.startsWith('Rear bay 3'))){const s=sledBounds.clone().intersect(h.bounds).getSize(new T.Vector3());assert(s.x*s.y*s.z<.000001,'Tall sled slot stays clear');}
 if(a.type!=='none')assert(shelfZones.some(z=>z.clear>.5),'Keep some larger shelf openings');
 if(['bror','transform'].includes(a.type))assert(shelfZones.some(z=>z.clear>.2&&z.clear<.4),'Keep smaller shelf openings');
 assert(Math.abs(area-shelfZones.reduce((s,z)=>s+z.area,0))<1e-8,'Comparison surface matches actual shelf geometry');
 const carBounds=new T.Box3().setFromObject(carGroup);
 assert(Math.abs(carBounds.min.x+data.car.centerX+data.car.foldedWidth/2)<.001,'Car parking envelope unchanged');
 const added=objects.filter(o=>o.meta.insert);
 assert.equal(added.length>0,c.recess!=='none'||c.upperLeft>0);
 assert(objects.some(o=>o.meta.title==='Left wall · existing charger / cable space'));
 assert.equal(objects.filter(o=>o.meta.title==='Left wall · retained diagonal brace').length,data.leftWall.braces.length);
 assert.equal(objects.filter(o=>o.meta.title?.startsWith('Left wall · existing ledge')).length,27);
 const braces=hardware.filter(h=>h.title==='Left wall · retained diagonal brace');
 for(const o of added){
  const b=bounds(o),k=data.leftWall.chargerKeepout,sku=data.products[o.key],size=b.getSize(new T.Vector3());
  assert(b.max.z<=data.room.length-a.footprintDepth-.04+.00001,'No inserts behind rear storage');
  assert(b.max.z<=k.z[0]||b.min.z>=k.z[1]||b.max.y<=k.y[0]||b.min.y>=k.y[1],'Charger keepout stays open');
  assert(b.max.x>.08,'Insert uses the inside of the recess (scene X is mirrored)');
  assert(-b.min.x<=(o.meta.high?.296:o.key==='pine28'?.196:.116),'Shelf projection matches its depth including the recess');
  assert(Math.abs(size.z-o.meta.dimensions[0])<.003&&Math.abs(size.x-o.meta.dimensions[1])<.003,'Retain declared stock/cut dimensions');
  for(const root of o.meshes)root.traverse(m=>{if(m.isMesh){m.geometry.computeBoundingBox();const obb=new OBB().fromBox3(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);for(const brace of braces)assert(!obb.intersectsOBB(brace.obb),'Recess insert must not cut a brace');}});
  assert(o.meta.cut,'Built wall boards have explicit cuts');
 }
 assert.equal(objects.some(o=>o.key==='pine38'&&o.meta.side==='left'),c.upperLeft>0);
 assert.equal(objects.some(o=>o.key==='pine28'&&o.meta.side==='right'),c.upperRight);
 assert(!objects.some(o=>['shelf','upperRail','basketSmall','wallRail'].includes(o.key)),'Obsolete repeated system removed');
 // Include the complete support envelope when checking vertically adjacent rows.
 const inserts=hardware.filter(h=>h.title.startsWith('Built left shelf'));
 for(const h of inserts.filter(h=>h.title.includes('stud support')))for(const board of added){
  const s=h.bounds.clone().intersect(bounds(board)).getSize(new T.Vector3());
  assert(s.x*s.y*s.z<.000001,'Support intersects a built shelf board: '+h.title);
 }
 if(c.recess==='cut'){
  for(const y of [.158,.498,.838,1.178,1.518])assert(added.some(o=>Math.abs(o.meta.height-y)<.001),'Missing built shelf level '+y);
  assert(leftWallStats.lowArea>2.7,'The built wall must provide substantial usable area, after notches');
 }
 if(c.upperLeft)assert(added.some(o=>o.meta.high&&o.meta.dimensions[1]===.38),'High run must actually be 38 cm deep');
 for(const h of inserts){
  const s=h.bounds.clone().intersect(carBounds).getSize(new T.Vector3());
  assert(s.x*s.y*s.z<.000001,'Built shelf/support intersects parked car envelope: '+h.title);
 }
 for(let i=0;i<added.length;i++)for(let j=i+1;j<added.length;j++){
  const s=bounds(added[i]).intersect(bounds(added[j])).getSize(new T.Vector3());assert(s.x*s.y*s.z<.000001,'New left shelf boards overlap');
 }
 const purchaseCounts=new Map();for(const o of objects.filter(o=>o.key))purchaseCounts.set(o.key,(purchaseCounts.get(o.key)||0)+(o.meta.purchaseShare??1));
 for(const [key,count] of purchaseCounts){assert(data.products[key].url.startsWith('https://'));assert.equal(shopping.find(r=>r.key===key)?.qty,Math.ceil(count),'Shopping quantity matches model instances: '+key);}
 assert(shopping.every(r=>Number.isInteger(r.qty)&&r.qty>0),'No fractional / negative purchase quantities');
 for(const o of objects.filter(o=>o.key)){for(const m of o.meshes)m.traverse(n=>{if(n.isMesh)assert.equal(n.userData.objectId,o.id,'Every selectable component has a catalogue key');});}
 for(const h of hardware.filter(h=>h.title.startsWith('Rear bay')||h.title.startsWith('Above sled')||h.title.startsWith('Rear wall'))){
  assert(h.bounds.min.z>=data.room.length-a.footprintDepth-.001,'Rear storage footprint includes every shelf / bracket');
  assert(h.bounds.min.x>=-data.room.width-.001&&h.bounds.max.x<=.001,'Retail rear parts stay within room width');
  const front=h.bounds.min.z,roof=data.room.loftUnderside+(p.height/100-data.room.loftUnderside)*Math.max(0,(front-4)/(data.room.length-4));
  assert(h.bounds.max.y<=roof+.001,'Retail rear component fits assumed sloping roof: '+h.title);
 }
 assert.equal(loftStats.length,p.loftLength/100);
 assert.equal(loftStats.accessEnd,loftStats.length+data.loft.accessDepth);
 const status=controls['#loft-status'].textContent;
 assert(status.includes(loftStats.accessEnd>data.room.length-a.footprintDepth-.03?'overlaps':p.parked?'Move car out':'clear of rear storage'),'Access status follows actual assumed footprint and parked mode');
 results.push({...c,...p,inserts:added.length,rearSurface:Number(area.toFixed(2)),examples:exampleObjects.length});
}
console.log(JSON.stringify({count:results.length,checks:'Actual Three.js bounds: mixed shelf openings and examples; one sled and ladder; stock/cut dimensions and whole-pack BOM counts; recess placements and upper side shelves; retained braces / charger; loft approach and parked mode; comparison areas',results},null,2));
