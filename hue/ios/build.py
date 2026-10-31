#!/usr/bin/env python3
"""Build a signed iPhone app; pairing and signing details stay outside Git.

Does not install or launch the app. Requires Xcode and an Apple Development
identity already available in the user's keychain.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def signing_identity():
    listing=subprocess.check_output(['security','find-identity','-v','-p','codesigning'],text=True)
    identities=re.findall(r'\b([A-Fa-f0-9]{40})\s+"(Apple Development:[^\"]+)"',listing)
    identities.sort(key=lambda pair:('Anders' not in pair[1],pair[1]))
    if not identities:raise RuntimeError('No valid Apple Development signing identity is available')
    certs=subprocess.check_output(['security','find-certificate','-a','-p','-c','Apple Development'],text=True)
    by_hash={}
    for cert in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',certs,re.S):
        data=cert.encode()
        sha=subprocess.check_output(['openssl','x509','-noout','-fingerprint','-sha1'],input=data).decode().split('=',1)[1].strip().replace(':','')
        subject=subprocess.check_output(['openssl','x509','-noout','-subject','-nameopt','RFC2253'],input=data).decode()
        team=re.search(r'(?:^|,)OU=([A-Z0-9]{10})(?:,|$)',subject.replace('subject=',''))
        if team:by_hash[sha.upper()]=team[1]
    for sha,_ in identities:
        if sha.upper() in by_hash:return by_hash[sha.upper()],sha
    raise RuntimeError('Cannot determine the development team from the available signing certificate')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configuration',choices=('Debug','Release'),default='Debug')
    parser.add_argument('--client-config',type=Path,default=Path.home()/'.config/hue-mobile/client.json')
    parser.add_argument('--derived-data',type=Path,default=Path.home()/'.config/hue-mobile/build/DerivedData')
    parser.add_argument('--team',help='Override the team discovered from the signing certificate; never saved to the project')
    args=parser.parse_args()
    if not args.client_config.is_file():raise RuntimeError('Private client pairing configuration is missing')
    config=json.loads(args.client_config.read_text())
    if set(('base_url','token','certificate_sha256'))-config.keys():raise RuntimeError('Private pairing configuration is incomplete')
    team,identity=signing_identity()
    if args.team:team=args.team
    root=Path(__file__).resolve().parent
    args.derived_data.mkdir(parents=True,exist_ok=True)
    log=args.derived_data.parent/'xcodebuild.log'
    command=['xcodebuild','-project',str(root/'HueHalloweenMobile.xcodeproj'),'-scheme','HueHalloweenMobile',
             '-configuration',args.configuration,'-sdk','iphoneos','-destination','generic/platform=iOS',
             '-derivedDataPath',str(args.derived_data),'-allowProvisioningUpdates','-allowProvisioningDeviceRegistration',
             'DEVELOPMENT_TEAM='+team,'CODE_SIGN_IDENTITY=Apple Development','HUE_CLIENT_CONFIG_PATH='+str(args.client_config.resolve()),'build']
    with log.open('w') as output:
        result=subprocess.run(command,stdout=output,stderr=subprocess.STDOUT)
    if result.returncode:
        # Full signing/provisioning diagnostics remain private, outside Git.
        errors=[line.strip() for line in log.read_text().splitlines() if ' error:' in line]
        for line in errors[-8:]:print(line)
        print('Build failed; private log:',log)
        return result.returncode
    app=args.derived_data/'Build/Products'/(args.configuration+'-iphoneos')/'HueHalloweenMobile.app'
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    packaged=json.loads((app/'client.json').read_text())
    if packaged!=config:raise RuntimeError('Packaged private pairing differs from the supplied configuration')
    print(json.dumps({'app':str(app),'bundle_id':'com.andeplane.HueHalloweenMobile','private_pairing_verified':True,
                      'executable_sha256':hashlib.sha256((app/'HueHalloweenMobile').read_bytes()).hexdigest(),
                      'installed':False,'launched':False}))
    return 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except (RuntimeError,subprocess.CalledProcessError) as error:
        print(str(error),file=sys.stderr);raise SystemExit(1)
