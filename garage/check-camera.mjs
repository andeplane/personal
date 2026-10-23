import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const threeRoot=process.argv[2];assert(threeRoot,'Pass the installed three@0.158.0 package directory');
const T=await import(pathToFileURL(path.join(threeRoot,'build/three.module.js')));
const {OrbitControls}=await import(pathToFileURL(path.join(threeRoot,'examples/jsm/controls/OrbitControls.js')));
const source=fs.readFileSync(new URL('./interaction.js',import.meta.url),'utf8');
// Apply the viewer's actual settings, then dispatch OrbitControls wheel handlers.
// Projecting a fixed world point measures whether the cursor anchor moves.
const setup=source.match(/controls\.target\.set\(\.\.\.target\);[\s\S]*?controls\.update\(\);/)[0];
const configure=new Function('controls','target',setup);
function run(kind,ndc,delta,legacy=false){
 const listeners=new Map(),rect={left:35,top:70,width:960,height:600};
 const el={style:{},clientWidth:rect.width,clientHeight:rect.height,getBoundingClientRect:()=>rect,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
 const camera=kind==='top'?new T.OrthographicCamera(-5,5,3.125,-3.125,.03,100):new T.PerspectiveCamera(43,1.6,.03,100);
 const target=new T.Vector3(0,1,3);
 if(kind==='top'){camera.up.set(0,0,1);camera.position.set(0,12,3);}else camera.position.set(-6.2,2.65,.75);
 camera.lookAt(target);camera.updateMatrixWorld();
 const controls=new OrbitControls(camera,el);configure(controls,target.toArray());if(legacy)controls.zoomToCursor=false;
 camera.updateMatrixWorld();const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(...ndc),camera);
 const point=ray.ray.at(5,new T.Vector3()),before=point.clone().project(camera),zoomBefore=camera.zoom,positionBefore=camera.position.clone();
 for(let i=0;i<4;i++)listeners.get('wheel')({clientX:rect.left+(ndc[0]+1)*rect.width/2,clientY:rect.top+(1-ndc[1])*rect.height/2,deltaY:delta,preventDefault(){}});
 for(let i=0;i<30;i++)controls.update();camera.updateMatrixWorld();
 const after=point.clone().project(camera),error=Math.hypot((after.x-before.x)*rect.width/2,(after.y-before.y)*rect.height/2);
 assert(camera.zoom!==zoomBefore||camera.position.distanceTo(positionBefore)>.001,'Wheel must actually zoom');
 controls.dispose();return error;
}
const errors=[];
for(const kind of ['perspective','top'])for(const ndc of [[-.6,.5],[.55,-.4],[.4,.45]])for(const delta of [-100,100]){
 const error=run(kind,ndc,delta);assert(error<.00001,kind+' cursor drift: '+error+' px');errors.push(error);
 assert(run(kind,ndc,delta,true)>1,'Regression control must detect the original centre-zoom behavior');
}
console.log('Cursor-anchored zoom passed '+errors.length+' off-centre perspective/top cases; max drift '+Math.max(...errors).toExponential(2)+' px. Legacy centre zoom fails the same checks.');
