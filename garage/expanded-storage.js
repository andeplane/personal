// Dimensions are metres. All layouts share the same side-wall installation.
function pineShelf(side,center,height,width=2.4){
 const plankMat=materials.wood.clone();
 const rear=side==='rear',left=side==='left',x=rear?W/2:left?.15:W-.15,z=rear?L-.15:center;
 capture(()=>box(rear?width:.3,.018,rear?.3:width,x,height-.009,z,plankMat,furnitureGroup),'plank',{title:(rear?'Rear raised shelf':left?'Left ski shelf':'Right upper shelf')+' · '+Math.round(height*100)+' cm',height,dimensions:[width,.3,.018],note:'240 cm solid pine board. Proposed support spacing ≤ 75 cm; fixing and loading depend on the real wall backing. Check door tracks and hems beams. Shelf dimensions follow the board, not room axes.'});
 for(let i=0;i<4;i++){const t=-width/2+.10+i*(width-.2)/3,xx=rear?W/2+t:left?.015:W-.015,zz=rear?L-.015:center+t;
 capture(()=>{if(rear){box(.025,.20,.025,xx,height-.118,zz,'metal',furnitureGroup);box(.025,.018,.30,xx,height-.027,L-.15,'metal',furnitureGroup);rod([xx,height-.218,L-.02],[xx,height-.035,L-.28],.009,'metal',furnitureGroup);}else{box(.025,.20,.025,xx,height-.118,zz,'metal',furnitureGroup);box(.30,.018,.025,left?.15:W-.15,height-.027,zz,'metal',furnitureGroup);rod([xx,height-.218,zz],[left?.28:W-.28,height-.035,zz],.009,'metal',furnitureGroup);}},'pineBracket',{title:'30 cm shelf bracket',height:height-.018,note:'20 cm vertical leg, 30 cm projection. Fix into structural backing; paneling alone is not an assumed fixing substrate.'});
 }
}
function rightWall(){
 pineShelf('left',3.15,1.95);pineShelf('right',1.7,1.95);
 // Perforation pattern represented with a repeating texture; external board size is exact.
 const c=document.createElement('canvas');c.width=c.height=48;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,48,48);ctx.fillStyle='#101716';ctx.beginPath();ctx.arc(24,24,8,0,Math.PI*2);ctx.fill();const tex=new T.CanvasTexture(c);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(.955/.012,.82/.012);
 const pm=new T.MeshStandardMaterial({color:'#465659',metalness:.6,roughness:.5,map:tex,transparent:false,alphaTest:0,side:T.DoubleSide});
 for(const z of [1.05,2.06]){
 capture(()=>{const m=new T.Mesh(new T.PlaneGeometry(.955,.82),pm);m.rotation.y=-Math.PI/2;m.position.set(W-.021,1.20,z);furnitureGroup.add(m);for(const yy of [.79,1.61])box(.025,.015,.955,W-.012,yy,z,'metal',furnitureGroup);for(const zz of [z-.4775,z+.4775])box(.025,.82,.015,W-.012,1.2,zz,'metal',furnitureGroup);},'pegboard',{title:'Right wall · perforated tool board',dimensions:[.955,.025,.82],height:.79,note:'Steel plate with 4 mm holes at 12 mm centres. Hook systems are not universal: 25 mm pitch accessories do not match. Allow 2.5 cm mounting stand-off in this model.'});
 capture(()=>{box(.135,.008,.36,W-.0925,1.08,z,'metal',furnitureGroup);box(.008,.11,.36,W-.029,1.131,z,'metal',furnitureGroup);box(.008,.03,.36,W-.156,1.095,z,'metal',furnitureGroup);},'tray',{title:'Movable magnetic tray',dimensions:[.36,.135,.11],height:1.08,note:'Magnetic mounting on the steel board; position is movable. About 16 cm total wall projection including stand-off. Reserve for small items; verify holding capacity.'});
 }
 for(let i=0;i<4;i++)box(.017,.06,.6,W-.009,1.62,2.85+i*.6,'metal',furnitureGroup);
 capture(()=>{for(let i=0;i<20;i++){const z=2.6+i*.118;rod([W-.02,1.62,z],[W-.09,1.62,z],.006,'metal',furnitureGroup);rod([W-.09,1.62,z],[W-.09,1.66,z],.006,'metal',furnitureGroup);}},'hookKit',{title:'20 adjustable rail hooks',note:'Two kits supply four 60 cm rails and twenty movable hooks. Separate from the perforated-board system.'});
 for(const z of [2.86,3.44,3.99,4.41])capture(()=>rod([W-.01,1.5,z],[W-.08,1.5,z],.01,'metal',furnitureGroup),'shortHook',{title:'Folded-gear wall hook',height:1.5});
 for(const z of [2.86,3.44])capture(()=>{box(.08,.47,.4,W-.095,1.05,z,'rubber',furnitureGroup);for(const zz of [z-.22,z+.22])rod([W-.14,.5,zz],[W-.14,1.5,zz],.014,'metal',furnitureGroup);for(const y of [.5,1.5])rod([W-.14,y,z-.22],[W-.14,y,z+.22],.014,'metal',furnitureGroup);},null,{title:'Existing folding chair',dimensions:[.5,.15,1],note:'Estimated folded size; separate hooks avoid stacking into the car clearance.'},true);
 capture(()=>{for(const z of [3.99,4.41])rod([W-.10,.05,z],[W-.10,1.95,z],.022,'white',furnitureGroup);for(let y=.18;y<1.9;y+=.26)rod([W-.10,y,3.99],[W-.10,y,4.41],.02,'white',furnitureGroup);},null,{title:'Existing stepladder / gardintrapp',dimensions:[.5,.15,1.9],note:'Provisional folded dimensions.'},true);
 capture(()=>{box(.07,1.25,.75,W-.05,.65,4.9,'white',furnitureGroup);box(.009,.03,.76,W-.095,1.05,4.9,'accent',furnitureGroup);},null,{title:'Existing folding table',dimensions:[.75,.08,1.25],note:'Estimated folded envelope; retained by strap.'},true);
 capture(()=>{for(let i=0;i<2;i++)box(.055,.025,2.15,.10+i*.09,1.9675,3.15,'gear',furnitureGroup);},null,{title:'Left shelf · ski bundle',dimensions:[.20,2.15,.025],note:'Illustrative 215 cm ski length; count and actual lengths unmeasured. Top stays below 2 m.'},true);
}
function expandedStorage(a){
 if(a.id==='F'){pineShelf('rear',0,1.45);pineShelf('rear',0,1.95);return;}
 const w=a.rackWidth,d=a.depth,h=a.top,x=.10+w/2,key=a.id==='D'?'rack60':'rack80';
 const steel=new T.MeshStandardMaterial({color:'#9da6a8',metalness:.72,roughness:.38}),beam=steel.clone();if(a.id==='E')beam.color.set('#bf4f2b');const board=materials.wood.clone();board.color.set('#b0a187');
 capture(()=>{for(const xx of [x-w/2+.025,x+w/2-.025])for(const zz of [L-d+.025,L-.025]){box(.049,h,.049,xx,h/2,zz,steel,furnitureGroup);for(let y=.075;y<h;y+=.05)box(.012,.018,.001,xx,y,zz-.025,'rubber',furnitureGroup);}for(const y of a.shelves[0]){box(w-.10,.022,d-.02,x,y-.011,L-d/2,board,furnitureGroup);for(const zz of [L-d+.025,L-.025])box(w-.05,.056,.035,x,y-.05,zz,beam,furnitureGroup);}},key,{title:a.system,dimensions:[w,d,h],levels:a.shelves[0],note:a.id==='D'?'Four chipboard shelves supplied; three installed for tall backpack openings, one spare. Wall anchoring required; protect board surfaces against moisture. Nominal external dimensions; confirm assembly clearances.':'Three 22 mm shelf plates. External width 144.8 cm, clear beam span 133.5 cm; 80 cm depth. Price shown includes 25% VAT. Two full units would be 289.6 cm wide and do not fit.'});
 rearExtension(a);for(const x of [.45,1.05])pack(x,.1,L-.26);pack(.55,a.shelves[0][1],L-.26,'accent');
}

function rearExtension(a){
 const x0=.10+a.rackWidth+.02,w=a.extensionWidth,d=a.depth,x=x0+w/2;
 const wood=materials.wood.clone();wood.color.set('#b69972');
 const note='Custom timber / plywood extension, not a retail rack. 45 mm frame and 18 mm shelf geometry are provisional; connections and safe load must be designed for the actual contents. A 1,500 kr materials allowance is included separately in the planning budget, not in the catalogue-product total.';
 capture(()=>{for(const xx of [x0+.0225,x0+w-.0225])for(const zz of [L-d+.0225,L-.0225])box(.045,1.95,.045,xx,.975,zz,wood,furnitureGroup);},null,{title:'Custom full-depth extension · frame',dimensions:[w,d,1.95],note});
 const sledClear=.65,divider=x0+w-.045-sledClear-.0225,narrow=divider-.0225-(x0+.045),nx=x0+.045+narrow/2;
 capture(()=>{for(const zz of [L-d+.0225,L-.0225])box(.045,1.36,.045,divider,.68,zz,wood,furnitureGroup);},null,{title:'Divider · 65 cm clear sled slot',dimensions:[.045,d,1.36],note:'Keeps a dedicated 65 cm wide opening for the estimated 60 cm snow racer. Measure its steering wheel and protrusions.'});
 for(const y of [1.45,1.95])capture(()=>{box(w-.09,.018,d,x,y-.009,L-d/2,wood,furnitureGroup);for(const zz of [L-d+.0225,L-.0225])box(w-.09,.07,.045,x,y-.053,zz,wood,furnitureGroup);},null,{title:'Custom upper shelf · '+Math.round(y*100)+' cm',dimensions:[w-.09,d,.018],height:y,note:note+' Lowest front beam underside: 137 cm, above the provisional 130 cm sled.'});
 for(const y of [.1,.65])capture(()=>{box(narrow,.018,d,nx,y-.009,L-d/2,wood,furnitureGroup);for(const zz of [L-d+.0225,L-.0225])box(narrow,.07,.045,nx,y-.053,zz,wood,furnitureGroup);},null,{title:'Custom small-gear shelf · '+Math.round(y*100)+' cm',dimensions:[narrow,d,.018],height:y,note});
 snowRacer(x0+w-.045-sledClear/2);
}
