function rearSurface(a){
 let area=0;for(let i=0;i<2;i++)for(const y of a.shelves[i])area+=.9*(y>a.stepHeight?a.upperDepth:a.depth);
 area+=.71*.4*a.shelves[2].length;
 if(storageHeight()>H){let levels=1;while(2.06+levels*.38+.25<=upperClearance())levels++;area+=3*(2.67/3-.025)*.28*levels;}
 return area;
}
function updateTable(){
 const a=data.layouts[current];
 root.querySelector('#garage-title').textContent=a.id+' · '+a.name;
 root.querySelector('#garage-equipment').textContent=a.summary;
 root.querySelector('#garage-metrics').innerHTML='<span>Rear gap <strong>'+Math.round(a.frontGap*100)+' cm</strong></span><span>Rear depth <strong>'+Math.round(a.depth*100)+' / '+Math.round(a.upperDepth*100)+' cm</strong></span><span>Rear shelf surface <strong>'+shelfZones.reduce((s,z)=>s+z.area,0).toFixed(1)+' m²</strong></span><span>Left wall <strong>'+leftWallStats.added+' inserts + '+leftWallStats.baskets+' high baskets</strong></span><span>Loft <strong>existing · '+loftStats.length.toFixed(1)+' m assumed length</strong></span>';
 root.querySelector('#garage-price').textContent='Layout study · components unpriced';
 root.querySelector('#garage-unpriced').textContent=a.unpriced;
 root.querySelector('#inventory-rows').innerHTML=data.inventory.map(i=>'<tr><td>'+i.name+'<br><small>'+i.count+'</small></td><td>'+i.evidence+'</td><td>'+i.storage+'</td></tr>').join('');
 root.querySelector('#comparison-rows').innerHTML=data.layouts.map(p=>'<tr'+(p===a?' class="selected-plan"':'')+'><td>'+p.id+' · '+p.name+'</td><td>'+Math.round(p.depth*100)+' / '+Math.round(p.upperDepth*100)+' cm</td><td>'+rearSurface(p).toFixed(1)+' m²</td><td>'+Math.round(p.frontGap*100)+' cm</td><td>'+(p.depth>=.8?'Car out for rear retrieval':p.depth>=.6?'Tighter rear retrieval':p.depth>=.5?'Balanced starting point':'Most rear floor space')+'</td></tr>').join('');
 root.querySelector('#garage-products').innerHTML=[
  ['Rear wall','8 adjustable main shelves + 2 above the sled; a 90 cm wide × 104 cm high opening for bulky things','Proposed system / reuse suitable existing small units; folded bike-carrier depth still needs checking'],
  ['Upper rear','28 cm deep compartments in the taller roof area','Conditional on the assumed clearance'],
  ['Left wall',leftWallStats.added+' flush inserts + '+leftWallStats.baskets+' high baskets','Existing ledges, braces and charger kept'],
  ['Right wall','High ski shelf; shallow tools; ladder, folded chairs and table','Reuse existing shelf and adapt hooks / straps'],
  ['Loft / hems','Seasonal / bulky storage; clear strip and approach','Existing deck; footprint / loading unmeasured']
 ].map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('');
}
