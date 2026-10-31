#!/usr/bin/env python3
"""Motion-triggered Hue Entertainment lightning; private setup lives outside Git."""
import argparse
import asyncio
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
import random
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import time
import wave

import aiohttp
from hue_entertainment import HueDtlsStreamer, LightColorCommand
from hue import Bridge, HueError, save_config

PRIVATE = Path.home() / '.config/hue-halloween'
AREA_NAME = 'Window lightning (Codex)'
# Three irregular strikes across four seconds; frames are streamed at 50 Hz.
STRIKES = ((0.15, 0.27, 1.0), (1.25, 1.40, 0.7), (2.80, 3.03, 1.0))
STEADY = (23000, 17000, 11000)
ANCHOR = (46000, 34000, 22000)
CLOCK = time.monotonic


def intensity(elapsed, strikes=STRIKES):
    for start, end, peak in strikes:
        if start <= elapsed < end:
            return peak * (1 - 0.6 * (elapsed-start)/(end-start))
    return 0.0


def sequence(rng=None):
    rng = rng or random.SystemRandom()
    plan = [('normal', 2), ('dark', 0.5), ('lightning', 4)]
    remaining = 120.0
    while remaining > 0:
        wait = min(rng.uniform(20, 40), remaining)
        plan.append(('steady', wait))
        remaining -= wait
        if remaining >= 4:
            plan.append(('lightning', 4))
            remaining -= 4
        elif remaining:
            plan.append(('steady', remaining))
            remaining = 0
    return plan


def lightning_patterns(plan, channels, rng=None):
    rng = rng or random.SystemRandom()
    patterns = {}
    for index, (mode, _) in enumerate(plan):
        if mode != 'lightning':
            continue
        start = rng.uniform(0.12, 0.3)
        shared = (start, start + rng.uniform(0.1, 0.2), rng.uniform(0.75, 1))
        patterns[index] = {}
        for channel in channels:
            strikes = [shared]
            for low, high in ((1.0, 1.6), (2.0, 2.6), (3.1, 3.6)):
                start = rng.uniform(low, high)
                strikes.append((start, start + rng.uniform(0.08, 0.22), rng.uniform(0.45, 1)))
            patterns[index][channel] = strikes
    return patterns


def load_soundtracks(path):
    path = Path(path).resolve()
    catalog = json.loads(path.read_text())
    if not isinstance(catalog, list) or not 1 <= len(catalog) <= 20:
        raise HueError('Invalid thunder catalog.')
    result = []
    for item in catalog:
        audio = (path.parent / item['file']).resolve()
        if audio.parent != path.parent or audio.suffix != '.wav':
            raise HueError('Thunder audio must be a WAV beside its catalog.')
        if hashlib.sha256(audio.read_bytes()).hexdigest() != item['sha256']:
            raise HueError('Thunder audio checksum changed.')
        with wave.open(str(audio), 'rb') as reader:
            if (reader.getnchannels(), reader.getsampwidth(), reader.getframerate(), reader.getnframes()) != (1, 2, 24000, 96000):
                raise HueError('Thunder WAV format or duration changed.')
        if item['duration'] != 4 or not 1 <= len(item['strikes']) <= 5:
            raise HueError('Thunder cues must fit a four-second burst.')
        for start, end, peak in item['strikes']:
            if not 0 <= start < end <= 4 or not 0 < peak <= 1:
                raise HueError('Invalid thunder cue.')
        result.append({**item, 'audio_file': str(audio)})
    return result


def recorded_patterns(plan, channels, catalog, rng=None):
    rng = rng or random.SystemRandom()
    patterns, tracks = {}, {}
    for index, (mode, _) in enumerate(plan):
        if mode != 'lightning':
            continue
        track = rng.choice(catalog)
        tracks[index] = track['audio_file']
        patterns[index] = {}
        for channel in channels:
            offset, gain = rng.uniform(-0.025, 0.025), rng.uniform(0.75, 1)
            patterns[index][channel] = [(max(0, start+offset), min(4, end+offset), peak*gain)
                                        for start, end, peak in track['strikes']]
    return patterns, tracks


def color_at(elapsed, plan, patterns=None, channel=None):
    for index, (mode, duration) in enumerate(plan):
        if elapsed < duration:
            if mode in ('normal', 'steady'):
                return STEADY
            if mode == 'dark':
                return (0, 0, 0)
            strikes = STRIKES if patterns is None else patterns[index][channel]
            value = int(65535 * intensity(elapsed, strikes))
            return (value, value, value)
        elapsed -= duration
    return None


def frame_at(elapsed, plan, patterns, channels):
    phase = phase_at(elapsed, plan)
    if phase is None:
        return None
    index, mode = phase
    if mode == 'normal':
        return {channel: STEADY for channel in channels}
    if mode == 'dark':
        return {channel: (0, 0, 0) for channel in channels}
    if mode == 'steady':
        return {channel: ANCHOR if n == 0 else (0, 0, 0)
                for n, channel in enumerate(channels)}
    return {channel: ANCHOR if n == 0 and index > 2 else color_at(elapsed, plan, patterns, channel)
            for n, channel in enumerate(channels)}


def phase_at(elapsed, plan):
    for index, (mode, duration) in enumerate(plan):
        if elapsed < duration:
            return index, mode
        elapsed -= duration
    return None


def log(message):
    print(datetime.now().astimezone().isoformat(timespec='seconds') + ' ' + message, flush=True)


def motion_sample(resource, event_timestamp=None):
    motion = resource.get('motion', {})
    if motion.get('motion_valid') is False:
        return None
    report = motion.get('motion_report', {})
    value = report.get('motion', motion.get('motion'))
    if not isinstance(value, bool):
        return None
    changed = report.get('changed') or event_timestamp
    stamp = None
    if changed:
        try:
            dt = datetime.fromisoformat(changed.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            stamp = dt.timestamp()
        except ValueError:
            pass
    return value, stamp


class StreamDisconnected(HueError):
    pass


class MotionGate:
    def __init__(self, cooldown=0):
        self.present = None
        self.ready_at = 0
        self.cooldown = cooldown
        self.last_report = None

    def update(self, present, now, report=None):
        if report is not None and self.last_report is not None and report <= self.last_report:
            return False
        fresh_report = report is not None
        if fresh_report:
            self.last_report = report
        rising = self.present is False and present is True
        detected = self.present is not None and present and fresh_report
        self.present = present
        if (rising or detected) and now >= self.ready_at:
            self.ready_at = float('inf')
            return True
        return False

    def finish(self, now):
        self.ready_at = now + self.cooldown


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
        self.sonos = None
        self.health = {'state': 'starting'}

    def status(self, **values):
        self.health.update(values, updated_at=datetime.now(timezone.utc).isoformat())
        if self.settings.get('status_file'):
            path = Path(self.settings['status_file'])
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(self.health))
            temp.chmod(0o600)
            temp.replace(path)

    async def refresh_host(self):
        if self.credentials.get('hostname'):
            self.host = await asyncio.to_thread(socket.gethostbyname, self.credentials['hostname'])
            self.bridge = Bridge(self.host, self.credentials['username'])

    async def verify_stream(self):
        if not self.streamer.is_connected:
            self.status(stream_connected=False)
            raise StreamDisconnected('Entertainment sender disconnected.')
        areas = await self.request('GET', '/clip/v2/resource/entertainment_configuration/' + self.settings['area'])
        if not areas or areas[0].get('status') != 'active':
            self.status(stream_connected=False)
            raise StreamDisconnected('Bridge stopped the Entertainment stream.')
        self.status(stream_connected=True, stream_checked_at=datetime.now(timezone.utc).isoformat())

    async def watch_stream(self):
        while True:
            await self.verify_stream()
            await asyncio.sleep(2)

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
        if self.settings.get('audio_enabled') and self.settings.get('audio_backend') == 'sonos':
            from sonos_audio import SonosAudio
            self.sonos = SonosAudio(self.settings['sonos_config'])

    async def dark(self):
        for identifier in self.settings['lights']:
            await asyncio.to_thread(self.bridge.request, 'PUT', f'/lights/{identifier}/state',
                                    {'on': False, 'transitiontime': 0})

    async def thunder(self, audio=None):
        if not self.settings.get('audio_enabled', bool(self.settings.get('thunder_file'))):
            return
        audio = audio or self.settings.get('thunder_file')
        if not audio:
            return
        if self.sonos is not None:
            try:
                await self.sonos.play(audio)
                log('Sonos thunder command sent.')
            except Exception:
                log('Sonos thunder skipped: speaker unavailable, busy or regrouped.')
            return
        player = await asyncio.create_subprocess_exec('/usr/bin/afplay', '-v', '0.4', audio,
                                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            await player.wait()
        finally:
            if player.returncode is None:
                player.terminate()
                await player.wait()

    async def effect(self):
        self.busy = True
        self.status(state='starting', last_trigger_at=datetime.now(timezone.utc).isoformat())
        area = self.settings['area']
        started = False
        audio_task = None
        watchdog = None
        try:
            group = await asyncio.to_thread(self.bridge.request, 'GET', '/groups/' + self.settings['group'])
            if set(group['lights']) != set(self.settings['lights']):
                raise HueError('Entertainment membership changed; run setup again.')
            configs = await self.request('GET', '/clip/v2/resource/entertainment_configuration')
            if any(c['status'] == 'active' for c in configs):
                log('Skipped: another Entertainment stream is active.')
                self.status(state='skipped', reason='another_entertainment_stream')
                return
            current = next(c for c in configs if c['id'] == area)
            if {c['channel_id'] for c in current['channels']} != set(self.settings['channels']):
                raise HueError('Entertainment membership changed; run setup again.')
            await self.request('PUT', '/clip/v2/resource/entertainment_configuration/' + area,
                               {'action': 'start'})
            started = True
            await asyncio.to_thread(self.streamer.connect, self.host,
                                    self.credentials['username'], self.credentials['clientkey'], area)
            plan = sequence()
            channels = self.settings['channels']
            patterns = lightning_patterns(plan, channels)
            tracks = {}
            if self.settings.get('thunder_catalog'):
                catalog = load_soundtracks(self.settings['thunder_catalog'])
                patterns, tracks = recorded_patterns(plan, channels, catalog)
            elif self.settings.get('thunder_file'):
                tracks = {index: self.settings['thunder_file'] for index, (mode, _) in enumerate(plan)
                          if mode == 'lightning'}
            log('Sequence started: normal 2s, dark 0.5s, lightning 4s, two-minute storm.')
            self.status(state='playing', reason=None, last_error=None)
            start = CLOCK()
            watchdog = asyncio.create_task(self.watch_stream())
            if self.settings.get('audio_enabled', bool(self.settings.get('thunder_file'))) and tracks:
                from sonos_audio import play_timeline
                audio_task = asyncio.create_task(play_timeline(
                    plan, tracks, start, self.settings.get('audio_lead_seconds', 0), self.thunder, CLOCK))
            while (elapsed := CLOCK() - start) < sum(d for _, d in plan):
                if not self.streamer.is_connected:
                    raise StreamDisconnected('Entertainment sender disconnected.')
                if watchdog.done():
                    watchdog.result()
                frame = frame_at(elapsed, plan, patterns, channels)
                self.streamer.send_colors([LightColorCommand(channel_id=i, red=color[0],
                                                            green=color[1], blue=color[2])
                                           for i, color in frame.items()])
                await asyncio.sleep(0.02)
        finally:
            try:
                if watchdog:
                    watchdog.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await watchdog
                if audio_task:
                    audio_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await audio_task
                await asyncio.to_thread(self.streamer.disconnect)
                self.status(stream_connected=False)
                if started:
                    try:
                        await self.request('PUT', '/clip/v2/resource/entertainment_configuration/' + area,
                                           {'action': 'stop'})
                    finally:
                        await self.dark()
                    log('Stream released; lights off.')
            finally:
                if self.sonos is not None:
                    with contextlib.suppress(Exception):
                        await self.sonos.close()
                self.busy = False

    async def trigger(self, gate):
        try:
            for attempt in range(2):
                try:
                    await self.refresh_host()
                    await self.effect()
                    self.status(state='idle')
                    return
                except (StreamDisconnected, aiohttp.ClientError, TimeoutError, OSError) as error:
                    self.status(state='retrying' if attempt == 0 else 'failed', last_error=type(error).__name__)
                    log('Lighting connection failed (' + type(error).__name__ + '); ' +
                        ('retrying this motion once.' if attempt == 0 else 'waiting for fresh motion.'))
                    if attempt == 0:
                        await asyncio.sleep(1)
        except Exception:
            self.status(state='failed', last_error='sequence_error')
            log('Lightning failed; cleanup attempted. Waiting for fresh motion.')
        finally:
            gate.finish(time.monotonic())

    async def listen(self):
        gate = MotionGate()
        sequence_task = None

        async def observe(resource, event_timestamp=None, source='poll'):
            nonlocal sequence_task
            sample = motion_sample(resource, event_timestamp)
            if sample is None:
                return
            present, stamp = sample
            self.status(presence=present, motion_report_epoch=stamp,
                        motion_read_at=datetime.now(timezone.utc).isoformat())
            if gate.present is None:
                # Reconcile a genuinely recent detection at startup, without
                # replaying an old cached true state from hours ago.
                recent = present and stamp is not None and 0 <= time.time()-stamp <= 30
                if not recent:
                    gate.present, gate.last_report = present, stamp
                    return
                gate.present = False
            if gate.update(present, time.monotonic(), stamp):
                log('Motion detected (' + source + '); starting sequence.')
                sequence_task = asyncio.create_task(self.trigger(gate))

        async def poll():
            failed = False
            while True:
                try:
                    await self.refresh_host()
                    resources = await self.request('GET', '/clip/v2/resource/motion/' + self.settings['motion'])
                    if resources:
                        await observe(resources[0])
                    failed = False
                except (aiohttp.ClientError, TimeoutError, OSError, ValueError, HueError) as error:
                    self.status(motion_error=type(error).__name__)
                    if not failed:
                        log('Motion reconciliation unavailable; retrying.')
                    failed = True
                await asyncio.sleep(2)

        async def events():
            while True:
                try:
                    await self.refresh_host()
                    timeout = aiohttp.ClientTimeout(total=None, sock_read=120)
                    async with self.http.get('https://' + self.host + '/eventstream/clip/v2',
                                             headers={'Accept': 'text/event-stream'}, timeout=timeout) as response:
                        response.raise_for_status()
                        log('Motion event stream connected; two-second reconciliation active.')
                        self.status(events_connected=True)
                        lines, size = [], 0
                        async for raw in response.content:
                            line = raw.decode().rstrip('\r\n')
                            size += len(line)
                            if size > 1024*1024:
                                raise ValueError('Oversized motion event')
                            if line.startswith('data:'):
                                lines.append(line[5:].strip())
                            elif not line:
                                if lines:
                                    for event in json.loads('\n'.join(lines)):
                                        if event.get('type') != 'update':
                                            continue
                                        for resource in event.get('data', []):
                                            if resource.get('id') == self.settings['motion']:
                                                await observe(resource, event.get('creationtime'), 'event')
                                lines, size = [], 0
                except (aiohttp.ClientError, TimeoutError, OSError, ValueError, HueError):
                    self.status(events_connected=False)
                    log('Motion event connection interrupted; polling remains active.')
                    await asyncio.sleep(5)

        while True:
            try:
                await self.refresh_host()
                await self.dark()
                self.status(state='idle')
                break
            except (HueError, OSError, TimeoutError):
                self.status(state='reconnecting')
                log('Waiting for Bridge connectivity before listening.')
                await asyncio.sleep(5)
        tasks = [asyncio.create_task(poll()), asyncio.create_task(events())]
        try:
            await asyncio.gather(*tasks)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if sequence_task:
                sequence_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await sequence_task


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
        awake = None
        if args.command == 'listen' and args.keep_awake:
            awake = subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(os.getpid())],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        await controller.open()
        try:
            if args.command == 'test':
                await controller.effect()
            else:
                await controller.listen()
        finally:
            await controller.http.close()
            if awake:
                awake.terminate()
                awake.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('pair')
    setup_parser = sub.add_parser('setup')
    setup_parser.add_argument('--room', required=True)
    setup_parser.add_argument('--sensor', required=True)
    sub.add_parser('test')
    listener = sub.add_parser('listen')
    listener.add_argument('--keep-awake', action='store_true', help='Prevent idle sleep on macOS while listening')
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
