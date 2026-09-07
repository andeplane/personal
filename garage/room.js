 scene.add(new T.HemisphereLight(0xf5f7ff,0x9b896f,1.6));
 const sun=new T.DirectionalLight(0xfff3dc,1.7);sun.position.set(1,5,-3);sun.target.position.set(-1,0,5);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-5,right:5,top:7,bottom:-5,near:.1,far:20});sun.shadow.bias=-.0002;sun.shadow.normalBias=.008;sun.shadow.radius=4;scene.add(sun,sun.target);
 const fill=new T.DirectionalLight(0xdce9ff,.65);fill.position.set(-4,3,1);scene.add(fill);
 box(W+.16,.12,L+.1,W/2,-.065,L/2,'floor');
 const concrete=materials.floor.clone();concrete.color.set('#8d9088');box(.06,.13,L,W-.005,.065,L/2,concrete);box(.06,.13,L,.005,.065,L/2,concrete);
 // Individual pine boards: actual room interior faces remain x=2.83 and z=6.10.
 for(let i=0;i<20;i++){const w=W/20;const m=materials.wood.clone();m.color.multiplyScalar(.92+random()*.15);box(w-.003,H,.034,(i+.5)*w,H/2,L+.017,m);}
 for(let i=0;i<43;i++){const d=L/43;const m=materials.wood.clone();m.color.multiplyScalar(.92+random()*.15);box(.034,H,d-.003,W+.017,H/2,(i+.5)*d,m);}
 // Left wall: exposed studs and horizontal battens, as in the garage photo.
 // Stud faces define the measured usable x=0 boundary; cladding sits behind them.
 for(let i=0;i<43;i++){const d=L/43;const m=materials.wood.clone();m.color.multiplyScalar(.92+random()*.15);const board=box(.034,H,d-.003,-.061,H/2,(i+.5)*d,m);board.userData.wall='left';board.userData.wallPart='panel';}
 for(let z=.25;z<L;z+=.61){const stud=box(.044,H,.07,-.022,H/2,z,'wood');stud.userData.wall='left';stud.userData.wallPart='stud';}
 for(const y of [.7,1.43]){const batten=box(.025,.06,L,-.0315,y,L/2,'wood');batten.userData.wall='left';batten.userData.wallPart='batten';}
 for(const z of [2.03,4.06])box(W,.001,.004,W/2,.001,z,new T.MeshStandardMaterial({color:'#777c75',roughness:1}));
 const studio=new T.MeshStandardMaterial({color:'#e9e9e0',roughness:1});box(200,.02,200,W/2,-.145,L/2,studio);

 for(const m of scene.children){if(m.userData.wall)continue;if(m.isMesh&&m.position.z>=L-.05)m.userData.wall='back';else if(m.isMesh&&m.position.x>=W-.05)m.userData.wall='right';}
