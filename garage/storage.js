// Shelf capacity drives the layout. Example belongings never determine the bays.
let shelfZones=[];
function shelfZone(x,width,depth,y,next,thickness=.02){
 const clear=next-y-thickness;
 shelfZones.push({x,width,depth,y,clear,area:width*depth});
}
function smallShelves(x,width,bottom,top,depth=.28,columns=2,title='Small shelf compartments'){
 const levels=[bottom,top];if(top-bottom>.6)levels.splice(1,0,(bottom+top)/2);
 capture(()=>{
  for(const y of levels)box(width,.018,depth,x,y-.009,L-depth/2,'white',furnitureGroup);
  for(let i=0;i<=columns;i++)box(.018,top-bottom,depth,x-width/2+i*width/columns,(bottom+top)/2,L-depth/2,'white',furnitureGroup);
 },null,{title,dimensions:[width,depth,top-bottom],height:bottom,kind:'concept',note:'Reuse / extend the small shelf compartments seen at the left rear. This is a fit study: measure the existing units before reusing them. Supports, added shelves and adaptations are unpriced.'});
 for(let i=0;i<levels.length-1;i++)for(let j=0;j<columns;j++)shelfZone(x-width/2+(j+.5)*width/columns,width/columns-.025,depth,levels[i],levels[i+1]);
}
function storageHeight(){return root.querySelector('#garage-upper').checked?Number(root.querySelector('#rear-height').value)/100:H;}
function upperStorage(){
 const h=storageHeight();if(h<2.4)return;
 // This independent, shallow wall shelf is a conditional study above the 2.10 m reference.
 // Do not extend the selected commercial rack or imply a verified roof profile.
 smallShelves(W/2,2.4,2.12,h-.12,.28,3,'Upper small shelves · assumed clearance');
}
function storage(){
 const a=data.layouts[current];furnitureGroup=new T.Group();scene.add(furnitureGroup);shelfZones=[];
 if(['D','E','F'].includes(a.id))expandedStorage(a);
 else if(a.id==='A'){
  const centers=[.505,1.215,1.825,2.435],widths=[.8,.6,.6,.6],rails=[.10,.91,1.52,2.13,2.74];
  for(const x of rails)box(.025,2,.02,x,1.025,L-.01,'white',furnitureGroup);
  for(let i=0;i<4;i++)box(widths[i]+.01,.025,.012,centers[i],2.012,L-.02,'white',furnitureGroup);
  const brackets=new Set();a.shelves.forEach((levels,i)=>{for(let j=0;j<levels.length;j++){
   const y=levels[j];box(widths[i],.02,.38,centers[i],y-.01,L-.21,'white',furnitureGroup);
   brackets.add(i+':'+y);brackets.add((i+1)+':'+y);
   shelfZone(centers[i],widths[i]-.04,.38,y,levels[j+1]??H);
  }});
  for(const key of brackets){const [i,y]=key.split(':').map(Number);box(.014,.055,.4,rails[i],y-.04,L-.2,'white',furnitureGroup);}
  snowRacer(centers[0]);
 }else{
  const height=a.id==='B'?1.9:1.1;
  for(const [i,x] of [.56,1.42].entries()){
   const levels=a.shelves[i];bror(x,.85,.55,levels,height);
   levels.forEach((y,j)=>shelfZone(x,.79,.53,y,levels[j+1]??(a.id==='C'?1.2:H),.05));
  }
  if(a.id==='C')smallShelves(.99,1.69,1.23,1.98,.28,3,'Reused / extended small shelf compartments');
  const sx=2.27;for(const xx of [sx-.405,sx+.405])box(.025,1,.02,xx,1.525,L-.01,'white',furnitureGroup);
  box(.824,.025,.01,sx,2.012,L-.02,'white',furnitureGroup);
  const levels=a.shelves[2];for(const [i,y] of levels.entries()){
   box(.80,.02,.38,sx,y-.01,L-.21,'white',furnitureGroup);
   for(const xx of [sx-.405,sx+.405])box(.014,.055,.4,xx,y-.04,L-.2,'white',furnitureGroup);
   shelfZone(sx,.76,.38,y,levels[i+1]??H);
  }
  snowRacer(sx);
 }
 rightWall();upperStorage();exampleContents();
 root.querySelector('#rear-height-value').textContent=Math.round(storageHeight()*100)+' cm';
 root.querySelector('#upper-controls').hidden=!root.querySelector('#garage-upper').checked;
}
