// Retail furniture and uncut wall boards share one plan-specific allocation.
let shelfZones=[];
function shelfZone(x,width,depth,y,next,thickness=.032,zBack=L){shelfZones.push({x,width,depth,y,clear:next-y-thickness,area:width*depth,zBack});}
function storageHeight(){return root.querySelector('#garage-upper').checked?Number(root.querySelector('#rear-height').value)/100:H;}
function upperClearance(){return H+(storageHeight()-H)*(L-.4-4)/(L-4);}
function upperLevels(){return upperClearance()>=2.38?[2.20]:[];}
function rearBoards(a){return [...a.rearPine,...(a.upperRear?upperLevels():[]).flatMap(y=>[[.76,y],[2.03,y]])];}
// All boards keep retail dimensions. Brackets are modeled below the boards.
function pineShelf(key,side,along,y,title){
 const [length,depth,t]=data.products[key].dimensions,group=new T.Group();
 group.position.set(side==='left'?0:side==='right'?W:along,y,side==='back'?L:along);
 group.rotation.y=side==='left'?-Math.PI/2:side==='right'?Math.PI/2:0;
 furnitureGroup.add(group);
 const item=(fn,k,m)=>{const n=group.children.length;fn();register(group.children.slice(n),k,m);};
 item(()=>box(length,t,depth,0,-t/2,-depth/2,'wood',group),key,{title,kind:'product',side,dimensions:[length,depth,t],height:y,note:'Uncut retail board. Three 30 cm Habo supports are included below it; their full 20 cm height is shown. Fix to suitable structural backing. Side shelves at 195 cm have only about 15 cm above them under the assumed loft: flat, light items only; this is not full-height walking space beneath the brackets.'});
 for(const x of [-.50,0,.50])item(()=>{
  box(.03,.20,.008,x,-t-.10,-.004,'metal',group);
  box(.03,.008,.30,x,-t-.004,-.15,'metal',group);
  rod([x,-t-.19,-.01],[x,-t-.01,-.29],.007,'metal',group);
 },'bracket30',{title:title+' · Habo support',kind:'product',side,height:y-t-.20});
}
function wallShelves(){
 const a=currentPlan();
 // The fitted left runs, including their supports, are built in leftWallStorage().
 if(a.upperRight)pineShelf('pine28','right',.79,1.95,'High right · front extension to existing ski shelf');
 const boards=rearBoards(a);
 for(const [x,y] of boards){
  pineShelf('pine38','back',x,y,'Rear wall · uncut 118 × 38 cm / '+Math.round(y*100)+' cm');
  const above=boards.filter(p=>p[0]===x&&p[1]>y).map(p=>p[1]).sort((a,b)=>a-b)[0];
  shelfZone(x,1.18,.38,y,above??upperClearance(),.22,L);
 }
}
function transformStorage(){
 const a=currentPlan();furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];
 const start=.06,zBack=L-a.standOff;
 const centers=[start+.4875,start+.975+.455,start+.975+.91+.455];
 for(let bay=0;bay<a.rackCount;bay++){
  const x=centers[bay],key=bay===0?a.baseKey:a.extensionKey;
  capture(()=>{
   // Nominal rack members; outer width / depth / height follow the retail specification.
   const ends=bay===0?[start+.0175,start+.9575]:[start+.975+bay*.91-.0175];
   for(const xx of ends){
    for(const z of [zBack-.0175,zBack-a.depth+.0175])box(.035,a.top,.035,xx,a.top/2,z,'metal',furnitureGroup);
    for(const y of [.3,1.05,1.8]){box(.025,.025,a.depth,xx,y,zBack-a.depth/2,'metal',furnitureGroup);}
    rod([xx,.32,zBack-.03],[xx,1.78,zBack-a.depth+.03],.007,'metal',furnitureGroup);
   }
   a.shelves[bay].forEach(y=>{
    box(.9,.032,a.depth,x,y-.016,zBack-a.depth/2,'metal',furnitureGroup);
   });
  },key,{title:'Rear bay '+(bay+1)+' · TRANSFORM '+(bay===0?'starter':'extension')+' / '+Math.round(a.depth*100)+' cm',kind:'product',dimensions:[bay===0?.975:.91,a.depth,a.top],note:'Four included shelves are repositioned in this bay; no extra shelf is assumed. Heights are nominal positions on the 32 mm grid. Run: 188.5 cm wide, leaving a separate tall sled bay. Outer rack members are simplified.'});
  a.shelves[bay].forEach((y,i)=>shelfZone(x,.9,a.depth,y,a.shelves[bay][i+1]??Math.min(2.18,storageHeight()),.032,zBack));
 }
 snowRacer(2.30,0);

}
function brorStorage(){
 const a=currentPlan();
 for(let bay=0;bay<a.rackCount;bay++){
  const x=.48+bay*.87,zBack=L-a.standOff;
  capture(()=>{
   for(const xx of [x-.4125,x+.4125])for(const z of [zBack-.0125,zBack-.5375])box(.025,1.9,.025,xx,.95,z,'metal',furnitureGroup);
   for(const xx of [x-.4125,x+.4125])for(const y of [.2,1.0,1.85])box(.02,.02,.55,xx,y,zBack-.275,'metal',furnitureGroup);
   for(const y of a.shelves[bay])box(.84,.02,.54,x,y-.01,zBack-.275,'metal',furnitureGroup);
   rod([x-.40,.15,zBack-.0125],[x+.4,1.85,zBack-.0125],.006,'metal',furnitureGroup);
  },'deep',{title:'Rear bay '+(bay+1)+' · BROR 85 × 55 × 190 cm',kind:'product',dimensions:[.85,.55,1.9],note:'All five supplied 84 × 54 cm shelves are used, at nominal mixed heights. Stock outside size is 85 × 55 × 190 cm. Two units remain independent and wall-anchored; no connection kit is assumed.'});
  a.shelves[bay].forEach((y,i)=>shelfZone(x,.84,.54,y,a.shelves[bay][i+1]??Math.min(2.18,storageHeight()),.04,zBack-.005));
 }
 snowRacer(2.30,0);
}
function storage(){
 const a=currentPlan();
 if(a.type==='transform')transformStorage();
 else{furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];if(a.type==='bror')brorStorage();else snowRacer(2.30,0);}
 rightWall();wallShelves();exampleContents();leftWallStorage();
 root.querySelector('#rear-height-value').textContent=Math.round(storageHeight()*100)+' cm';
 root.querySelector('#upper-controls').hidden=!root.querySelector('#garage-upper').checked;
}
