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
// Reject the complete insert/support envelope, not merely the shelf centre.
function recessBlocked(bay,bottom,top){
 if(leftWallBlocked(bay.start,bay.end,bottom,top))return true;
 return data.leftWall.braces.some(b=>{
  const lo=Math.max(bay.start,Math.min(b[0][0],b[1][0])),hi=Math.min(bay.end,Math.max(b[0][0],b[1][0]));
  if(lo>hi)return false;
  const y=[leftWallBraceAt(b,lo),leftWallBraceAt(b,hi)];
  return top>Math.min(...y)-.065&&bottom<Math.max(...y)+.065;
 });
}
function sideRuns(a){return a.upperRuns===4?[.18,1.38,2.58,3.78]:a.upperRuns===2?[.18,3.78]:[3.78];}
function recessPlacements(a){
 if(!root.querySelector('#garage-left-baskets').checked)return [];
 const out=[],limit=L-a.footprintDepth-.04;
 for(const [i,bay] of leftWallBays().entries()){
  const width=a.recessMode==='cut'?.535:.5,extent={start:bay.center-width/2,end:bay.center+width/2};
  if(extent.end>limit)continue;
  const rows=a.recessMode==='cut'?[.43,.68,1.11,1.36,1.78]:[.18,.86,1.52];
  for(const y of rows){
   const bottom=a.recessMode==='cut'?y-.168:y,top=a.recessMode==='cut'?y:y+.52;
   if(top>H-.04||recessBlocked(extent,bottom,top))continue;
   if(top>1.73&&sideRuns(a).some(z=>extent.end>z&&extent.start<z+1.18))continue;
   out.push({bay:i,z:bay.center,y,width,bottom,top,kind:a.recessMode});
  }
 }
 return out;
}
function leftWallStorage(){
 const wall=data.leftWall,d=wall.recessDepth,group=new T.Group();group.userData.wall='left';furnitureGroup.add(group);
 leftWallStats={existing:0,added:0,baskets:0,small:0,large:0,rails:0,area:0,basketLitres:0,aboveCharger:0};
 function item(fn,key,meta){const n=group.children.length;fn();return register(group.children.slice(n),key,meta);}
 for(const [index,bay] of leftWallBays().entries())for(const y of wall.ledgeTops){
  item(()=>box(d,.045,bay.width,-d/2,y-.0225,bay.center,'wood',group),null,{title:'Left wall · existing ledge '+(index+1)+' / '+Math.round(y*100)+' cm',kind:'existing-storage',side:'left'});leftWallStats.existing++;
 }
 for(const p of recessPlacements(data.layouts[current])){
  const rear=-d+.005,depth=p.kind==='cut'?.20:.18,front=rear+depth;
  const note='Starts at the BACK of the 9 cm recess; '+Math.round(front*1000)/10+' cm projects beyond the stud faces. This location avoids modeled braces, ledges and charger. Individual bay dimensions / backing must be checked before ordering; the repeated bay geometry is schematic.';
  if(p.kind==='stock'){
   item(()=>{
    // Two trays and curved side frames, simplified from IKEA assembly AA-2404745-2.
    for(const yy of [p.y+.04,p.y+.35]){
     box(depth,.008,p.width,rear+depth/2,yy,p.z,'metal',group);
     for(const xx of [rear+.004,front-.004])box(.008,.025,p.width,xx,yy+.012,p.z,'metal',group);
     for(const zz of [p.z-p.width/2+.004,p.z+p.width/2-.004])box(depth,.025,.008,rear+depth/2,yy+.012,zz,'metal',group);
    }
    for(const zz of [p.z-p.width/2+.006,p.z+p.width/2-.006])for(const [x,h] of [[rear+.006,.52],[rear+.085,.46],[front-.006,.40]])rod([x,p.y+.006,zz],[x,p.y+h-.006,zz],.006,'metal',group);
   },'recessUnit',{title:'Recess '+(p.bay+1)+' · APOTEKARE / '+Math.round(p.y*100)+' cm',kind:'product',side:'left',insert:true,dimensions:[.5,.18,.52],height:p.y,projection:front,note});
   leftWallStats.added+=2;leftWallStats.area+=.5*.18*2;
  }else{
   item(()=>box(depth,.018,p.width,rear+depth/2,p.y-.009,p.z,'wood',group),'pine20',{title:'Recess '+(p.bay+1)+' · fitted shelf / '+Math.round(p.y*100)+' cm',kind:'product',side:'left',insert:true,cut:true,purchaseShare:.5,dimensions:[p.width,depth,.018],height:p.y,projection:front,note:note+' CUT: 53.5 cm from a 118 × 20 × 1.8 cm board. Two pieces per purchased board, allowing 3 mm saw kerfs; remaining offcut about 10.4 cm. The shopping list rounds up whole boards.'});
   for(const z of [p.z-.20,p.z+.20])item(()=>{
    box(.008,.15,.025,rear+.004,p.y-.018-.075,z,'white',group);
    box(.20,.008,.025,rear+.10,p.y-.022,z,'white',group);
   },'bracket20',{title:'Recess '+(p.bay+1)+' · Habo 20 cm support',kind:'product',side:'left',height:p.y-.168,note:'Fix against structural backing at the rear of the recess, with shelf screws suitable for 18 mm pine. Existing cladding strength is unverified.'});
   leftWallStats.added++;leftWallStats.area+=p.width*depth;
  }
 }
 const cz=2.28;
 item(()=>{
  box(.12,.32,.19,.065,1.13,cz,'rubber',group);
  const c=new T.CatmullRomCurve3([new T.Vector3(.10,1.04,cz),new T.Vector3(.10,.40,cz-.12),new T.Vector3(.10,.40,cz-.70),new T.Vector3(.10,1.30,cz-.75),new T.Vector3(.10,1.35,cz-.36),new T.Vector3(.10,.58,cz-.46)]);
  group.add(new T.Mesh(new T.TubeGeometry(c,48,.014,8,false),materials.rubber));
 },null,{title:'Left wall · existing charger / cable space',kind:'existing-storage',side:'left'});
}
