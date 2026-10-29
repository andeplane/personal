#!/usr/bin/env python3
"""Motion-triggered Hue Entertainment lightning; private setup lives outside Git."""
import argparse
import asyncio
import contextlib
import fcntl
import hashlib
import json
from pathlib import Path
import signal
import socket
import ssl
import time

import aiohttp
from hue_entertainment import HueDtlsStreamer, LightColorCommand
from hue import Bridge, HueError, save_config

PRIVATE = Path.home() / '.config/hue-halloween'
AREA_NAME = 'Window lightning (Codex)'
# Three irregular strikes across four seconds; frames are streamed at 50 Hz.
STRIKES = ((0.15, 0.27, 1.0), (1.25, 1.40, 0.7), (2.80, 3.03, 1.0))


def intensity(elapsed):
    for start, end, peak in STRIKES:
        if start <= elapsed < end:
            return peak * (1 - 0.6 * (elapsed-start)/(end-start))
    return 0.0


class MotionGate:
    def __init__(self, cooldown=30):
        self.present = None
        self.ready_at = 0
        self.cooldown = cooldown

    def update(self, present, now):
        rising = self.present is False and present is True
        self.present = present
        if rising and now >= self.ready_at:
            self.ready_at = now + 4 + self.cooldown
            return True
        return False


def fingerprint(host):
    # Pin the local Bridge certificate on initial setup, then require that pin.
    cert = ssl.get_server_certificate((host, 443))
    return hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert)).hexdigest()


class Controller:
    def __init__(self, credentials, settings):
        self.credentials, self.settings = credentials, settings
        self.host = credentials['host']
        self.bridge = Bridge(self.host, credentials['username'])
        self.http = None
        self.streamer = HueDtlsStreamer()
        self.busy = False

    async def request(self, method, path, body=None):
        async with self.http.request(method, 'https://' + self.host + path,
                                     json=body) as response:
            response.raise_for_status()
            result = await response.json()
        if result.get('errors'):
            raise HueError('Bridge rejected Entertainment request.')
        return result['data']

    async def open(self):
        pin = aiohttp.Fingerprint(bytes.fromhex(self.settings['certificate_sha256']))
        self.http = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(ssl=pin),
            headers={'hue-application-key': self.credentials['username']},
            timeout=aiohttp.ClientTimeout(total=10))

    async def dark(self):
        for identifier in self.settings['lights']:
            await asyncio.to_thread(self.bridge.request, 'PUT', f'/lights/{identifier}/state',
                                    {'on': False, 'transitiontime': 0})

    async def effect(self):
        self.busy = True
        area = self.settings['area']
        started = False
        try:
            group = await asyncio.to_thread(self.bridge.request, 'GET', '/groups/' + self.settings['group'])
            if set(group['lights']) != set(self.settings['lights']):
                raise HueError('Entertainment membership changed; run setup again.')
            configs = await self.request('GET', '/clip/v2/resource/entertainment_configuration')
            if any(c['status'] == 'active' for c in configs):
                print('Skipped: another Entertainment stream is active.', flush=True)
                return
            current = next(c for c in configs if c['id'] == area)
            if {c['channel_id'] for c in current['channels']} != set(self.settings['channels']):
                raise HueError('Entertainment membership changed; run setup again.')
            await self.request('PUT', '/clip/v2/resource/entertainment_configuration/' + area,
                               {'action': 'start'})
            started = True
            await asyncio.to_thread(self.streamer.connect, self.host,
                                    self.credentials['username'], self.credentials['clientkey'], area)
            print('Lightning started.', flush=True)
            start = time.monotonic()
            while (elapsed := time.monotonic() - start) < 4:
                value = int(65535 * intensity(elapsed))
                self.streamer.send_colors([LightColorCommand(channel_id=i, red=value,
                                                            green=value, blue=value)
                                           for i in self.settings['channels']])
                await asyncio.sleep(0.02)
        finally:
            try:
                await asyncio.to_thread(self.streamer.disconnect)
                if started:
                    try:
                        await self.request('PUT', '/clip/v2/resource/entertainment_configuration/' + area,
                                           {'action': 'stop'})
                    finally:
                        await self.dark()
                    print('Lightning finished; lights off.', flush=True)
            finally:
                self.busy = False

    async def trigger(self):
        try:
            await self.effect()
        except Exception:
            print('Lightning failed; cleanup attempted. Waiting for fresh motion.', flush=True)

    async def listen(self):
        gate = MotionGate()
        task = None
        try:
            while True:
                try:
                    initial = (await self.request('GET', '/clip/v2/resource/motion/' + self.settings['motion']))[0]
                    gate.present = initial['motion']['motion']
                    print('Listening for fresh motion; 30-second cooldown.', flush=True)
                    timeout = aiohttp.ClientTimeout(total=None, sock_read=120)
                    async with self.http.get('https://' + self.host + '/eventstream/clip/v2',
                                             headers={'Accept': 'text/event-stream'}, timeout=timeout) as response:
                        response.raise_for_status()
                        lines = []
                        async for raw in response.content:
                            line = raw.decode().rstrip('\r\n')
                            if line.startswith('data:'):
                                lines.append(line[5:].strip())
                            elif not line and lines:
                                events = json.loads('\n'.join(lines))
                                lines = []
                                for event in events:
                                    if event.get('type') != 'update':
                                        continue
                                    for resource in event.get('data', []):
                                        if resource.get('id') != self.settings['motion']:
                                            continue
                                        present = resource.get('motion', {}).get('motion')
                                        if isinstance(present, bool) and gate.update(present, time.monotonic()):
                                            if not self.busy:
                                                if task:
                                                    await task
                                                task = asyncio.create_task(self.trigger())
                except (aiohttp.ClientError, TimeoutError, OSError, ValueError, HueError):
                    print('Connection interrupted; retrying in five seconds.', flush=True)
                    await asyncio.sleep(5)
        finally:
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task


async def setup(credentials, args):
    bridge = Bridge(credentials['host'], credentials['username'])
    groups = bridge.request('GET', '/groups')
    lights = bridge.request('GET', '/lights')
    ids = groups[args.room]['lights']
    if not ids or any(not lights[i]['state']['reachable'] or
                      not lights[i].get('capabilities', {}).get('streaming', {}).get('renderer') for i in ids):
        raise HueError('Every room bulb must be reachable and support Entertainment.')
    matches = [(i, g) for i, g in groups.items() if g['name'] == AREA_NAME]
    if matches:
        if len(matches) != 1 or set(matches[0][1]['lights']) != set(ids):
            raise HueError('Existing lightning area has different membership.')
        group_id = matches[0][0]
    else:
        result = bridge.request('POST', '/groups', {'name': AREA_NAME, 'type': 'Entertainment',
                                'class': 'TV', 'lights': ids,
                                'locations': {i: [(-0.5 if n % 2 == 0 else 0.5), 0, 0] for n, i in enumerate(ids)}})
        group_id = str(result[0]['success']['id'])
    settings = {'lights': ids, 'certificate_sha256': fingerprint(credentials['host'])}
    controller = Controller(credentials, settings)
    await controller.open()
    try:
        configs = await controller.request('GET', '/clip/v2/resource/entertainment_configuration')
        area = next(c for c in configs if c.get('id_v1') == '/groups/' + group_id)
        motions = await controller.request('GET', '/clip/v2/resource/motion')
        motion = next(m for m in motions if m.get('id_v1') == '/sensors/' + args.sensor)
        settings.update(group=group_id, area=area['id'], channels=[c['channel_id'] for c in area['channels']], motion=motion['id'])
        save_config(PRIVATE / 'lightning.json', settings)
        print('Saved lightning area for ' + groups[args.room]['name'] + ': ' + ', '.join(lights[i]['name'] for i in ids))
    finally:
        await controller.http.close()


async def run(args):
    if args.command == 'pair':
        path = PRIVATE / 'entertainment.json'
        if path.exists():
            raise HueError('Streaming credential already exists.')
        base = json.loads((PRIVATE / 'bridge.json').read_text())
        public = Bridge(base['host'], base['username']).request('GET', '/config')
        bridge = Bridge(base['host'])
        print('Waiting up to two minutes for the Bridge button.', flush=True)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                result = bridge.request('POST', body={'devicetype': 'codex#lightning', 'generateclientkey': True})[0]['success']
                save_config(path, {'host': base['host'], 'username': result['username'],
                                  'clientkey': result['clientkey'],
                                  'hostname': public['mac'].replace(':', '') + '.local.'})
                print('Streaming authorization saved privately.', flush=True)
                return
            except HueError as exc:
                if 'link button' not in str(exc):
                    raise
                await asyncio.sleep(2)
        raise HueError('Bridge button authorization timed out.')
    credentials = json.loads((PRIVATE / 'entertainment.json').read_text())
    # Resolve the Bridge's mDNS name afresh, surviving DHCP address changes.
    if credentials.get('hostname'):
        credentials['host'] = socket.gethostbyname(credentials['hostname'])
    if args.command == 'setup':
        await setup(credentials, args)
        return
    settings = json.loads((PRIVATE / 'lightning.json').read_text())
    with (PRIVATE / 'lightning.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise HueError('Lightning controller already running.') from None
        controller = Controller(credentials, settings)
        await controller.open()
        try:
            if args.command == 'test':
                await controller.effect()
            else:
                await controller.dark()
                await controller.listen()
        finally:
            await controller.http.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('pair')
    setup_parser = sub.add_parser('setup')
    setup_parser.add_argument('--room', required=True)
    setup_parser.add_argument('--sensor', required=True)
    sub.add_parser('test')
    sub.add_parser('listen')
    args = parser.parse_args()
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass
    except Exception:
        # Transport exception strings can contain private hostnames or keys.
        print('Controller stopped: check connectivity, private setup and Bridge authorization.', flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
