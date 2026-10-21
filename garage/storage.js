// Retail rear units: one 975 mm starter + two 910 mm extensions.
let shelfZones=[];
function shelfZone(x,width,depth,y,next,thickness=.032,zBack=L){shelfZones.push({x,width,depth,y,clear:next-y-thickness,area:width*depth,zBack});}
function storageHeight(){return root.querySelector('#garage-upper').checked?Number(root.querySelector('#rear-height').value)/100:H;}
function upperClearance(){return H+(storageHeight()-H)*(L-.4-4)/(L-4);}
function upperLevels(){
 if(storageHeight()<2.4)return [];
 const levels=[],top=storageHeight()-.1;
 for(let y=2.15;y<=top-.06&&y+.20<=upperClearance();y+=.32)levels.push(y);
 return levels;
}
function upperStorage(){
 const levels=upperLevels();if(!levels.length||data.layouts[current].type==='boaxel')return;
 const top=storageHeight()-.1,bottom=top-1;
 // Three independent 80 cm bays use stock 82.4 cm alignment rails.
 for(let bay=0;bay<(data.layouts[current].type==='bror'?2:3);bay++){
  const x=.575+bay*.84;
  capture(()=>box(.824,.02,.01,x,top-.01,L-.005,'white',furnitureGroup),'upperMount',{title:'Upper rear · BOAXEL alignment rail '+(bay+1),kind:'product',height:top-.02,note:'Alignment aid only. Each upright is independently fastened to structural backing.'});
  for(const xx of [x-.4,x+.4])capture(()=>box(.02,1,.026,xx,bottom+.5,L-.013,'white',furnitureGroup),'upperRail',{title:'Upper rear · BOAXEL upright / bay '+(bay+1),kind:'product',height:bottom});
  levels.forEach((y,i)=>{
   capture(()=>box(.8,.02,.38,x,y-.01,L-.21,'white',furnitureGroup),'shelf',{title:'Upper rear · BOAXEL shelf / bay '+(bay+1)+' / '+Math.round(y*100)+' cm',kind:'product',dimensions:[.8,.38,.02],height:y,note:'Uses the taller rear roof space. 38 cm shelf in a 40 cm system. Roof profile and structural wall fixing positions are assumed, so check them before ordering.'});
   for(const xx of [x-.4,x+.4])capture(()=>{
    box(.01,.075,.026,xx,y-.05,L-.013,'white',furnitureGroup);box(.01,.015,.4,xx,y-.0275,L-.2,'white',furnitureGroup);
   },'upperBracket',{title:'Upper rear · BOAXEL bracket / '+Math.round(y*100)+' cm',kind:'product',height:y-.08});
   shelfZone(x,.8,.38,y,levels[i+1]??upperClearance(),.10,L-.02);
  });
 }
}
function transformStorage(){
 const a=data.layouts[current];furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];
 const start=(W-a.rearWidth)/2,zBack=L-a.standOff;
 const centers=[start+.4875,start+.975+.455,start+.975+.91+.455];
 for(let bay=0;bay<3;bay++){
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
  },key,{title:'Rear bay '+(bay+1)+' · TRANSFORM '+(bay===0?'starter':'extension')+' / '+Math.round(a.depth*100)+' cm',kind:'product',dimensions:[bay===0?.975:.91,a.depth,a.top],note:'Four included shelves are repositioned in this bay; no extra shelf is assumed. Heights are nominal positions on the 32 mm grid. Complete run: 279.5 cm wide, with 4 cm behind it for the separate upper wall rails. Outer rack members are simplified.'});
  a.shelves[bay].forEach((y,i)=>shelfZone(x,.9,a.depth,y,a.shelves[bay][i+1]??(upperLevels().length?2.15:storageHeight()),.032,zBack));
 }
 snowRacer(centers[2]);

}
function boaxelBay(x,width,levels,railBottom,railKey='upright',title='BOAXEL rear bay'){
 const rail=data.products[railKey],height=rail.dimensions[2],top=railBottom+height;
 capture(()=>box(.824,.02,.01,x,top-.01,L-.005,'white',furnitureGroup),'upperMount',{title:title+' · 82.4 cm mounting rail',kind:'product',height:top-.02});
 for(const xx of [x-width/2,x+width/2])capture(()=>box(.02,height,.026,xx,railBottom+height/2,L-.013,'white',furnitureGroup),railKey,{title:title+' · '+Math.round(height*100)+' cm upright',kind:'product',height:railBottom});
 levels.forEach((y,i)=>{
  capture(()=>box(width,.02,.38,x,y-.01,L-.21,'white',furnitureGroup),'shelf',{title:title+' · metal shelf / '+Math.round(y*100)+' cm',kind:'product',dimensions:[width,.38,.02],height:y});
  for(const xx of [x-width/2,x+width/2])capture(()=>{
   box(.01,.075,.026,xx,y-.05,L-.013,'white',furnitureGroup);box(.01,.015,.4,xx,y-.0275,L-.2,'white',furnitureGroup);
  },'upperBracket',{title:title+' · 40 cm bracket / '+Math.round(y*100)+' cm',kind:'product',height:y-.08});
  shelfZone(x,width,.38,y,levels[i+1]??upperClearance(),.10,L-.02);
 });
}
function boaxelLift(){return Math.max(0,Math.min(.25,upperClearance()-2.08));}
function boaxelStorage(){
 const a=data.layouts[current],lift=boaxelLift();
 for(let bay=0;bay<3;bay++)boaxelBay(.575+bay*.84,.8,a.shelves[bay].map(y=>y+lift),.025+lift,'upright','Rear bay '+(bay+1)+' · BOAXEL');
 snowRacer(2.255,0);
}
function brorStorage(){
 const a=data.layouts[current];
 for(let bay=0;bay<2;bay++){
  const x=.48+bay*.87,zBack=L-a.standOff;
  capture(()=>{
   for(const xx of [x-.4125,x+.4125])for(const z of [zBack-.0125,zBack-.5375])box(.025,1.9,.025,xx,.95,z,'metal',furnitureGroup);
   for(const xx of [x-.4125,x+.4125])for(const y of [.2,1.0,1.85])box(.02,.02,.55,xx,y,zBack-.275,'metal',furnitureGroup);
   for(const y of a.shelves[bay])box(.84,.02,.54,x,y-.01,zBack-.275,'metal',furnitureGroup);
   rod([x-.40,.15,zBack-.0125],[x+.4,1.85,zBack-.0125],.006,'metal',furnitureGroup);
  },'deep',{title:'Rear bay '+(bay+1)+' · BROR 85 × 55 × 190 cm',kind:'product',dimensions:[.85,.55,1.9],note:'All five supplied 84 × 54 cm shelves are used, at nominal mixed heights. Stock outside size is 85 × 55 × 190 cm. Two units remain independent and wall-anchored; no connection kit is assumed.'});
  a.shelves[bay].forEach((y,i)=>shelfZone(x,.84,.54,y,a.shelves[bay][i+1]??(upperLevels().length?2.15:storageHeight()),.04,zBack-.005));
 }
 const top=upperLevels().length?Math.max(2.32,upperLevels().at(-1)+.10):2.0,levels=[...a.shelves[2],...upperLevels()];
 boaxelBay(2.24,.8,levels,top-2,'upright','Above sled · BOAXEL');snowRacer(2.24,0);
}
function storage(){
 const a=data.layouts[current];
 if(a.type==='transform')transformStorage();
 else{furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];if(a.type==='boaxel')boaxelStorage();else brorStorage();}
 rightWall();upperStorage();exampleContents();leftWallStorage();
 root.querySelector('#rear-height-value').textContent=Math.round(storageHeight()*100)+' cm';
 root.querySelector('#upper-controls').hidden=!root.querySelector('#garage-upper').checked;
}
