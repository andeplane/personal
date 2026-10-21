import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
// Geometry-only checks use the same pinned Three.js as the browser; no WebGL/DOM rendering.
const threeRoot=process.argv[2];
assert(threeRoot,'Pass the installed three@0.158.0 package directory');
const T=await import(pathToFileURL(path.join(threeRoot,'build/three.module.js')));
const {RoundedBoxGeometry}=await import(pathToFileURL(path.join(threeRoot,'examples/jsm/geometries/RoundedBoxGeometry.js')));
const {OBB}=await import(pathToFileURL(path.join(threeRoot,'examples/jsm/math/OBB.js')));
const dir=fileURLToPath(new URL('..',import.meta.url));
const viewer=fs.readFileSync(dir+'/garage/viewer.js','utf8');
const segment=(start,end)=>{const a=viewer.indexOf(start),b=viewer.indexOf(end,a);assert(a>=0&&b>a,`Missing generated helper: ${start}`);return viewer.slice(a,b);};
const data=JSON.parse(fs.readFileSync(dir+'/garage/design-data.json','utf8'));
const ctx2d={fillRect(){},beginPath(){},arc(){},fill(){}};
const controls={};
const context=vm.createContext({T,RoundedBoxGeometry,data,console,document:{createElement:()=>({getContext:()=>ctx2d})},root:{querySelector:key=>controls[key]??(controls[key]={checked:false,value:'245',textContent:'',hidden:true})}});
vm.runInContext(`const W=data.room.width,L=data.room.length,H=data.room.loftUnderside;let current=0,scene,furnitureGroup,objects=[],equipmentMeshes=[],selected,selectionBox;let materials={};const fabricMaterial=k=>materials[k];const token=()=>'#667766';const random=()=>.5;`+
segment(' function box(',' function rod(')+segment(' function rod(',' function line(')+segment(' function brorBase(',' function makeCar(')+segment(' function snowRacerBase(',' function register(')+
['products.js','expanded-storage.js','example-contents.js','left-wall.js','storage.js'].map(f=>fs.readFileSync(dir+'/garage/'+f,'utf8')).join('\n')+`
 globalThis.buildCase=(i,upper,height,inserts)=>{current=i;root.querySelector('#garage-upper').checked=upper;root.querySelector('#rear-height').value=height;root.querySelector('#garage-left-inserts').checked=inserts;scene=new T.Scene();scene.scale.x=-1;objects=[];equipmentMeshes=[];materials={};for(const k of ['wood','metal','floor','white','glass','bin','gear','rubber','accent'])materials[k]=new T.MeshStandardMaterial();leftWallFrame();storage();scene.updateMatrixWorld(true);return {scene,objects,equipmentMeshes,shelfZones,leftWallStats};};`,context);
const results=[];
for(let i=0;i<6;i++)for(const height of [210,240,245,275,300])for(const inserts of [false,true]){
 const upper=height>210;
 const {objects,shelfZones,leftWallStats}=context.buildCase(i,upper,height,inserts);
 for(const [key,count] of data.layouts[i].items){if(['upright','shortUpright','rail','rail62','shelf','shelf60','bracket','deep','low','rack60','rack80'].includes(key))assert.equal(objects.filter(o=>o.key===key).length,count,`${data.layouts[i].id}: priced ${key} count matches drawn hardware`);}
 const exampleObjects=objects.filter(o=>o.meta.kind==='example');
 const hardware=[];
 for(const o of objects){
  const t=o.meta.title||'';
  if(o.meta.kind==='example'||/Existing|ski bundle|Rattkjelke/.test(t))continue;
  for(const root of o.meshes)root.traverse(m=>{if(m.isMesh){m.geometry.computeBoundingBox();hardware.push({title:t,bounds:new T.Box3().setFromObject(m),obb:new OBB().fromBox3(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)});};});
 }
 for(const o of exampleObjects){
  const b=new T.Box3();for(const m of o.meshes)b.expandByObject(m);const sz=b.getSize(new T.Vector3());const declared=o.meta.side==='left'?[o.meta.dimensions[1],o.meta.dimensions[0],o.meta.dimensions[2]]:o.meta.dimensions;
  assert(sz.x<declared[0]+.012&&sz.y<declared[2]+.012&&sz.z<declared[1]+.012,`${data.layouts[i].id} ${o.meta.title}: exceeds stated size`);
  assert(b.min.y>=0&&b.max.y<= height/100+.001,`${o.meta.title}: height`);
  for(const h of hardware){const cross=b.clone().intersect(h.bounds);const s=cross.getSize(new T.Vector3());if(s.x*s.y*s.z>=.000001)assert(!new OBB().fromBox3(b).intersectsOBB(h.obb),`${data.layouts[i].id}: ${o.meta.title} intersects ${h.title}`);}
 }
 for(let a=0;a<exampleObjects.length;a++)for(let b=a+1;b<exampleObjects.length;b++){
  const aa=new T.Box3(),bb=new T.Box3();for(const m of exampleObjects[a].meshes)aa.expandByObject(m);for(const m of exampleObjects[b].meshes)bb.expandByObject(m);const s=aa.intersect(bb).getSize(new T.Vector3());assert(s.x*s.y*s.z<.000001,`${data.layouts[i].id}: examples overlap`);
 }
 assert.equal(objects.filter(o=>o.meta.title?.startsWith('Rattkjelke')).length,i===5?0:1);
 assert.equal(objects.filter(o=>o.meta.title?.includes('stepladder')).length,1);
 assert.equal(objects.filter(o=>o.meta.title?.includes('SAMLA')).length,0);
 const added=objects.filter(o=>o.meta.title?.startsWith('Left wall · added shallow shelf'));
 assert.equal(added.length,leftWallStats.added);assert.equal(added.length>0,inserts);
 assert(objects.some(o=>o.meta.title==='Left wall · existing charger / cable space'));
 assert.equal(objects.filter(o=>o.meta.title==='Left wall · retained diagonal brace').length,data.leftWall.braces.length);
 assert.equal(objects.filter(o=>o.meta.title?.startsWith('Left wall · existing ledge')).length,leftWallStats.existing);
 for(const shelf of added)for(const m of shelf.meshes){
  const b=new T.Box3().setFromObject(m),zone=data.leftWall.chargerZone;
  assert(b.min.x>=-.00001&&b.max.x<=data.leftWall.recessDepth+.001,'Shelf stays behind the stud faces');
  assert(b.max.z<=data.room.length-data.layouts[i].depth-.04+.00001,'No extra shelf behind rear rack');
  assert(b.max.z<=zone[0]||b.min.z>=zone[1],'Charger / cable span remains open');
  m.geometry.computeBoundingBox();const obb=new OBB().fromBox3(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
  for(const brace of hardware.filter(h=>h.title==='Left wall · retained diagonal brace'))assert(!obb.intersectsOBB(brace.obb),'New insert does not cut an existing brace');
 }
 results.push({layout:data.layouts[i].id,upper,height,inserts,leftInserts:added.length,shelfArea:Number(shelfZones.reduce((s,z)=>s+z.area,0).toFixed(2)),examples:exampleObjects.length});
}
console.log(JSON.stringify({checks:'Actual Three.js bounds: example sizes, shelf collisions, mutual collisions, height, one sled and ladder, no boxes',results},null,2));
