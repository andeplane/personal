// The bay opening is measured. Whole-wall positions / brace locations remain a photo-based study.
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
 leftWallStats={existing:0,added:0,area:0};
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
  if(!addition||overlapsCharger(bay)||bay.end>rearLimit)continue;
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
