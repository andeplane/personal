#!/usr/bin/env python3
"""Build the small native M4 control app without embedding credentials."""
from pathlib import Path
import plistlib
import subprocess

root=Path(__file__).resolve().parent
app=Path.home()/'Applications/Hue Halloween.app'
contents=app/'Contents';(contents/'MacOS').mkdir(parents=True,exist_ok=True)
info={'CFBundleName':'Hue Halloween','CFBundleDisplayName':'Hue Halloween','CFBundleIdentifier':'com.andeplane.hue-halloween-control',
      'CFBundleExecutable':'HueHalloween','CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0','LSMinimumSystemVersion':'14.0','NSHighResolutionCapable':True}
(contents/'Info.plist').write_bytes(plistlib.dumps(info))
subprocess.run(['/usr/bin/xcrun','swiftc','-swift-version','5','-parse-as-library',str(root/'HueHalloween.swift'),'-framework','SwiftUI','-framework','AppKit','-o',str(contents/'MacOS/HueHalloween')],check=True)
subprocess.run(['/usr/bin/codesign','--force','--sign','-',str(app)],check=True)
print(app)
