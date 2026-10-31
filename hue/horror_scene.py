"""Role-based outdoor scene: thunder, mask reveal, thunder, scream finale.

Only explicitly selected fixtures are written. The white-only mask uses CT;
the two RGB lamps use independent white/purple strokes. Audio tails finish
before the next recording starts, and every exit returns the fixtures to dark.
"""
import asyncio
import contextlib
from pathlib import Path
import random
import time

from hue import HueError

WHITE = [.313, .329]
PURPLE = [.272, .115]


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
        laugh, laugh_path = c.library.by_id['evil-laugh-deep']
        scream, scream_path = c.library.by_id['jump-scream']

        async def storm(track):
            await c.write_lights({mask: {'on': False, 'transitiontime': 0}})
            await stage('storm', track['audio_duration'],
                        strokes(flashers, 4, track['strikes'], rng), track['audio_file'])
            await c.write_lights({i: {'on': False, 'transitiontime': 0} for i in flashers})

        await storm(chosen[0])
        await stage('reveal', laugh['duration'], [(0, {mask: {
            'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}})], laugh_path)
        await c.write_lights({mask: {'on': False, 'transitiontime': 0}})
        await asyncio.sleep(.45)
        await storm(chosen[1])
        # Full scream, plus a minimum four-second chaotic finale. The head
        # remains brightly visible while the two RGB lamps strike around it.
        duration = max(4, scream['duration'])
        finale = [(0, {mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}})]
        finale.extend(strokes(flashers, duration, rng=rng, finale=True))
        await stage('finale', duration, finale, scream_path)
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
