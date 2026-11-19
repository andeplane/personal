#!/usr/bin/env python3
"""Build and install the explicitly requested microphone helper on the room Mac."""
from pathlib import Path
import plistlib
import subprocess


def main():
    app = Path.home()/'Applications/Hue Sound Check.app'
    contents = app/'Contents'
    (contents/'MacOS').mkdir(parents=True,exist_ok=True)
    info = {'CFBundleName':'Hue Sound Check','CFBundleDisplayName':'Hue Sound Check',
            'CFBundleIdentifier':'com.andeplane.hue-sound-check','CFBundleExecutable':'HueSoundCheck',
            'CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0','LSUIElement':True,
            'NSMicrophoneUsageDescription':'Measure the Sonos thunder timing you requested in this room. Recordings are short and stay private on this Mac.'}
    (contents/'Info.plist').write_bytes(plistlib.dumps(info))
    subprocess.run(['/usr/bin/swiftc',str(Path(__file__).with_name('SoundCheck.swift')),
        '-framework','AppKit','-framework','AVFoundation','-o',str(contents/'MacOS/HueSoundCheck')],check=True)
    subprocess.run(['/usr/bin/codesign','--force','--sign','-',str(app)],check=True)
    private = Path.home()/'.config/hue-calibration'
    private.mkdir(parents=True,exist_ok=True,mode=0o700)
    print('Installed Hue Sound Check. Microphone permission still requires macOS authorization.')


if __name__ == '__main__':
    main()
