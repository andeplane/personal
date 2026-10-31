#!/usr/bin/env python3
"""Single-owner supervisor for the always-on home-LAN Hue controller."""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def main():
    os.umask(0o077)
    root = Path.home()/'.config/hue-halloween'
    with (root/'supervisor.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Hue controller already supervised.') from None
        child = None
        stopping = False
        def stop(*_):
            nonlocal stopping
            stopping = True
            if child is not None and child.poll() is None:
                child.terminate()
        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        (root/'supervisor.pid').write_text(str(os.getpid()))
        try:
            while not stopping:
                with (root/'lightning.log').open('ab', buffering=0) as out, (root/'lightning-error.log').open('ab', buffering=0) as err:
                    child = subprocess.Popen([sys.executable, '-u', str(Path(__file__).with_name('lightning.py')),
                                              'listen', '--keep-awake'], stdout=out, stderr=err)
                    code = child.wait()
                print('Controller exit code: '+str(code), flush=True)
                if not stopping:
                    for _ in range(10):
                        if stopping:break
                        time.sleep(1)
        finally:
            (root/'supervisor.pid').unlink(missing_ok=True)


if __name__ == '__main__':
    main()
