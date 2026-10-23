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
