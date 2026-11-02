#!/usr/bin/env python3
"""Send one bounded control command to the running Hue daemon over its private socket."""
import argparse
import json
from pathlib import Path
import socket
import sys


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('status','start','stop','flash','thunder','on','off','arm','volume','library','events','play'))
    parser.add_argument('value',nargs='?')
    args=parser.parse_args()
    command={'action':args.action}
    if args.action=='play':
        import re
        if not args.value or not re.fullmatch(r'(together|sequence):[a-z0-9-]+(,[a-z0-9-]+){0,3}', args.value):
            parser.error('play needs together:id,id or sequence:id,id, at most four sounds')
        mode, ids = args.value.split(':')
        command.update(mode=mode, ids=ids.split(','))
    elif args.action=='events':
        if args.value is not None:
            if not args.value.isdigit() or int(args.value) <= 0:parser.error('events needs a positive cursor')
            command['before'] = int(args.value)
    elif args.action=='arm':
        if args.value not in ('on','off'):parser.error('arm needs on or off')
        command['enabled']=args.value=='on'
    elif args.action=='volume':
        try:volume=int(args.value)
        except (TypeError,ValueError):parser.error('volume needs an integer 0–100')
        if not 0<=volume<=100:parser.error('volume needs an integer 0–100')
        command['value']=volume
    elif args.value is not None:parser.error('this command takes no value')
    path=Path.home()/'.config/hue-halloween/control.sock'
    try:
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
            client.settimeout(25)
            client.connect(str(path));client.sendall((json.dumps(command)+'\n').encode())
            result=client.makefile('rb').readline(65536)
            reply=json.loads(result)
    except (OSError,ValueError):
        print(json.dumps({'ok':False,'message':'Hue controller unavailable. Check the Mac mini service.'}))
        return 1
    print(json.dumps(reply))
    return 0 if reply.get('ok') else 1


if __name__=='__main__':raise SystemExit(main())
