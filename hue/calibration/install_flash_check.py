from pathlib import Path
import subprocess,plistlib,sys
root=Path(__file__).resolve().parent
app=Path.home()/'Applications/Hue Camera Check.app';contents=app/'Contents'
if (contents/'MacOS/HueCameraCheck').exists() and '--rebuild' not in sys.argv:
    print(str(app)+' (reusing installed helper and privacy permissions)')
    raise SystemExit(0)
(contents/'MacOS').mkdir(parents=True,exist_ok=True)
info={'CFBundleName':'Hue Camera Check','CFBundleIdentifier':'com.andeplane.hue-camera-check','CFBundleExecutable':'HueCameraCheck','CFBundlePackageType':'APPL','LSMinimumSystemVersion':'14.0','NSCameraUsageDescription':'Record the Hue lightning test you requested. The 60-second video stays private on this Mac.','NSMicrophoneUsageDescription':'Record the Sonos thunder test you requested. Audio stays private on this Mac.'}
(contents/'Info.plist').write_bytes(plistlib.dumps(info))
subprocess.run(['xcrun','swiftc','-swift-version','5',str(root/'FlashCheck.swift'),'-framework','AppKit','-framework','AVFoundation','-o',str(contents/'MacOS/HueCameraCheck')],check=True)
subprocess.run(['codesign','--force','--sign','-',str(app)],check=True)
print(app)
