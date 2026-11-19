"""Role-based outdoor scene: thunder, mask reveal, thunder, scream finale.

Only explicitly selected fixtures are written. The white-only mask uses CT;
the RGB lamps use independent white/purple strokes. The fast opening leads
into thirty seconds of varied scares; every exit returns the fixtures to dark.
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
OPENING_SECONDS = 14.0
SCENE_SECONDS = 44.0


def volume_cues(voice_volume):
    return [(0, 100), (2.5, 70), (5.5, 100), (9.1, voice_volume),
            (14, 100), (19.9, 70), (27.4, 100), (32.9, voice_volume), (41, 100)]


def aftermath_events(flashers, mask, rng=None):
    rng = rng or random.SystemRandom()
    events = [(14, 'aftermath', {mask: {'on': True, 'bri': 65, 'ct': 454, 'transitiontime': 4}}),
              (20, 'reveal', {mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}}),
              (27.5, 'storm', {mask: {'on': False, 'transitiontime': 0}}),
              (33, 'finale', {mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}}),
              (41, 'tail', {mask: {'on': False, 'transitiontime': 25},
                            **{i: {'on': False, 'transitiontime': 25} for i in flashers}})]
    for begin, end, lower, upper in [(14.3,18.4,.65,1.4), (20.5,26.5,1.2,2.2),
                                    (27.7,32.5,.44,.8), (33.3,37.8,.34,.47),
                                    (39,40.3,.45,.8)]:
        t = begin
        number = rng.randrange(len(flashers))
        colors = {lamp:rng.randrange(2) for lamp in flashers} if len(flashers) == 3 else None
        while t + .3 < end:
            lamp = flashers[number % len(flashers)];number += 1
            color = (WHITE if colors[lamp] % 2 == 0 else PURPLE) if colors is not None else (WHITE if rng.random() < .6 else PURPLE)
            if colors is not None:colors[lamp] += 1
            events.append((t, None, {lamp: {'on': True, 'bri': 254,
                           'xy': color, 'transitiontime': 0, 'alert': 'none'}}))
            events.append((t+rng.uniform(.20,.24), None,
                           {lamp: {'on': True, 'bri': 1, 'xy': PURPLE, 'transitiontime': 0}}))
            t += rng.uniform(lower,upper)
    return sorted(events,key=lambda event:event[0])


def compact_events(flashers, mask, rng=None):
    rng = rng or random.SystemRandom()
    events = [(0, 'storm', {mask: {'on': False, 'transitiontime': 0}}),
              (2.6, 'reveal', {mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}}),
              (5.5, 'storm', {mask: {'on': False, 'transitiontime': 0}}),
              (9.2, 'finale', {mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}})]
    for begin, end in [(0, 2.55), (5.5, 9.15), (9.2, 13.7)]:
        t = begin + (.20 if len(flashers) == 3 and begin == 9.2 else .06)
        number = rng.randrange(len(flashers))
        colors = {lamp:rng.randrange(2) for lamp in flashers} if len(flashers) == 3 else None
        while t + .25 < end:
            lamp = flashers[number % len(flashers)]
            color = (WHITE if colors[lamp] % 2 == 0 else PURPLE) if colors is not None else (WHITE if rng.random() < .65 else PURPLE)
            if colors is not None:colors[lamp] += 1
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


def white_companion_events(events, lamps):
    """Add cool-white strikes, using warm minimum gaps, without RGB commands."""
    counts=[(t,len(states)) for t,_,states in events]
    candidates=[t for t,_,states in events if any(s.get('bri')==254 and s.get('xy')==WHITE for s in states.values())]
    added=[]
    for lamp in lamps:
        last=-10
        for begin in sorted(candidates):
            end=begin+.30
            if begin-last < .75:
                continue
            nearby=[(t,n) for t,n in counts if begin-1 < t < end+1]
            windows=[begin,end]+[t for t,_ in nearby if begin-1 < t <= end]
            if any(sum(n for t,n in nearby if start<=t<start+1)
                   +int(start<=begin<start+1)+int(start<=end<start+1)>10 for start in windows):
                continue
            added.extend([(begin,None,{lamp:{'on':True,'bri':254,'ct':153,'transitiontime':0,'alert':'none'}}),
                          (end,None,{lamp:{'on':True,'bri':1,'ct':454,'transitiontime':0}})])
            counts.extend([(begin,1),(end,1)]);last=begin
    return added


def continuous_scene_events(flashers, mask, inside, rng=None, white_flashers=(), glow_brightness=1):
    """Keep the inside lamp active, and match outdoor strikes during storms."""
    rng = rng or random.SystemRandom()
    outside = [lamp for lamp in flashers if lamp != inside]
    if len(outside) != 2 or inside not in flashers:
        raise HueError('Continuous lightning needs one inside and two outside bulbs')
    events = compact_events(outside, mask, rng) + aftermath_events(outside, mask, rng)
    if white_flashers:
        # The indoor pair needs four requests per pulse. Space outdoor-only
        # strokes enough to keep the pair frequent without queuing flashes.
        spaced=[]; skipped=set(); last=-10
        for event in sorted(events,key=lambda item:item[0]):
            t,_,states=event
            lamp=next(iter(states)) if len(states)==1 else None
            if lamp in outside and states[lamp].get('bri')==254:
                if t-last < .62:
                    skipped.add(lamp)
                    continue
                last=t
            elif lamp in skipped and states[lamp].get('bri')==1:
                skipped.remove(lamp)
                continue
            spaced.append(event)
        events=spaced
    counts = [(t, len(states)) for t, _, states in events]
    inside_starts = []
    paired_weight = 1 + len(white_flashers)

    def reserve(begin):
        end = begin + .24
        if begin < 0 or end >= SCENE_SECONDS or any(abs(begin-x) < .36 for x in inside_starts):
            return False
        nearby = [(t,n) for t,n in counts if begin-1 < t < end+1]
        windows = [begin,end] + [t for t,_ in nearby if begin-1 < t <= end]
        if any(sum(n for t,n in nearby if start <= t < start+1)
               + paired_weight*int(start <= begin < start+1) + paired_weight*int(start <= end < start+1) > 10
               for start in windows):
            return False
        counts.extend([(begin,paired_weight),(end,paired_weight)])
        inside_starts.append(begin)
        return True

    # Prioritize a simultaneous inside/outside strike in each thunder section.
    for first,last in [(0,2.55),(5.5,9.15),(14.3,18.4),(27.7,32.5)]:
        candidates = [t for t,_,states in events if first <= t < last and
                      any(i in states and states[i].get('bri') == 254 for i in outside)]
        rng.shuffle(candidates)
        for t in candidates:
            if reserve(t):
                break

    # Fill the gaps independently, including during laughs, screams and tail.
    desired = .12
    while desired + .25 < SCENE_SECONDS:
        placed = False
        for step in range(21):
            begin = desired + step*.05
            if reserve(begin):
                desired = begin + rng.uniform(.65,1.05)
                placed = True
                break
        if not placed:
            desired += 1.0
    start_color = rng.randrange(2)
    for index, begin in enumerate(sorted(inside_starts)):
        color = WHITE if (index+start_color)%2 == 0 else PURPLE
        bright={inside:{'on':True,'bri':254,'xy':color,'transitiontime':0,'alert':'none'},
                **{lamp:{'on':True,'bri':254,'ct':153,'transitiontime':0,'alert':'none'} for lamp in white_flashers}}
        glow={inside:{'on':True,'bri':glow_brightness,'xy':[.50,.42] if glow_brightness>1 else PURPLE,'transitiontime':0},
              **{lamp:{'on':True,'bri':glow_brightness,'ct':454,'transitiontime':0} for lamp in white_flashers}}
        events.extend([(begin,None,bright),(begin+.24,None,glow)])
    return sorted(events,key=lambda item:item[0])


def prepare_compact_audio(library, tracks, rng=None):
    """One overlapping soundtrack avoids four Sonos handshakes and silent gaps."""
    from sound_library import RATE, read_pcm
    rng = rng or random.SystemRandom()
    laugh = rng.choice(['villain-cackle','haunted-laugh','sinister-laugh','witch-laugh'])
    scream = rng.choice(['monster-scream','long-male-scream'])
    inputs = [(0, Path(tracks[0]['audio_file']), 1),
              (2.6, library.by_id['evil-laugh-deep'][1], 1),
              (5.5, Path(tracks[1]['audio_file']), 1),
              (9.2, library.by_id['jump-scream'][1], 1),
              (14, library.by_id[rng.choice(['loud-storm','sharp-crack'])][1], .65),
              (20, library.by_id[laugh][1], 1),
              (27.5, library.by_id['loud-rumble'][1], 1),
              (33, library.by_id[scream][1], 1)]
    mixed = [0] * round(SCENE_SECONDS * RATE)
    for offset, path, gain in inputs:
        start = round(offset * RATE)
        samples = read_pcm(path)
        # Keep voices inside their own volume windows, fading the first laugh
        # into the next strike rather than letting its tail jump to 100%.
        voice_end = {2.6: 5.5, 20: 27.4, 33: 41}.get(offset)
        if voice_end is not None:
            samples = samples[:round((voice_end-offset)*RATE)]
            fade_frames = min(len(samples), round(.15*RATE))
            for index in range(1, fade_frames+1):
                samples[-index] = round(samples[-index]*(index-1)/fade_frames)
        for i, sample in enumerate(samples[:len(mixed)-start]):
            mixed[start+i] += round(sample*gain)
    # Soft-limit overlapping peaks; isolated voice levels remain unchanged.
    pcm = array.array('h')
    for i, sample in enumerate(mixed):
        magnitude = abs(sample)
        if magnitude > 30000:
            magnitude = min(32700, 30000 + (magnitude-30000)/(1+(magnitude-30000)/2400))
            sample = magnitude if sample > 0 else -magnitude
        fade = min(1, (len(mixed)-1-i)/(3*RATE))
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
    white = settings.get('white_flashers', [])
    if (len(flashers) not in (2, 3) or not isinstance(mask, str) or
            len(white)>1 or len(set([*flashers, mask, *white])) != len(flashers) + len(white) + 1 or
            set([*flashers, mask, *white]) != set(settings['lights'])):
        raise HueError('Horror scene needs distinct colour, mask and optional white lights')
    return flashers, mask


def warm_states(settings):
    flashers, mask = roles(settings)
    return {**{i: {'on': True, 'bri': 210, 'xy': [.50, .42], 'transitiontime': 0}
               for i in flashers},
            **{i: {'on':True, 'bri':210, 'ct':454, 'transitiontime':0} for i in settings.get('white_flashers',[])},
            mask: {'on': True, 'bri': 254, 'ct': 454, 'transitiontime': 0}}


def strokes(flashers, duration, cues=None, rng=None, finale=False):
    """Sparse, irregular independent strokes within the shared 10-write budget.

    The two-light profile uses four writes per stroke. The three-light profile
    alternates individual lamps so the shared Bridge budget is still respected.
    """
    rng = rng or random.SystemRandom()
    if len(flashers) == 3:
        events = []
        t = .12
        number = rng.randrange(3)
        while t + .3 < duration:
            lamp = flashers[number % 3]
            color = WHITE if (number // 3) % 2 == 0 else PURPLE
            events.extend([(t, {lamp:{'on':True, 'bri':254, 'xy':color, 'transitiontime':0, 'alert':'none'}}),
                           (t + .23, {lamp:{'on':True, 'bri':1, 'xy':PURPLE, 'transitiontime':0}})])
            number += 1
            t += rng.uniform(.40, .55)
        return events
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
        for lamp in [*flashers, mask, *c.settings.get('white_flashers', [])]:
            resource = await asyncio.to_thread(c.bridge.request, 'GET', '/lights/' + lamp)
            if not resource['state'].get('reachable'):
                raise HueError('A selected scene light is unreachable')
            if ('xy' if lamp in flashers else 'ct') not in resource['state']:
                raise HueError('A scene light has the wrong colour capability')
        acquired = True
        if c.settings.get('idle_glow'):
            await c.idle_lights()
        else:
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
            inside = c.settings.get('continuous_flasher')
            if inside and c.settings.get('white_flashers'):
                full=continuous_scene_events(flashers,mask,inside,rng,c.settings['white_flashers'],c.settings.get('glow_brightness',1))
                quick=[(t,{k:v for k,v in states.items() if k!=mask}) for t,_,states in full if t<3.7]
                await stage('storm',4,[(t,states) for t,states in quick if states])
            else:
                quick = strokes(flashers, 4, rng=rng)
                extra = white_companion_events([(t,None,s) for t,s in quick], c.settings.get('white_flashers', []))
                await stage('storm', 4, sorted(quick+[(t,s) for t,_,s in extra],key=lambda item:item[0]))
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
            for offset, value in volume_cues(base_volume):
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
            inside = c.settings.get('continuous_flasher')
            events = (continuous_scene_events(flashers, mask, inside, rng,c.settings.get('white_flashers',[]),c.settings.get('glow_brightness',1)) if inside else
                      compact_events(flashers, mask, rng) + aftermath_events(flashers, mask, rng))
            if not inside:
                events=sorted(events+white_companion_events(events,c.settings.get('white_flashers',[])),key=lambda item:item[0])
            for offset, phase, states in events:
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
                if c.settings.get('idle_glow'):
                    await c.idle_lights()
                else:
                    await c.dark()
        finally:
            if c.sonos is not None and not c.sound_override:
                with contextlib.suppress(Exception):
                    await c.sonos.close()
            c.busy = False
