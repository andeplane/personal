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
 loftGroup.userData.structure[0].material.opacity=view==='loft'?1:.12;
 root.querySelector('#plan-note').hidden=view!=='plan';
 parkingPath.visible=parked;emptyFloor.visible=!parked;
 root.querySelector('#loft-length-value').textContent=loftStats.length.toFixed(1)+' m';
 root.querySelector('#basket-projection-value').textContent=root.querySelector('#basket-projection').value+' cm';
 root.querySelector('#basket-clearance-value').textContent=root.querySelector('#basket-clearance').value+' cm';
 root.querySelector('#basket-controls').hidden=!root.querySelector('#garage-left-baskets').checked;
 root.querySelector('#loft-status').textContent=blocked?'The assumed loft approach overlaps rear storage / the rear wall. Revise the loft edge or access arrangement.':parked?'Move car out for the reserved loft approach and a usable work area.':'The reserved loft approach is clear of rear storage in this model. Final access method still needs checking.';
 root.querySelector('#space-status').innerHTML=parked?'<strong>Car parked:</strong> '+Math.round(data.layouts[current].frontGap*100)+' cm rear gap. Left side: about 55 cm to folded mirrors, narrowing to about 42 cm at the charger. A narrow passage; door movement is unmodelled.':'<strong>Car out:</strong> the centre becomes working and retrieval space; keep the marked loft approach available.';
}
