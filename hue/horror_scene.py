"""Role-based outdoor scene: thunder, mask reveal, thunder, scream finale.

Only explicitly selected fixtures are written. The white-only mask uses CT;
the two RGB lamps use independent white/purple strokes. An overlapping 14-second
soundtrack removes stage delays; every exit returns the fixtures to dark.
"""
import asyncio
import array
import contextlib
import hashlib
from pathlib import Path
import random
import time
import wave

from hue import HueError

WHITE = [.313, .329]
PURPLE = [.272, .115]
SCENE_SECONDS = 14.0


def compact_events(flashers, mask, rng=None):
    rng = rng or random.SystemRandom()
    events = [(0, 'storm', {mask: {'on': False, 'transitiontime': 0}}),
              (2.6, 'reveal', {mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}}),
              (5.5, 'storm', {mask: {'on': False, 'transitiontime': 0}}),
              (9.2, 'finale', {mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}})]
    for begin, end in [(0, 2.55), (5.5, 9.15), (9.2, 13.7)]:
        t = begin + .06
        number = rng.randrange(2)
        while t + .25 < end:
            lamp = flashers[number % 2]
            color = WHITE if rng.random() < .65 else PURPLE
            # Alternate spatially; each lamp returns to an intense purple
            # accent or near-darkness before the other strikes.
            events.append((t, None, {lamp: {'on': True, 'bri': 254, 'xy': color, 'transitiontime': 0, 'alert': 'none'}}))
            events.append((t + rng.uniform(.20, .24), None, {lamp: {'on': True, 'bri': 1, 'xy': PURPLE, 'transitiontime': 0}}))
            number += 1
            t += rng.uniform(.34, .47) if begin == 9.2 else rng.uniform(.38, .55)
        events.append((end, None, {i: {'on': False, 'transitiontime': 0} for i in flashers}))
    # Brief mask flickers punctuate the scream without changing its warm colour.
    for t in (10.0, 11.6):
        events.extend([(t, None, {mask: {'on': False, 'transitiontime': 0}}),
                       (t + .18, None, {mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}})])
    return sorted(events, key=lambda item: item[0])


def prepare_compact_audio(library, tracks):
    """One overlapping soundtrack avoids four Sonos handshakes and silent gaps."""
    from sound_library import RATE, read_pcm
    inputs = [(0, Path(tracks[0]['audio_file'])),
              (2.6, library.by_id['evil-laugh-deep'][1]),
              (5.5, Path(tracks[1]['audio_file'])),
              (9.2, library.by_id['jump-scream'][1])]
    mixed = [0] * round(SCENE_SECONDS * RATE)
    for offset, path in inputs:
        start = round(offset * RATE)
        samples = read_pcm(path)
        for i, sample in enumerate(samples[:len(mixed)-start]):
            mixed[start+i] += sample
    # Soft-limit overlapping peaks; isolated voice levels remain unchanged.
    pcm = array.array('h')
    for i, sample in enumerate(mixed):
        magnitude = abs(sample)
        if magnitude > 30000:
            magnitude = min(32700, 30000 + (magnitude-30000)/(1+(magnitude-30000)/2400))
            sample = magnitude if sample > 0 else -magnitude
        fade = min(1, (len(mixed)-1-i)/(.18*RATE))
        pcm.append(round(sample*fade))
    digest = hashlib.sha256(pcm.tobytes()).hexdigest()
    path = library.cache / ('scene-' + digest + '.wav')
    if not path.exists():
        with wave.open(str(path), 'wb') as out:
            out.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            out.writeframes(pcm.tobytes())
    library.files[path.name] = path
    for old in library.cache.glob('scene-*.wav'):
        if old != path:
            library.files.pop(old.name, None)
            old.unlink()
    return path


def roles(settings):
    value = settings.get('scene_roles', {})
    flashers, mask = value.get('flashers', []), value.get('mask')
    if (len(flashers) != 2 or not isinstance(mask, str) or
            len(set([*flashers, mask])) != 3 or
            set([*flashers, mask]) != set(settings['lights'])):
        raise HueError('Horror scene requires exactly two colour lights and one mask')
    return flashers, mask


def warm_states(settings):
    flashers, mask = roles(settings)
    return {**{i: {'on': True, 'bri': 210, 'xy': [.50, .42], 'transitiontime': 0}
               for i in flashers},
            mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}}


def strokes(flashers, duration, cues=None, rng=None, finale=False):
    """Sparse, irregular independent strokes within the shared 10-write budget.

    Each stroke uses four writes (two on, two dim). Starts are at least .78s
    apart; independent lamp offsets and holds fit inside a .40s envelope.
    This bounds rolling traffic at eight stroke writes per second.
    """
    rng = rng or random.SystemRandom()
    starts = []
    source = [a for a, _, _ in cues] if cues is not None else []
    if cues is None:
        t = .12
        while t + .45 < duration:
            source.append(t)
            t += rng.uniform(.82, 1.31) if finale else rng.uniform(.80, 1.15)
    for raw in source:
        candidate = max(0, raw + (rng.uniform(-.035, .035) if starts else 0))
        if starts and candidate - starts[-1] < .78:
            continue
        if candidate + .45 <= duration:
            starts.append(candidate)
    events = []
    for number, start in enumerate(starts):
        for index, lamp in enumerate(flashers):
            offset = 0 if index == number % 2 else rng.uniform(.055, .11)
            white = (number + index) % 2 == 0
            events.append((start + offset, {lamp: {
                'on': True, 'bri': 254, 'xy': WHITE if white else PURPLE,
                'transitiontime': 0, 'alert': 'none'}}))
            events.append((start + offset + rng.uniform(.23, .28), {lamp: {
                'on': True, 'bri': 1, 'xy': PURPLE,
                'transitiontime': 0, 'alert': 'none'}}))
    return sorted(events, key=lambda event: event[0])


async def horror_scene(c, *, lightning_only=False, sound=True):
    from lightning import load_soundtracks
    flashers, mask = roles(c.settings)
    c.busy = True
    acquired = False
    try:
        c.status(state='starting', phase='preparing', last_error=None)
        group = await asyncio.to_thread(c.bridge.request, 'GET', '/groups/' + c.settings['group'])
        if set(group['lights']) != set(c.settings['lights']):
            raise HueError('Scene group membership changed')
        areas = await c.request('GET', '/clip/v2/resource/entertainment_configuration')
        if any(area['status'] == 'active' for area in areas):
            c.status(state='skipped', reason='another_entertainment_stream')
            return False
        for lamp in [*flashers, mask]:
            resource = await asyncio.to_thread(c.bridge.request, 'GET', '/lights/' + lamp)
            if not resource['state'].get('reachable'):
                raise HueError('A selected scene light is unreachable')
            if ('xy' if lamp in flashers else 'ct') not in resource['state']:
                raise HueError('A scene light has the wrong colour capability')
        acquired = True
        await c.dark()
        c.status(state='playing', reason=None, last_trigger_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
        rng = random.SystemRandom()

        async def stage(phase, duration, events, audio=None):
            c.status(phase=phase)
            # Request before the optical timeline, retaining the calibrated lead.
            # A manual sound preview owns the speaker until it finishes.
            if sound and audio and not c.sound_override:
                await c.thunder(str(audio))
                await asyncio.sleep(c.settings.get('audio_lead_seconds', .35))
            start = time.monotonic()
            for offset, states in events:
                await asyncio.sleep(max(0, start + offset - time.monotonic()))
                await c.write_lights(states)
            if audio and phase == 'storm':
                c.status(phase='tail')
            await asyncio.sleep(max(0, start + duration + .5 - time.monotonic()))

        if lightning_only:
            await stage('storm', 4, strokes(flashers, 4, rng=rng))
            return True

        catalog = load_soundtracks(c.settings['thunder_catalog'])
        chosen = rng.sample(catalog, min(2, len(catalog)))
        if len(chosen) == 1:
            chosen *= 2
        audio = await asyncio.to_thread(prepare_compact_audio, c.library, chosen)
        audio_started = time.monotonic()
        if sound and not c.sound_override:
            await c.thunder(str(audio))
            audio_started = time.monotonic()
        base_volume = c.sonos.config['volume'] if c.sonos else 54
        scene_uri = c.sonos.last_uri if c.sonos else None

        async def volumes():
            for offset, value in [(0, 100), (2.5, base_volume), (5.5, 100), (9.1, base_volume)]:
                await asyncio.sleep(max(0, audio_started + offset - time.monotonic()))
                if (c.sonos and not c.sound_override and c.sonos.last_uri == scene_uri
                        and scene_uri and c.sonos.config['volume'] == base_volume
                        and not c.health.get('audio_error')):
                    with contextlib.suppress(Exception):
                        await c.sonos.scene_volume(value)
        volume_task = asyncio.create_task(volumes()) if sound else None
        try:
            await asyncio.sleep(c.settings.get('audio_lead_seconds', .35) if sound else 0)
            start = time.monotonic()
            for offset, phase, states in compact_events(flashers, mask, rng):
                await asyncio.sleep(max(0, start + offset - time.monotonic()))
                if phase:
                    c.status(phase=phase)
                await c.write_lights(states)
            await asyncio.sleep(max(0, start + SCENE_SECONDS - time.monotonic()))
        finally:
            if volume_task:
                volume_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await volume_task
        return True
    finally:
        try:
            if acquired:
                await c.dark()
        finally:
            if c.sonos is not None and not c.sound_override:
                with contextlib.suppress(Exception):
                    await c.sonos.close()
            c.busy = False
