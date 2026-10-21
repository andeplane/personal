// Illustrative mixed contents, not an inventory count or a claim that all belongings fit.
function exampleContents(){
 const examples=[
  {title:'Rucksack lying down · example',kind:'pack',size:[.66,.30,.25],colour:'gear'},
  {title:'Small backpack · example',kind:'pack',size:[.32,.22,.45],colour:'accent'},
  {title:'Soft sports bag · example',kind:'bag',size:[.46,.28,.25],colour:'rubber'},
  {title:'Compressed bag · example',kind:'bag',size:[.34,.22,.18],colour:'gear'},
  {title:'Ice skates · example pair',kind:'skates',size:[.28,.31,.28]},
  {title:'Ski boots / winter footwear · example pair',kind:'boots',size:[.28,.31,.34]},
  {title:'Small bags / accessories · example',kind:'bag',size:[.29,.22,.20],colour:'accent'},
  {title:'Rolled long bag · example',kind:'roll',size:[.52,.16,.16],colour:'gear'},
  {title:'Maintenance supplies · example',kind:'supplies',size:[.24,.15,.22]}
 ];
 const available=shelfZones.filter(z=>z.clear>.13).map(z=>({...z}));
 for(const item of examples){
  const [w,d,h]=item.size;
  // Prefer a suitable opening; leave other bays open for changing / future belongings.
  const candidates=available.filter(z=>z.width>w+.02&&z.depth>d+.01&&z.clear>h+.015);
  candidates.sort((a,b)=>(a.clear-h)*2+(a.width-w)-((b.clear-h)*2+(b.width-w)));
  const slot=candidates[0];if(!slot)continue;available.splice(available.indexOf(slot),1);
  const px=slot.x-slot.width/2+w/2+.01;
  const remainder=slot.width-w-.06;
  if(remainder>.16)available.push({...slot,x:slot.x+(w+.06)/2,width:remainder});
  const group=new T.Group(),mat=fabricMaterial(item.colour||'rubber');
  const soft=(ww,hh,dd,x,y,z,m=mat)=>{const mesh=new T.Mesh(new RoundedBoxGeometry(ww,hh,dd,3,Math.min(.035,ww/5,hh/5,dd/5)),m);mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);};
  if(item.kind==='skates'||item.kind==='boots'){
   for(const x of [-w/4,w/4]){
    soft(w*.42,.075,d*.9,x,.06,0);
    soft(w*.39,h-.08,d*.5,x,(h+.08)/2,d*.18,item.kind==='boots'?materials.white:mat);
    if(item.kind==='skates'){
     soft(.012,.018,d*.85,x,.009,0,materials.metal);
     for(const zz of [-d*.27,d*.27])soft(.025,.025,.025,x,.03,zz,materials.metal);
    }
    for(const y of [h*.45,h*.67])soft(w*.43,.012,.015,x,y,-d*.08,materials.metal);
   }
  }else if(item.kind==='supplies'){
   for(const [i,hh] of [.15,.21,.18].entries())soft(.065,hh,.08,(i-1)*.08,hh/2,0,materials.white);
  }else{
   soft(w*.96,h*.92,d*.94,0,h/2,0);
   if(item.kind==='pack'){
    soft(w*.55,h*.34,d*.08,0,h*.42,-d*.47);
    for(const x of [-w*.2,w*.2])soft(.017,h*.65,.008,x,h*.52,-d*.49,materials.rubber);
   }else if(item.kind==='bag'){
    for(const x of [-w*.2,w*.2])soft(.015,h*.65,.009,x,h*.52,-d*.47,materials.rubber);
   }
  }
  group.position.set(px,slot.y+.003,L-slot.depth+d/2+.005);
  furnitureGroup.add(group);
  register([group],null,{title:item.title,kind:'example',dimensions:item.size,height:slot.y,note:'Representative size only; not a measurement of your belongings or a fixed quantity. Mixed packed / compressed bags can stand, lie down or hang. Remaining space is intentionally unallocated.'});equipmentMeshes.push(group);
 }
}
