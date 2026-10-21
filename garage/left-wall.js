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
 // Retain the complete existing braces behind all new retail baskets.
 for(const ends of wall.braces){
  const [a,b]=ends,dy=b[1]-a[1],dz=b[0]-a[0],length=Math.hypot(dy,dz);
  const mesh=new T.Mesh(new RoundedBoxGeometry(d*.8,length,.065,2,.003),materials.wood);
  mesh.position.set(-d/2,(a[1]+b[1])/2,(a[0]+b[0])/2);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(0,dy,dz).normalize());
  mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
  register([mesh],null,{title:'Left wall · retained diagonal brace',kind:'existing-storage',side:'left',note:'Existing bracing is visible in the new photos. Its placement is schematic; new baskets sit in front of the stud faces. No brace is removed, notched or altered.'});
 }
}
function leftWallBlocked(z0,z1,y0,y1){
 const k=data.leftWall.chargerKeepout;return z1>k.z[0]&&z0<k.z[1]&&y1>k.y[0]&&y0<k.y[1];
}
function leftWallStorage(){
 const wall=data.leftWall,d=wall.recessDepth,bays=leftWallBays(),group=new T.Group();group.userData.wall='left';furnitureGroup.add(group);
 leftWallStats={existing:0,added:0,baskets:0,small:0,large:0,rails:0,area:0,basketLitres:0,aboveCharger:0};
 const rearLimit=L-data.layouts[current].depth-data.layouts[current].standOff-.04;
 function item(fn,key,meta){const n=group.children.length;fn();return register(group.children.slice(n),key,meta);}
 for(const [index,bay] of bays.entries()){
  for(const y of wall.ledgeTops){
   item(()=>box(d,.045,bay.width,-d/2,y-.0225,bay.center,'wood',group),null,{title:'Left wall · existing ledge '+(index+1)+' / '+Math.round(y*100)+' cm',kind:'existing-storage',side:'left'});leftWallStats.existing++;
  }

 }
 if(root.querySelector('#garage-left-baskets').checked){
  const pitch=wall.clearWidth+wall.studWidth;
  for(let index=0,z=wall.firstStud;z<L;index++,z+=pitch){
   const w=data.products.basketSmall.dimensions[0];if(z-w/2<.04||z+w/2>rearLimit)continue;
   // Use the actual short 316 mm retail rail above the charger.
   const cut=wall.railOmitStuds.includes(index),length=cut?.316:1.98,bottom=cut?1.72:.06;
   item(()=>box(.016,length,.025,.010,bottom+length/2,z,'white',group),cut?'shortWallRail':'wallRail',{title:'Left wall · Elfa rail '+index+(cut?' / 316 mm upper rail':''),kind:'product',side:'left',dimensions:[.025,.016,length],height:bottom,shortRail:cut,note:cut?'Uncut 316 mm retail rail mounted above the charger keepout.':'Direct fixing to the existing stud face. The basket spans adjacent recesses; the original 9 cm deep ledges remain usable behind it.'});leftWallStats.rails++;
   if(!cut)for(const y of wall.basketRows)leftRetailBasket(z,index,y,'basketSmall',group,item,rearLimit);
   leftRetailBasket(z,index,wall.highBasketBottom,'basketLarge',group,item,rearLimit);
  }
 }
 // Charger shape and cable loop are retained as context. Keepout is local in height AND length.
 const cz=2.28;
 item(()=>{
  box(.12,.32,.19,.065,1.13,cz,'rubber',group);
  const c=new T.CatmullRomCurve3([new T.Vector3(.10,1.04,cz),new T.Vector3(.10,.40,cz-.12),new T.Vector3(.10,.40,cz-.70),new T.Vector3(.10,1.30,cz-.75),new T.Vector3(.10,1.35,cz-.36),new T.Vector3(.10,.58,cz-.46)]);
  group.add(new T.Mesh(new T.TubeGeometry(c,48,.014,8,false),materials.rubber));
 },null,{title:'Left wall · existing charger / cable space',kind:'existing-storage',side:'left'});
}
function leftRetailBasket(z,index,bottom,key,group,item,rearLimit){
 const [width,depth,height]=data.products[key].dimensions,rear=.018,front=rear+depth,top=bottom+height;
 const bay={start:z-width/2,end:z+width/2},limit=bay.start<loftStats.length?H:H+(storageHeight()-H)*Math.max(0,(bay.start-4)/(L-4));
 if(top>limit-.06||leftWallBlocked(bay.start,bay.end,bottom,top))return;
 const z0=z-width/2,z1=z+width/2,r=.003;
 item(()=>{
  for(const y of [bottom+r,top-r]){
   for(const zz of [z0+r,z1-r])rod([rear+r,y,zz],[front-r,y,zz],r,'white',group);
   for(const x of [rear+r,front-r])rod([x,y,z0+r],[x,y,z1-r],r,'white',group);
  }
  for(let zz=z0+.025;zz<z1-.01;zz+=.045){
   rod([rear+r,bottom+r,zz],[front-r,bottom+r,zz],.002,'white',group);
   for(const x of [rear+r,front-r])rod([x,bottom+r,zz],[x,top-r,zz],.002,'white',group);
  }
  for(const zz of [z0+r,z1-r])for(const x of [rear+r,front-r])rod([x,bottom+r,zz],[x,top-r,zz],r,'white',group);
 },key,{title:'Left wall · Elfa '+(key==='basketSmall'?'8 cm basket':'13.5 cm high basket')+' / rail '+index+' / '+Math.round(bottom*100)+' cm',kind:'product',side:'left',basket:true,dimensions:[width,depth,height],dimensionLabel:'Along wall × retail basket depth × height',height:bottom,projection:front,note:'Fixed-size catalogue basket on its matching stud-mounted rail. Mounts in front of the intact braces; the recess and existing ledges remain behind it. '+(key==='basketSmall'?'9.8 cm installed projection, within the charger’s approximate 12.5 cm projection.':'15.3 cm installed projection, high above the nominal car envelope. Keep contents within the front edge; leave retrieval space above.')});
 leftWallStats.baskets++;leftWallStats[key==='basketSmall'?'small':'large']++;leftWallStats.basketLitres+=width*depth*height*1000;
 if(z+width/2>data.leftWall.chargerKeepout.z[0]&&z-width/2<data.leftWall.chargerKeepout.z[1]&&bottom>=data.leftWall.chargerKeepout.y[1])leftWallStats.aboveCharger++;
}
