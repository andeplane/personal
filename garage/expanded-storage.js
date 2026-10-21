// Keep the right wall shallow below head level, and reuse its high ski shelf.
function rightWall(){
 capture(()=>{
  box(.3,.018,2.4,W-.15,1.941,3.35,'wood',furnitureGroup);
  for(const z of [2.25,2.98,3.71,4.45]){
   box(.025,.20,.025,W-.015,1.832,z,'metal',furnitureGroup);
   box(.30,.018,.025,W-.15,1.923,z,'metal',furnitureGroup);
   rod([W-.02,1.732,z],[W-.28,1.915,z],.009,'metal',furnitureGroup);
  }
 },null,{title:'Right wall · existing high ski shelf',kind:'existing-storage',side:'right',dimensions:[2.4,.3,.218],dimensionLabel:'Along wall × projection × shelf/support height',height:1.95,note:'Reuse the existing shelf visible in the photos. The model estimates 240 cm length, 30 cm depth and 195 cm top height. Preserve clearance to the door track and the loft; actual location / dimensions are unmeasured.'});
 capture(()=>{
  box(.025,.68,1.35,W-.015,1.24,1.16,'metal',furnitureGroup);
  for(const z of [.65,.92,1.19,1.46,1.73])rod([W-.03,1.4,z],[W-.10,1.4,z],.006,'metal',furnitureGroup);
 },null,{title:'Right wall · shallow tool strip',kind:'concept',side:'right',dimensions:[1.35,.11,.68],dimensionLabel:'Along wall × maximum projection × height',height:.90,note:'An optional shallow board / rail for small tools and accessories near the entrance. Keep the main walking route on the left. Hook selection and exact placement are unpriced.'});
 capture(()=>{
  box(.055,.35,.30,W-.085,.20,1.65,'rubber',furnitureGroup);
  rod([W-.085,.32,1.65],[W-.085,1.50,1.65],.016,'wood',furnitureGroup);
  rod([W-.085,1.50,1.56],[W-.085,1.50,1.74],.018,'rubber',furnitureGroup);
 },null,{title:'Existing snow shovel / long tool · estimated envelope',side:'right',dimensions:[.32,.12,1.55],dimensionLabel:'Along wall × projection × height',note:'Long-tool example for the observed equipment category, using a shallow wall position. Exact shape, length and placement are unmeasured.'},true);
 for(const z of [2.6,3.2,4.15,4.95])capture(()=>rod([W-.01,1.5,z],[W-.08,1.5,z],.01,'metal',furnitureGroup),null,{title:'Right wall · folded-gear mounting point',kind:'concept',height:1.5,note:'Retain / adapt existing hooks and straps. About 15 cm total folded-gear projection is assumed; actual gear and fixing locations need checking.'});
 for(const z of [2.6,3.2])capture(()=>{
  box(.08,.47,.4,W-.095,1.05,z,'rubber',furnitureGroup);
  for(const zz of [z-.22,z+.22])rod([W-.14,.5,zz],[W-.14,1.5,zz],.014,'metal',furnitureGroup);
  for(const y of [.5,1.5])rod([W-.14,y,z-.22],[W-.14,y,z+.22],.014,'metal',furnitureGroup);
 },null,{title:'Existing folding chair',side:'right',dimensions:[.5,.16,1],dimensionLabel:'Along wall × projection × height',note:'Provisional folded size. Separate places avoid stacking the chairs farther into the garage.'},true);
 capture(()=>{
  for(const z of [3.94,4.36])rod([W-.10,.05,z],[W-.10,1.95,z],.022,'white',furnitureGroup);
  for(let y=.18;y<1.9;y+=.26)rod([W-.10,y,3.94],[W-.10,y,4.36],.02,'white',furnitureGroup);
 },null,{title:'Existing stepladder / gardintrapp',side:'right',dimensions:[.5,.15,1.9],dimensionLabel:'Along wall × projection × height',note:'Accessible folded wall position; estimated dimensions. This is not a specified loft-access ladder.'},true);
 capture(()=>{
  box(.07,1.25,.75,W-.05,.65,4.92,'white',furnitureGroup);
  box(.009,.03,.76,W-.095,1.05,4.92,'accent',furnitureGroup);
 },null,{title:'Existing folding table',side:'right',dimensions:[.76,.10,1.25],dimensionLabel:'Along wall × projection × height',note:'Estimated folded envelope. Removable straps keep the table shallow and accessible.'},true);
 capture(()=>{for(let i=0;i<2;i++)box(.055,.025,2.15,W-.10-i*.09,1.9675,3.35,'gear',furnitureGroup);},null,{title:'Right shelf · existing ski bundle',side:'right',dimensions:[2.15,.20,.025],dimensionLabel:'Along wall × depth × height',note:'Illustrative bundle only; ski lengths and quantities are unmeasured.'},true);
}
