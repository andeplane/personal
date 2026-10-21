// Four whole-garage studies share a coherent rear system. Mixed openings are
// independent of the belongings used to illustrate them.
let shelfZones=[];
function shelfZone(x,width,depth,y,next,thickness=.024){
 shelfZones.push({x,width,depth,y,clear:next-y-thickness,area:width*depth});
}
function storageHeight(){return root.querySelector('#garage-upper').checked?Number(root.querySelector('#rear-height').value)/100:H;}
function upperClearance(){return H+(storageHeight()-H)*(L-.28-4)/(L-4);}
function rearShelf(x,width,depth,y,next,title){
 const board=materials.wood.clone();board.color.set('#dbc3a0');
 capture(()=>{
  box(width,.024,depth,x,y-.012,L-depth/2,board,furnitureGroup);
  for(const xx of [x-width/2+.012,x+width/2-.012])box(.024,.035,depth,xx,y-.0415,L-depth/2,'metal',furnitureGroup);
 },null,{title,kind:'concept',dimensions:[width,depth,.024],height:y,note:'Adjustable shelf concept in a coordinated system. Nominal clear width and top surface shown. Reuse suitable existing shelf units or specify a matching system later; supports, fixings and loads are unverified.'});
 shelfZone(x,width,depth,y,next,.06);
}
function upperStorage(){
 if(storageHeight()<2.4)return;const h=upperClearance();
 const x0=.08,width=2.67,depth=.28,bottom=2.06,top=h-.06,cols=3;
 const levels=[bottom];while(levels.at(-1)+.38+.25<=h)levels.push(levels.at(-1)+.38);
 capture(()=>{
  for(let i=0;i<=cols;i++)box(.018,top-bottom,depth,x0+i*width/cols,(bottom+top)/2,L-depth/2,'white',furnitureGroup);
 },null,{title:'Rear upper compartments · assumed roof clearance',kind:'concept',dimensions:[width,depth,top-bottom],height:bottom,note:'Independent shallow compartments using the taller rear roof space. Roof profile, clear height and support locations are unmeasured. Reuse / extend existing small shelves where suitable; do not infer a loft load rating.'});
 for(let i=0;i<cols;i++)for(let j=0;j<levels.length;j++)rearShelf(x0+(i+.5)*width/cols,width/cols-.025,depth,levels[j],levels[j+1]??h,'Rear upper shelf · '+Math.round(levels[j]*100)+' cm');
}
function storage(){
 const a=data.layouts[current];furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];
 const posts=[.10,1.04,1.98,2.73];
 capture(()=>{
  // Rear-mounted uprights leave a continuous front edge, including the sled slot.
  for(const x of posts)box(.04,a.top,.035,x,a.top/2,L-.0175,'metal',furnitureGroup);
 },null,{title:'Rear shelving · matching adjustable uprights',kind:'concept',dimensions:[a.rearWidth,.035,a.top],note:'One consistent shelving concept across the whole rear wall. No mixed retail rack and timber extension is required by the design. Final system, attachment and load rating remain to be specified.'});
 for(let bay=0;bay<2;bay++){
  const x=(posts[bay]+posts[bay+1])/2,width=posts[bay+1]-posts[bay]-.04;
  a.shelves[bay].forEach((y,i)=>{
   const depth=y>a.stepHeight?a.upperDepth:a.depth;
   rearShelf(x,width,depth,y,a.shelves[bay][i+1]??(storageHeight()>H?2.06:H),'Rear bay '+(bay+1)+' · '+Math.round(depth*100)+' cm deep / '+Math.round(y*100)+' cm high');
  });
 }
 const sx=(posts[2]+posts[3])/2,sw=posts[3]-posts[2]-.04;
 a.shelves[2].forEach((y,i)=>rearShelf(sx,sw,.4,y,a.shelves[2][i+1]??(storageHeight()>H?2.06:H),'Above sled · '+Math.round(y*100)+' cm high'));
 snowRacer(sx);
 rightWall();upperStorage();exampleContents();leftWallStorage();
 root.querySelector('#rear-height-value').textContent=Math.round(storageHeight()*100)+' cm';
 root.querySelector('#upper-controls').hidden=!root.querySelector('#garage-upper').checked;
}
