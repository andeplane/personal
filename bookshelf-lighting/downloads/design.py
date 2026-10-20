"""Bookshelf controller v2, millimetres. Published dimensions + explicit clearance reservations.
Run with Python and requirements.txt. No component model is a printable electronic part.
"""
from pathlib import Path
import json
import cadquery as cq
import trimesh
import subprocess,sys
ROOT=Path(__file__).parent
OUT=ROOT/'print-files'; OUT.mkdir(exist_ok=True)
L,W,H=180.,112.,32.
WALL,FLOOR,LID=2.4,2.4,2.4
PILOT,CLEARANCE=2.6,3.4
SCREWS=[(6,6),(174,6),(6,106),(174,106)]
GUARD=[(14,46),(96,46),(14,104),(96,104)]
RAILS=[(30,14),(30,33),(119,14),(119,36)]
def box(x,y,z,dx,dy,dz):
    return cq.Workplane('XY').box(dx,dy,dz,centered=False).translate((x,y,z))
def cylinder(x,y,z,r,h):
    return cq.Workplane('XY').circle(r).extrude(h).translate((x,y,z))
def rounded(dx,dy,dz,r=3):
    return box(0,0,0,dx,dy,dz).edges('|Z').fillet(r)
def anchor(x,y):
    a=box(x-4,y-4,FLOOR-.1,8,8,4.1)
    return a.cut(box(x-1.5,y-4.1,FLOOR+.8,3,8.2,1.5))
def main_base():
    s=rounded(L,W,H).cut(box(WALL,WALL,FLOOR,L-2*WALL,W-2*WALL,H))
    for x,y in SCREWS:
        s=s.union(cylinder(x,y,FLOOR-.1,4.5,H-FLOOR+.1)).cut(cylinder(x,y,H-10,PILOT/2,10.2))
    # Open cable seams: USB cable is installed with its connectors intact.
    s=s.cut(box(-.1,26,H-4,3,4,5))
    s=s.cut(box(L-3,26,H-4,3.1,4,5))
    for x,y in [(10,28),(170,32),(25,20),(79,20),(25,40),(79,40),(113,21),(169,21),(113,43),(169,43),(115,73),(160,73),(115,99),(160,99)]:
        s=s.union(anchor(x,y))
    # M3 mounting posts for sliding insulated PCB rails. Post top Z=9.
    for xx,yy in RAILS:
        for dx in (4,40):
            s=s.union(cylinder(xx+dx,yy+7,FLOOR-.1,3,6.7))
            s=s.cut(cylinder(xx+dx,yy+7,2.8,PILOT/2,6.5))
    # Smooth battery platform + low perimeter. Pocket 72 x 57; pack 68 x 55 x 6.7.
    platform=box(18,48,FLOOR-.1,74,59,2.1)
    rim=box(18,48,4.3,74,59,2.1).cut(box(19,49,4.2,72,57,2.3))
    rim=rim.cut(box(88,67,4.2,5,15,3)) # lead exit
    s=s.union(platform).union(rim)
    for x,y in GUARD:
        s=s.union(cylinder(x,y,FLOOR-.1,3,12.7)).cut(cylinder(x,y,8.5,PILOT/2,7))
    return s.clean()
def main_lid():
    s=rounded(L,W,LID)
    lip=box(3.1,3.1,-1.6,L-6.2,W-6.2,1.7).cut(box(4.5,4.5,-1.7,L-9,W-9,2))
    for x,y in SCREWS: lip=lip.cut(cylinder(x,y,-1.8,5.2,2.2))
    s=s.union(lip)
    for x,y in SCREWS: s=s.cut(cylinder(x,y,-2,CLEARANCE/2,5))
    s=s.cut(cylinder(96,30,-2,3.1,5))
    # Vent/indicator grille above charger; no exact LED positions assumed.
    for y in (21,26,31,36): s=s.cut(box(40,y,-2,24,2.5,5))
    return s.clean()
def pcb_rail():
    # Screw plate 2 mm; board ledge at 6 mm. Heads remain below PCB plane.
    s=rounded(44,14,2,1.5).union(box(8,5,1.9,28,4,4.1))
    for x in (4,40):
        slot=cq.Workplane('XY').center(x,7).slot2D(12,3.4,90).extrude(2.2).translate((0,0,-.1))
        s=s.cut(slot)
    return s.clean()
def battery_guard():
    s=box(11,43,0,88,64,2.4).edges('|Z').fillet(2)
    for x,y in GUARD: s=s.cut(cylinder(x,y,-.1,CLEARANCE/2,3))
    for x in range(24,84,10): s=s.cut(box(x,54,-.1,5,43,3))
    return s.clean()
def tap_base():
    # Soldered T splice cover: continuous trunk on x, lamp drop on +y.
    dx,dy,dz=48,22,10
    s=rounded(dx,dy,dz,2).cut(box(1.6,1.6,1.6,dx-3.2,dy-3.2,dz))
    for x,y in [(5,5),(43,5)]:
        s=s.union(cylinder(x,y,1.5,3.5,8.5))
        s=s.cut(cylinder(x,y,3.8,PILOT/2,7))
    # Open seam slots permit a cover to be fitted over an already soldered harness.
    for x in (-0.1,46.3):
        s=s.cut(box(x,9,5.0,1.8,4,6))
    s=s.cut(box(22,20.3,5.0,4,1.8,6))
    # Two isolated solder pockets. No exposed copper may touch the other pocket.
    s=s.union(box(11,10,1.5,24,1.6,3.0))
    # Small adjustable tie bridges for the trunk ends, raised above a closed floor.
    for x in (7,41):
        a=box(x-2,8,1.5,4,6,3.5).cut(box(x-1.4,7.9,2.2,2.8,6.2,1.2))
        s=s.union(a)
    return s.clean()

def tap_lid():
    s=rounded(48,22,1.8,2)
    for x in (5,43):
        s=s.cut(cylinder(x,5,-0.1,CLEARANCE/2,2))
    return s.clean()

def coupon():
    s=rounded(72,28,2.4,2)
    for x,d in [(8,3.6),(18,3.8),(29,4.0),(42,6.2),(54,6.4)]:
        s=s.cut(cylinder(x,14,-.1,d/2,3))
    for y,d in [(7,2.5),(21,2.6)]:
        s=s.union(cylinder(65,y,2.3,2.5,7.1)).cut(cylinder(65,y,2.4,d/2,7.2))
    return s.clean()
def normalize(shape):
    bb=shape.val().BoundingBox()
    return shape.translate((-bb.xmin,-bb.ymin,-bb.zmin))
parts={'controller-base':main_base(),'controller-lid':normalize(main_lid().rotate((0,0,0),(1,0,0),180)),
       'battery-guard':normalize(battery_guard()),'pcb-rail':pcb_rail(),'tap-base':tap_base(),'tap-lid':tap_lid(),'fit-coupon':coupon()}
references={
 'battery_AKY0627_published':box(20,50,4.4,68,55,6.7),
 'charger_reserved_34x22x12':box(36,19,15,34,22,12),
 'USB_plug_reserved_24x14x12':box(12,23,17,24,14,12),
 'boost_reserved_38x26x12':box(122,19,15,38,26,12),
 'battery_fuse_reserved_60x18x18':box(110,51,6,60,18,18),
 'output_fuse_reserved_60x18x18':box(110,77,6,60,18,18),
 'switch_wiring_reserved_20x20x24':box(86,20,H-24,20,20,24),
}
base=parts['controller-base']; lid=main_lid().translate((0,0,H)); guard=battery_guard().translate((0,0,15))
rails=[pcb_rail().translate((x,y,9)) for x,y in RAILS]
report={'revision':2,'assembled_controller_mm':[L,W,H+LID],
 'assumptions':['Battery dimensions published by Akyga','Other envelopes are conservative reservations, not measured models','Fuse holder exterior and charger board dimensions are not published by these stores','Physical fit, strain relief, lamp attachment and thermal/electrical operation untested']}
for name,part in parts.items():
    print('Exporting',name,flush=True)
    assert part.val().isValid() and len(part.solids().vals())==1,name+' BREP/solid failure'
    cq.exporters.export(part,str(OUT/(name+'.stl')),tolerance=.08,angularTolerance=.12)
    cq.exporters.export(part,str(OUT/(name+'.step')))
    mesh=trimesh.load_mesh(OUT/(name+'.stl'))
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0,name+' mesh failure'
    report[name]={'dimensions_mm':mesh.extents.round(3).tolist(),'volume_mm3':round(mesh.volume,1),'watertight':True,'connected_solids':1}
checks={}
def collision(a,b,name):
    v=a.intersect(b).val().Volume()
    assert v<1e-5,(name,v)
    checks[name]=round(v,6)
collision(base,lid,'base_lid'); collision(base,guard,'base_guard'); collision(lid,guard,'lid_guard')
for name,env in references.items():
    print('Checking',name,flush=True)
    collision(base,env,'base_'+name);collision(guard,env,'guard_'+name)
    if not name.startswith('switch'):collision(lid,env,'lid_'+name)
for n,r in enumerate(rails):
    collision(base,r,f'base_rail_{n}');collision(lid,r,f'lid_rail_{n}');collision(guard,r,f'guard_rail_{n}')
    for name,env in references.items():collision(r,env,f'rail_{n}_'+name)
    for j,other in enumerate(rails[:n]):collision(r,other,f'rail_{n}_{j}')
refs=list(references.items())
for n,(a,env) in enumerate(refs):
    for b,other in refs[n+1:]: collision(env,other,a+'__'+b)
report['intersection_mm3']=checks
report['battery_guard_vertical_clearance_mm']=3.9
report['status']='CAD/mesh checked; no physical or electrical validation claimed'
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
assy=cq.Assembly()
for name,p in [('base',base),('lid',lid),('guard',guard)]: assy.add(p,name=name,color=cq.Color(.2,.22,.25))
for n,r in enumerate(rails): assy.add(r,name=f'printed_rail_{n}',color=cq.Color(.25,.3,.35))
for name,p in references.items(): assy.add(p,name='REFERENCE_'+name,color=cq.Color(.1,.6,.35,.5))
assy.save(str(ROOT/'assembly-reference.step'))
subprocess.run([sys.executable,str(ROOT/'render.py')],check=True)
print(json.dumps(report,indent=2))
