from pathlib import Path
p=Path(__file__).resolve().parent
s=(p/'source/visual-template.html').read_text().split('<script>')[1].split('</script>')[0]
s=s.replace('(function(){','').replace('})();','')
s=s.replace("const data=__GARAGE_DATA__;", "const data=await (await fetch('./design-data.json',{cache:'no-store'})).json();")
s=s.replace(" if(!window.THREE){host.textContent='3D library unavailable. Use the saved renderings in the proposal.';return;}\n const T=window.THREE,", ' const ')
s=s.replace("view='overview'", "view='rear'")
s=s.replace("const renderer=new T.WebGLRenderer", "const renderer=new T.WebGLRenderer")
s=s.replace(" host.appendChild(renderer.domElement);", " host.replaceChildren(renderer.domElement); renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;\n const pmrem=new T.PMREMGenerator(renderer), environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;\n let controls,composer,ao,selected=null,selectionBox,objects=[],equipmentMeshes=[],dimensionGroup,bikeGroup;\n const render=()=>{if(composer)composer.render();else if(scene&&camera)renderer.render(scene,camera);};")
s=s.replace(" function token(name){", " function oldToken(name){")
a=s.index(' function mat(');b=s.index(' function box(',a)
s=s[:a]+(p/'materials.js').read_text()+s[b:]
s=s.replace('new T.BoxGeometry(w,h,d)', 'new RoundedBoxGeometry(w,h,d,2,Math.min(.006,Math.min(w,h,d)*.18))')
s=s.replace('parent.add(mesh);return mesh;}', 'parent.add(mesh); autoTag(mesh,w,h,d,x,y,z,m,parent);return mesh;}',1)
s=s.replace('dir.length(),8','dir.length(),16')
for name in ['bin','bror','pack','boots','snowRacer']:
 s=s.replace('function '+name+'(', 'function '+name+'Base(')
s=s.replace('new T.BoxGeometry(.49,h-.08,.31)', 'new RoundedBoxGeometry(.49,h-.08,.31,5,.07)')
s=s.replace("materials[colour]);m.position", "fabricMaterial(colour));m.position")
# Bracket profiles and steel shelf folds use nominal envelope dimensions.
s=s.replace("function build(){if(scene)scene.traverse(o=>{if(o.geometry)o.geometry.dispose();});labels=[];scene=new T.Scene();scene.scale.x=-1;materials={};for(const k of ['wood','metal','floor','white','glass','bin','gear','rubber','accent'])materials[k]=mat(k,k==='glass'?.18:.8);", "function build(){if(scene)scene.traverse(o=>{if(o.geometry)o.geometry.dispose();});objects=[];equipmentMeshes=[];selected=null;selectionBox=null;labels=[];scene=new T.Scene();scene.scale.x=-1;scene.background=new T.Color('#e9e9e0');scene.environment=environment;materials={};for(const k of ['wood','metal','floor','white','glass','bin','gear','rubber','accent'])materials[k]=mat(k);dimensionGroup=new T.Group();scene.add(dimensionGroup);")
a=s.index(' scene.add(new T.HemisphereLight');b=s.index(' const accent=materials.accent.clone()',a)
s=s[:a]+(p/'room.js').read_text()+s[b:]
s=s.replace(' renderer.render(scene,camera)', ' render()').replace(';renderer.render(scene,camera)', ';render()')
# Restore fallback, which the mechanical replacement would make recursive.
s=s.replace('else if(scene&&camera)render();', 'else if(scene&&camera)renderer.render(scene,camera);')
s=s.replace('updateCamera(); updateTable();render();root.dataset.ready', 'updateCamera(); updateTable(); populateObjects(); applyVisibility();render();root.dataset.ready')
a=s.index(' function updateCamera()');b=s.index(' const money=',a)
s=s[:a]+(p/'interaction.js').read_text()+s[b:]
s=s.replace("new ResizeObserver(()=>{if(scene)updateCamera();}).observe(host);", "new ResizeObserver(()=>{if(!camera)return; const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();composer?.setSize(w,h);render();}).observe(host);")
a=s.index(' const observer=new MutationObserver');b=s.index(' build();',a)
s=s[:a]+s[b:]
s=s.replace(" build();\n window.garageModel", " build();\n renderer.setAnimationLoop(()=>{controls?.update();});\n window.garageModel")
s=s.replace("getScene:()=>scene", "getScene:()=>scene,getObjects:()=>objects.map(({id,key,meta})=>({id,key,meta})),select:id=>selectObject(objects.find(o=>o.id===id)),project:id=>{const o=objects.find(o=>o.id===id);const b=objectBounds(o);return b.getCenter(new T.Vector3()).project(camera).toArray();}")
s=s.replace("function rightWall(){", "function rightWallBase(){")
s=s.replace("storage();makeCar();", "storage();makeCar();register(carGroup.children.filter(m=>m.isMesh),null,{title:'Model Y parking envelope',dimensions:[data.car.foldedWidth,data.car.length,data.car.height],note:'Official planning dimensions; simplified body shape. Folded mirrors: 198.2 cm; body: 192 cm; open mirrors: 212.9 cm. Driver-door and hatch movement are not modelled.'});carGroup.traverse(m=>{if(m.isMesh){m.material=m.material.clone();m.material.transparent=true;m.material.opacity=.27;m.material.depthWrite=false;}});")
s=s.replace("dimension([0,.04,-.35]", "dimension([0,2.18,L-.20],[W,2.18,L-.20],'2.83 m',[W/2,2.24,L-.20],.8);dimension([0,.04,-.35]")
s=s.replace("let lm=materials.wood.clone();", "let lm=materials.wood.clone();")
s=s.replace("new T.BoxGeometry(.49,h-.08,.31)", "new RoundedBoxGeometry(.49,h-.08,.31,4,.065)")
s=s.replace("storage();makeCar();", "storage();for(const m of furnitureGroup.children){if(!m.userData.objectId&&(m.material===materials.gear||m.material===materials.wood)){register([m],null,{title:'Existing camping gear',note:'Representative camping bag, mat or long item; dimensions need measuring.'});equipmentMeshes.push(m);}}makeCar();")
s=s.replace("addEventListener('change',()=>updateCamera())", "addEventListener('change',applyVisibility)")
imports="""import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
"""
# Product helpers need declaration before build; function declarations are hoisted.
s=s.replace(' function storage(){',(p/'products.js').read_text()+(p/'bikes.js').read_text()+(p/'expanded-storage.js').read_text()+'\n function storage(){')
s=s.replace('updateCamera(); updateTable(); populateObjects();', 'makeBikes();updateCamera(); updateTable(); populateObjects();')
s=s.replace('camera.aspect=w/h;camera.updateProjectionMatrix();', 'if(camera.isOrthographicCamera){const span=camera.userData.span;camera.left=-span*w/h/2;camera.right=span*w/h/2;}else camera.aspect=w/h;camera.updateProjectionMatrix();')
s=s.replace("if(a.id==='A'){", "if(['D','E','F'].includes(a.id)){expandedStorage(a);}else if(a.id==='A'){")
s=s.replace("if(a.id!=='A')for", "if(['B','C'].includes(a.id))for")
s=s.replace("textContent=a.equipment", "textContent=a.summary+' '+a.equipment")
s=s.replace("Rear gap <strong>", "Floor rear gap <strong>")
s=s.replace('Fixings / backing allowance (estimate)', 'Construction / fixings allowance (estimate)')
(p/'viewer.js').write_text(imports+s)

import hashlib,re
revision=hashlib.sha256((imports+s).encode()).hexdigest()[:12]
page=p/'index.html'
page.write_text(re.sub(r'src="viewer.js[^"]*"', 'src="viewer.js?v='+revision+'"',page.read_text()))
