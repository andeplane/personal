// Retained original rear arrangement: a retail Adrian rack and a fitted timber bay.
function mixedRearParts(a){
 const t=.048,x0=.075+a.rackWidth+.020,w=a.extensionWidth,d=a.depth,zBack=L-a.standOff;
 const clear=w-2*t,narrow=clear-.650-t,divider=x0+t+narrow+t/2;
 const full=[1.45,1.95],small=[.10,.45,.80,1.12],parts=[];
 const beam=(length,x,y,z,axis)=>parts.push({length,x,y,z,axis});
 for(const x of [x0+t/2,x0+w-t/2])for(const z of [zBack-t/2,zBack-d+t/2])beam(1.95,x,.975,z,'y');
 for(const z of [zBack-t/2,zBack-d+t/2])beam(1.36,divider,.68,z,'y');
 const shelves=[...full.map(y=>({x:x0+w/2,width:clear,y,full:true})),...small.map(y=>({x:x0+t+narrow/2,width:narrow,y,full:false}))];
 for(const p of shelves){
  for(const z of [zBack-t/2,zBack-d+t/2])beam(p.width,p.x,p.y-.018-t/2,z,'x');
  for(const x of [p.x-p.width/2+t/2,p.x+p.width/2-t/2])beam(d-2*t,x,p.y-.018-t/2,zBack-d/2,'z');
 }
 // First-fit decreasing cut allocation, including one 3 mm kerf per piece.
 const stock=[];for(const length of parts.map(p=>p.length).sort((x,y)=>y-x)){
  let bin=stock.find(b=>b.used+length+.003<=4.8);if(!bin){bin={used:0,cuts:[]};stock.push(bin);}bin.cuts.push(length);bin.used+=length+.003;
 }
 return {t,x0,w,d,zBack,narrow,shelves,parts,stock,timberMetres:Math.ceil(stock.length*4.8)};
}
function mixedRearSurface(a){const p=mixedRearParts(a);return 3*1.335*.78+p.shelves.reduce((s,b)=>s+b.width*p.d,0);}
function mixedRearStorage(){
 const a=currentPlan(),p=mixedRearParts(a),x=.075+a.rackWidth/2,zBack=p.zBack;
 capture(()=>{
  for(const xx of [x-a.rackWidth/2+.0245,x+a.rackWidth/2-.0245])for(const zz of [zBack-.0245,zBack-a.depth+.0245])box(.049,2,.049,xx,1,zz,'metal',furnitureGroup);
  for(const y of a.shelves[0]){
   box(1.335,.022,.78,x,y-.011,zBack-.4,'wood',furnitureGroup);
   for(const z of [zBack-.0245,zBack-.7755])box(1.35,.056,.035,x,y-.05,z,'accent',furnitureGroup);
  }
 },'rack80',{title:'Rear bay 1 · Adrian 144.8 × 80 × 200 cm',kind:'product',dimensions:[1.448,.8,2],note:'The original wide industrial rack. All THREE included 22 mm chipboard levels are shown, positioned on its 50 mm grid. No unpriced extra rack shelves. External frame and beam dimensions follow the catalogue; member details are simplified.'});
 a.shelves[0].forEach((y,i)=>shelfZone(x,1.335,.78,y,a.shelves[0][i+1]??Math.min(2.18,storageHeight()),.08,zBack-.01));
 const cutText=p.stock.map((b,i)=>(i+1)+': '+b.cuts.map(n=>Math.round(n*1000)).join(' + ')+' mm').join('; ');
 capture(()=>{for(const b of p.parts){const dims=b.axis==='x'?[b.length,p.t,p.t]:b.axis==='y'?[p.t,b.length,p.t]:[p.t,p.t,b.length];box(...dims,b.x,b.y,b.z,'wood',furnitureGroup);}},'frameTimber',{
  title:'Rear fitted bay · cut timber frame',kind:'product',purchaseShare:p.timberMetres,dimensions:[p.w,p.d,1.95],note:'Built from real 48 × 48 mm timber, not a retail rack. Planning cut allocation: '+p.stock.length+' lengths of 4.8 m; budget rounds '+(p.stock.length*4.8).toFixed(1)+' m up to '+p.timberMetres+' linear metres. Confirm available stock lengths before ordering. Cuts, with 3 mm kerfs: '+cutText+'. Wall anchoring, joints, screws and safe installed loading require installation design; fixings and labour are unpriced.'
 });
 for(const s of p.shelves){
  // Six pieces use two 2440 × 1220 mm sheets. Sheet 1: the two wide pieces;
  // sheet 2: four narrow pieces in a 2 × 2 grid. Every cut allows 3 mm kerf.
  capture(()=>box(s.width,.018,p.d,s.x,s.y-.009,zBack-p.d/2,'wood',furnitureGroup),'bayPlywood',{
   title:'Rear fitted bay · '+(s.full?'full-width upper':'small-gear')+' shelf / '+Math.round(s.y*100)+' cm',kind:'product',cut:true,purchaseShare:2/6,dimensions:[s.width,p.d,.018],height:s.y,
   note:'CUT: '+Math.round(s.width*1000)+' × 800 × 18 mm from real 2440 × 1220 mm plywood. Buy TWO whole sheets for two '+Math.round((p.w-2*p.t)*1000)+' × 800 mm upper pieces and four '+Math.round(p.narrow*1000)+' × 800 mm lower pieces, allowing 3 mm kerfs. 48 mm support frame is priced separately. The 65 cm clear upright sled slot remains open below the first full-width shelf.'
  });
  const next=p.shelves.filter(b=>b.full===s.full&&b.y>s.y).map(b=>b.y).sort((x,y)=>x-y)[0]??(s.full?upperClearance():1.45);
  shelfZone(s.x,s.width,p.d,s.y,next,.066,zBack);
 }
 snowRacer(p.x0+p.w-p.t-.325,0);
}
