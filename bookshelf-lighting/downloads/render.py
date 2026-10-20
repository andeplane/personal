"""Depth-correct CAD preview. Does not alter printable solids."""
from pathlib import Path
import vtk
ROOT=Path(__file__).parent
from vtk.util.numpy_support import numpy_to_vtk
import numpy as np

window=vtk.vtkRenderWindow();window.SetSize(1800,1100);window.SetOffScreenRendering(1)
window.SetMultiSamples(8)

def actor(path,pos=(0,0,0),color=(.18,.20,.23)):
    reader=vtk.vtkSTLReader();reader.SetFileName(str(path));reader.Update()
    normals=vtk.vtkPolyDataNormals();normals.SetInputConnection(reader.GetOutputPort());normals.SetFeatureAngle(35)
    mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(normals.GetOutputPort())
    a=vtk.vtkActor();a.SetMapper(mapper);a.SetPosition(*pos)
    a.GetProperty().SetColor(*color);a.GetProperty().SetInterpolationToPhong()
    a.GetProperty().SetAmbient(.30);a.GetProperty().SetDiffuse(.70)
    return a

def label(renderer,text,x,y,size=22):
    a=vtk.vtkTextActor();a.SetInput(text);a.SetDisplayPosition(x+int(renderer.GetViewport()[0]*1800),y)
    a.GetTextProperty().SetFontSize(size);a.GetTextProperty().SetColor(.13,.15,.17)
    renderer.AddActor2D(a)

for i,prefix in enumerate(['controller','tap']):
    renderer=vtk.vtkRenderer();renderer.SetViewport(i*.5,0,(i+1)*.5,1)
    renderer.SetBackground(.965,.961,.945);window.AddRenderer(renderer)
    renderer.AddActor(actor(ROOT/'print-files'/f'{prefix}-base.stl'))
    # Lid exports are already flat side down, so display separately in print orientation.
    renderer.AddActor(actor(ROOT/'print-files'/f'{prefix}-lid.stl',pos=(0,76 if i==0 else 32,0),color=(.34,.37,.42)))
    if i==0:
        board=vtk.vtkCubeSource();board.SetBounds(61.5,78.5,23.3,34.7,5.7,8.7)
        mapper=vtk.vtkPolyDataMapper();mapper.SetInputConnection(board.GetOutputPort())
        a=vtk.vtkActor();a.SetMapper(mapper);a.GetProperty().SetColor(.13,.50,.33);renderer.AddActor(a)
        camera=renderer.GetActiveCamera();camera.SetPosition(135,-145,255);camera.SetFocalPoint(55,62,5)
        camera.SetViewUp(0,0,1);camera.ParallelProjectionOn();camera.SetParallelScale(115)
        title='CONTROL BOX\n110 x 58 x 38.4 mm assembled'
        subtitle='USB cable in    /    one paired cable out\nSwitch in lid; regulator on raised supports'
    else:
        camera=renderer.GetActiveCamera();camera.SetPosition(90,-110,175);camera.SetFocalPoint(24,24,3)
        camera.SetViewUp(0,0,1);camera.ParallelProjectionOn();camera.SetParallelScale(58)
        title='COVERED T-JUNCTION\n48 x 22 x 11.8 mm assembled'
        subtitle='Trunk enters and continues through opposite ends\nShort lamp branch leaves the side slot'
    label(renderer,title,45,975,26);label(renderer,subtitle,45,150,19)
    label(renderer,'PROTOTYPE v1 | Fit and electrical tests pending',45,70,16)
    renderer.ResetCameraClippingRange()
window.Render()
capture=vtk.vtkWindowToImageFilter();capture.SetInput(window);capture.Update()
writer=vtk.vtkPNGWriter();writer.SetFileName(str(ROOT/'design-preview.png'));writer.SetInputConnection(capture.GetOutputPort());writer.Write()
window.Finalize()
print('Rendered design-preview.png')
