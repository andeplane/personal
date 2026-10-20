"""Bookshelf lighting enclosure v1. Millimetres. Run with .venv/bin/python design.py.

Prototype: published component envelopes, not measured parts or a qualified lamp circuit.
Exports independent printable STL and editable STEP solids plus an assembly preview.
"""
from pathlib import Path
import json
import cadquery as cq
import trimesh
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

ROOT = Path(__file__).parent
OUT = ROOT / 'print-files'
OUT.mkdir(exist_ok=True)
L, W, H = 110.0, 58.0, 36.0
WALL, FLOOR, LID = 2.4, 2.4, 2.4
PILOT, CLEARANCE = 2.6, 3.4
SCREWS = [(6,6),(104,6),(6,52),(104,52)]

def box(x,y,z,dx,dy,dz):
    return cq.Workplane('XY').box(dx,dy,dz,centered=False).translate((x,y,z))

def cylinder(x,y,z,r,h):
    return cq.Workplane('XY').circle(r).extrude(h).translate((x,y,z))

def rounded(dx,dy,dz,r=3):
    return box(0,0,0,dx,dy,dz).edges('|Z').fillet(r)

def anchor(x,y):
    # 2.5 mm cable tie passes through the horizontal tunnel, under a solid bridge.
    a=box(x-5,y-5,FLOOR-0.1,10,10,4.1)
    return a.cut(box(x-1.5,y-5.1,FLOOR+0.8,3,10.2,1.5))

def main_base():
    s=rounded(L,W,H).cut(box(WALL,WALL,FLOOR,L-2*WALL,W-2*WALL,H))
    for x,y in SCREWS:
        s=s.union(cylinder(x,y,FLOOR-0.1,4.5,H-FLOOR+0.1))
        s=s.cut(cylinder(x,y,H-10,PILOT/2,10.2))
    # Cable ends are threaded through before soldering. Input left, bus right.
    for x,d,z in [(-1,5.5,8.4),(L-WALL-1,4.0,7.2)]:
        cutter=cq.Workplane('YZ').center(W/2,z).circle(d/2).extrude(WALL+2).translate((x,0,0))
        s=s.cut(cutter)
    for x in (12,98):
        s=s.union(anchor(x,W/2))
    # Broad regulator location, 26 x 22 mm; 17 x 11.4 mm board supported at edges.
    for yy in (22.0,34.0):
        s=s.union(box(59,yy,FLOOR-0.1,22,2,3.3))
    for xx in (55,85):
        s=s.union(anchor(xx,29))
    # Two tie slots for the insulated fuse/wire bundle, away from the switch.
    s=s.union(anchor(47,12))
    return s.clean()

def main_lid():
    s=rounded(L,W,LID)
    lip=box(3.1,3.1,-1.6,L-6.2,W-6.2,1.7).cut(box(4.5,4.5,-1.7,L-9,W-9,2))
    for x,y in SCREWS:
        lip=lip.cut(cylinder(x,y,-1.8,5.2,2.2))
    s=s.union(lip)
    for x,y in SCREWS:
        s=s.cut(cylinder(x,y,-2,CLEARANCE/2,5))
    # SparkFun COM-11138 / KCD1-105: 20 mm opening + anti-rotation notch.
    s=s.cut(cylinder(29,29,-2,10.1,5))
    s=s.cut(box(27.85,38.7,-2,2.3,1.5,5))
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
    s=rounded(72,26,2.4,2)
    for x,d in [(9,4.5),(20,5.0),(31,5.5),(46,20.2)]:
        s=s.cut(cylinder(x,13,-0.1,d/2,3))
    s=s.cut(box(44.85,22.7,-0.1,2.3,1.5,3))
    for x,d in [(61,2.5),(66,2.6)]:
        s=s.union(cylinder(x,7,2.3,2.2,7.1)).cut(cylinder(x,7,2.4,d/2,7.2))
    return s.clean()

def normalize(shape):
    bb=shape.val().BoundingBox()
    return shape.translate((-bb.xmin,-bb.ymin,-bb.zmin))

parts={'controller-base':main_base(),'controller-lid':normalize(main_lid().rotate((0,0,0),(1,0,0),180)),
       'tap-base':tap_base(),'tap-lid':tap_lid(),'fit-coupon':coupon()}
report={}
for name,part in parts.items():
    solid=part.val()
    assert solid.isValid(), name+' invalid BREP'
    assert len(part.solids().vals())==1, name+' must be one connected solid'
    cq.exporters.export(part,str(OUT/(name+'.stl')),tolerance=0.08,angularTolerance=0.12)
    cq.exporters.export(part,str(OUT/(name+'.step')))
    mesh=trimesh.load_mesh(OUT/(name+'.stl'))
    assert mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0, name+' mesh failure'
    report[name]={'dimensions_mm':mesh.extents.round(3).tolist(),'volume_mm3':round(mesh.volume,1),
                 'watertight':bool(mesh.is_watertight),'connected_solids':len(part.solids().vals())}

# Check the actual fitted lid against the base, rather than the print orientation.
assembled_lid=main_lid().translate((0,0,H))
assert main_base().intersect(assembled_lid).val().Volume()<1e-5
report['lid_base_intersection_mm3']=0
# Published maximum switch envelope below lid; includes terminal pins, not bent wires.
switch_env=cylinder(29,29,H-23.2,11.6,23.2)
assert main_base().intersect(switch_env).val().Volume()<1e-5
report['switch_base_intersection_mm3']=0
report['switch_floor_clearance_mm']=round(H-23.2-FLOOR,2)
references={
    'regulator':box(61.5,23.3,5.7,17,11.4,3),
    'input-capacitor':cylinder(54,14,6.5,4,7),
    'output-fuse-and-insulation':box(84,41,6.5,8,4,11),
}
for name,env in references.items():
    overlap=main_base().intersect(env).val().Volume()
    assert overlap<1e-5, name+' hits enclosure'
    assert env.intersect(switch_env).val().Volume()<1e-5, name+' hits switch'
report['component_base_and_switch_intersections_mm3']={name:0 for name in references}
report['status']='CAD and mesh checked; physical fit, lamp current and thermal test pending'
(ROOT/'validation.json').write_text(json.dumps(report,indent=2)+'\n')

# STEP assembly: printed parts with component envelopes, visibly separate from print exports.
assy=cq.Assembly()
assy.add(parts['controller-base'],name='printed-base',color=cq.Color(0.14,0.16,0.19))
assy.add(assembled_lid,name='printed-lid',color=cq.Color(0.22,0.24,0.27))
assy.add(switch_env,name='REFERENCE-switch-envelope',color=cq.Color(0.4,0.4,0.4,0.4))
assy.add(box(61.5,23.3,5.7,17,11.4,3),name='REFERENCE-regulator-envelope',color=cq.Color(0.0,0.45,0.23))
for name in ['input-capacitor','output-fuse-and-insulation']:
    assy.add(references[name],name='REFERENCE-'+name,color=cq.Color(0.6,0.4,0.2))
assy.save(str(ROOT/'assembly-reference.step'))

def addmesh(ax,shape,color,offset=(0,0,0),alpha=1):
    vs,fs=shape.val().tessellate(0.3)
    v=np.array([[p.x,p.y,p.z] for p in vs])+np.array(offset)
    from matplotlib.colors import to_rgb
    faces=v[np.array(fs)]
    normals=np.cross(faces[:,1]-faces[:,0],faces[:,2]-faces[:,0])
    normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
    light=np.array([-.3,-.5,1]);light/=np.linalg.norm(light)
    shade=.58+.42*np.maximum(normals@light,0)
    colors=np.clip(np.array(to_rgb(color))*shade[:,None],0,1)
    poly=Poly3DCollection(faces,facecolor=colors,edgecolor='none',alpha=alpha)
    ax.add_collection3d(poly)

fig=plt.figure(figsize=(14,8),facecolor='#f5f4f0')
ax=fig.add_subplot(121,projection='3d',facecolor='#f5f4f0')
addmesh(ax,parts['controller-base'],'#444b55')
addmesh(ax,main_lid(),'#727984',offset=(0,76,4))
# Translucent reference envelope, not a printable switch or regulator.
addmesh(ax,switch_env,'#d2a058',alpha=.28)
addmesh(ax,box(61.5,23.3,5.7,17,11.4,3),'#3b9470')
ax.plot([-22,12,25],[29,29,29],[8.4,8.4,8.4],color='#222222',lw=4)
ax.plot([85,110,135],[29,29,29],[7.2,7.2,7.2],color='#222222',lw=3)
ax.set(xlim=(-25,140),ylim=(-10,140),zlim=(0,50))
ax.set_box_aspect((165,150,50));ax.view_init(64,-70);ax.set_axis_off()
ax.set_title('Control box · lid removed\n110 × 58 × 38.4 mm assembled',loc='left',fontsize=14,pad=16)
ax.text2D(.04,.03,'USB in ←   switch / regulator   → paired cable out',transform=ax.transAxes,fontsize=10)
ax2=fig.add_subplot(122,projection='3d',facecolor='#f5f4f0')
addmesh(ax2,parts['tap-base'],'#444b55')
addmesh(ax2,parts['tap-lid'],'#727984',offset=(0,30,2))
for yy in (10.2,11.8):
    ax2.plot([-15,7,15,33,41,63],[yy]*6,[6.5]*6,color='#222222',lw=2)
ax2.plot([24,24,24],[11,22,40],[6.5]*3,color='#222222',lw=3)
ax2.set(xlim=(-18,66),ylim=(-10,57),zlim=(0,18))
ax2.set_box_aspect((84,67,18));ax2.view_init(65,-70);ax2.set_axis_off()
ax2.set_title('T-junction · lid removed\n48 × 22 × 11.8 mm assembled',loc='left',fontsize=14,pad=16)
ax2.text2D(.04,.03,'Bus continues left → right; short branch to lamp',transform=ax2.transAxes,fontsize=10)
fig.text(.06,.08,'PROTOTYPE v1  ·  Printed geometry shown; electronics are reference envelopes.\nPower bank stays outside. Each lamp has its own current-limiting branch.',fontsize=11,color='#444444')
fig.subplots_adjust(left=.02,right=.98,bottom=.16,top=.90,wspace=.08)
fig.savefig(ROOT/'design-preview.png',dpi=160)
print(json.dumps(report,indent=2))
