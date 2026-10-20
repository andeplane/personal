"""Depth-correct v2 CAD preview, rendered from exported printable STL files.
Reference blocks are clearance reservations, not photorealistic electronic models.
"""
from pathlib import Path
import vtk
ROOT=Path(__file__).parent
WIDTH,HEIGHT=1800,1100
window=vtk.vtkRenderWindow();window.SetSize(WIDTH,HEIGHT);window.SetOffScreenRendering(1);window.SetMultiSamples(8)
def actor(path,pos=(0,0,0),color=(.26,.30,.34)):
 r=vtk.vtkSTLReader();r.SetFileName(str(path));r.Update()
 n=vtk.vtkPolyDataNormals();n.SetInputConnection(r.GetOutputPort());n.SetFeatureAngle(35)
 m=vtk.vtkPolyDataMapper();m.SetInputConnection(n.GetOutputPort())
 a=vtk.vtkActor();a.SetMapper(m);a.SetPosition(*pos);a.GetProperty().SetColor(*color);a.GetProperty().SetInterpolationToPhong();a.GetProperty().SetAmbient(.4);a.GetProperty().SetDiffuse(.6)
 return a
def cube(renderer,bounds,color):
 s=vtk.vtkCubeSource();s.SetBounds(*bounds);m=vtk.vtkPolyDataMapper();m.SetInputConnection(s.GetOutputPort());a=vtk.vtkActor();a.SetMapper(m);a.GetProperty().SetColor(*color);renderer.AddActor(a)
def label(r,text,x,y,size=22):
 a=vtk.vtkTextActor();a.SetInput(text);a.SetDisplayPosition(x+int(r.GetViewport()[0]*WIDTH),y);a.GetTextProperty().SetFontSize(size);a.GetTextProperty().SetColor(.12,.20,.18);r.AddActor2D(a)
r=vtk.vtkRenderer();r.SetViewport(0,0,.70,1);r.SetBackground(.965,.961,.945);window.AddRenderer(r)
for name,pos in [('controller-base',(0,0,0)),('controller-lid',(0,140,0)),('battery-guard',(205,60,0))]:r.AddActor(actor(ROOT/'print-files'/f'{name}.stl',pos,color=(.29,.33,.37) if name=='controller-base' else (.49,.53,.55)))
for xx,yy in [(30,14),(30,33),(119,14),(119,36)]:r.AddActor(actor(ROOT/'print-files'/'pcb-rail.stl',(xx,yy,9),(.55,.58,.60)))
cube(r,(20,88,50,105,4.4,11.1),(.82,.64,.30))
for bounds in [(36,70,19,41,15,27),(122,160,19,45,15,27)]:cube(r,bounds,(.17,.53,.38))
for bounds in [(110,170,51,69,6,24),(110,170,77,95,6,24)]:cube(r,bounds,(.37,.52,.65))
cube(r,(86,106,20,40,8,32),(.68,.56,.38))
c=r.GetActiveCamera();c.SetPosition(190,-100,700);c.SetFocalPoint(120,117,0);c.SetViewUp(0,0,1);c.ParallelProjectionOn();c.SetParallelScale(205);r.ResetCameraClippingRange()
label(r,'CONTROLLER v2\n180 x 112 x 34.4 mm assembled',35,982,28)
label(r,'Gold: battery   |   Green: boards   |   Blue: fuse-holder reservations\nLid and battery guard shown separately. USB left / paired cable right.',35,145,20)
label(r,'Actual print geometry. Component blocks are NOT exact hardware models.\nPhysical fit, lamp contacts and thermal/electrical commissioning remain.',35,65,17)
r=vtk.vtkRenderer();r.SetViewport(.70,0,1,1);r.SetBackground(.965,.961,.945);window.AddRenderer(r)
r.AddActor(actor(ROOT/'print-files'/'tap-base.stl'));r.AddActor(actor(ROOT/'print-files'/'tap-lid.stl',(0,32,0),(.49,.53,.55)))
c=r.GetActiveCamera();c.SetPosition(55,-60,220);c.SetFocalPoint(24,25,0);c.SetViewUp(0,0,1);c.ParallelProjectionOn();c.SetParallelScale(78);r.ResetCameraClippingRange()
label(r,'T-JUNCTION\n48 x 22 x 11.8 mm',22,982,25)
label(r,'Print 5 bases + 5 lids\nOne resistor in each branch',22,145,19)
label(r,'One black trunk, five short branches',22,70,16)
window.Render();capture=vtk.vtkWindowToImageFilter();capture.SetInput(window);capture.Update();writer=vtk.vtkPNGWriter();writer.SetFileName(str(ROOT/'design-preview.png'));writer.SetInputConnection(capture.GetOutputPort());writer.Write();window.Finalize();print('Rendered v2 preview')
