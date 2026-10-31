"""Sparse, bounded light-state edges for the REST fallback.

Only transitions are emitted: this module never turns a frame stream into REST
requests. A slow consumer receives the current intended state, not a replay of
expired flashes. The caller supplies an asynchronous, bounded network writer.
"""
import asyncio
import contextlib
import math
import random
import time

BLACK = (0, 0, 0)
WHITE = (65535, 65535, 65535)


def _rgb(value):
    if len(value) != 3 or any(isinstance(x, bool) or not isinstance(x, int) or not 0 <= x <= 65535 for x in value):
        raise ValueError('Expected three 16-bit RGB integers')
    return tuple(value)


def _build_edges(plan, patterns, channels, normal, anchor, pulse_width=.20, *,
                min_pulse_spacing=.60, merge_window=.025, max_writes_per_second=10,
                max_cue_shift=.12, opening_schedule=None):
    """Return ``(offset, changed-colours)`` edges, including final darkness.

    Pulses are full white, 180–220 ms wide, separated by at least 600 ms by
    default. Slightly close cues may move forward by at most 120 ms; larger collisions
    are omitted rather than stretching a white hold.
    Near-simultaneous channel transitions may be batched up to 25 ms early.
    The default two-light profile is checked against a rolling 10-write budget.
    """
    channels = list(channels)
    if not channels or len(set(channels)) != len(channels):
        raise ValueError('Choose distinct channels')
    if not math.isfinite(pulse_width) or not .18 <= pulse_width <= .22:
        raise ValueError('REST pulses must be 180–220 ms wide')
    if not math.isfinite(min_pulse_spacing) or min_pulse_spacing < .60:
        raise ValueError('REST pulse spacing must be at least 600 ms')
    if not 0 <= merge_window <= .025:
        raise ValueError('Merge window must be at most 25 ms')
    if not math.isfinite(max_cue_shift) or not 0 <= max_cue_shift <= .12:
        raise ValueError('Cue shift must be at most 120 ms')
    normal, anchor = _rgb(normal), _rgb(anchor)
    raw, offset = [], 0.0
    for index, (mode, duration) in enumerate(plan):
        if mode not in ('normal', 'dark', 'steady', 'lightning') or not math.isfinite(duration) or duration <= 0:
            raise ValueError('Invalid phase')
        base = {channel: (normal if mode == 'normal' else anchor if mode in ('steady', 'lightning') and n == 0 and (mode == 'steady' or index > 2) else BLACK)
                for n, channel in enumerate(channels)}
        raw.append((offset, base))
        if mode == 'lightning':
            for n, channel in enumerate(channels):
                if n == 0 and index > 2:
                    continue
                previous = -math.inf
                count = 0
                randomized = opening_schedule is not None and index in opening_schedule
                cues = ([(at, at+pulse_width, 1) for at in opening_schedule[index]] if randomized
                        else patterns.get(index, {}).get(channel, []))
                for start, end, peak in sorted(cues):
                    if not all(math.isfinite(x) for x in (start, end, peak)) or not 0 <= start < end <= duration:
                        raise ValueError('Invalid lightning cue')
                    spacing = .55 if randomized else min_pulse_spacing
                    shifted = max(start, previous + spacing)
                    if shifted - start > (0 if randomized else max_cue_shift) + 1e-9 or count >= 6:
                        continue
                    start = shifted
                    # Do not create an undersized pulse against a phase boundary.
                    if start + pulse_width > duration + 1e-9:
                        continue
                    raw.append((offset + start, {channel: WHITE}))
                    raw.append((offset + start + pulse_width, {channel: BLACK}))
                    previous, count = start, count + 1
        offset += duration
    raw.append((offset, dict.fromkeys(channels, BLACK)))
    raw.sort(key=lambda edge: edge[0])
    # Merging may advance one edge. Keep that uncertainty inside the pulse
    # width bounds, and never collapse two different states of one channel.
    effective_merge = min(merge_window, pulse_width-.18, .22-pulse_width)
    batched = []
    for at, changes in raw:
        if batched and at - batched[-1][0] <= effective_merge + 1e-9 and (abs(at-batched[-1][0]) <= 1e-9 or not set(changes).intersection(batched[-1][1])):
            batched[-1][1].update(changes)
        else:
            batched.append((at, dict(changes)))
    state, edges = {}, []
    for at, changes in batched:
        changed = {channel: color for channel, color in changes.items() if state.get(channel) != color}
        state.update(changes)
        if changed:
            edges.append((at, changed))
    if max_writes_per_second is not None:
        window, writes = [], 0
        for at, changes in edges:
            while window and window[0][0] < at - 1 - 1e-9:
                writes -= window.pop(0)[1]
            writes += len(changes)
            window.append((at, len(changes)))
            if writes > max_writes_per_second:
                raise ValueError('REST schedule exceeds the rolling light-write budget')
    return edges


def _opening_times(cues, duration, width, rng):
    """Keep the first strike; vary secondary strikes without a metronome grid."""
    cues = sorted(cues)
    if len(cues) < 4 or duration < 2:
        return None
    target = min(len(cues), rng.choice((4, 5, 5, 6)))
    # Prefer stronger original cues when their recorded amplitudes are available;
    # equal-strength fillers are sampled rather than all being forced on a grid.
    ranked = sorted(cues[1:], key=lambda cue: .65*cue[2]+.35*rng.random(), reverse=True)
    selected = sorted([cues[0], *ranked[:target-1]])
    starts = [selected[0][0]]
    for cue in selected[1:]:
        candidate = cue[0]+rng.uniform(-.09,.09)
        if candidate < starts[-1]+.55 or candidate+width > duration:
            return None
        starts.append(candidate)
    gaps = [b-a for a,b in zip(starts,starts[1:])]
    # A short cluster and a longer pause make the opening feel irregular. Do not
    # force a cue onto a fixed grid merely to meet those expressive conditions.
    if min(gaps) > .68 or max(gaps) < .90:
        return None
    return starts


def _three_opening_times(cues, duration, width, rng, randomized):
    """A three-lamp pulse costs six writes; avoid two complete pulses per second."""
    cues = sorted(cues)
    if not cues:
        return []
    spacing = 1.0-width+.08
    starts = [cues[0][0]] if cues[0][0]+width <= duration else []
    for start, _, _ in cues[1:]:
        if len(starts) >= 4:
            break
        if randomized and rng.random() < .10:
            continue
        candidate = start+(rng.uniform(-.06,.06) if randomized else 0)
        shifted = max(candidate, starts[-1]+spacing) if starts else candidate
        if shifted-candidate > .12+1e-9 or shifted+width > duration:
            continue
        starts.append(shifted)
    return starts


def _three_channel_edges(plan, patterns, channels, normal, anchor, width, options,
                         rng, randomize_opening):
    # Validate the original inputs before transforming timing. This cannot send
    # anything and deliberately does not apply the two-lamp budget profile.
    validation = {**options, 'max_writes_per_second': None}
    _build_edges(plan,patterns,channels,normal,anchor,width,**validation)
    openings = {index: duration for index,(mode,duration) in enumerate(plan)
                if mode == 'lightning' and index <= 2}
    rng = rng or (random.SystemRandom() if randomize_opening else random.Random(0))
    for attempt in range(25):
        randomized = randomize_opening and attempt < 24
        opening_schedule = {
            index: _three_opening_times(patterns.get(index,{}).get(channels[0],[]),
                                       duration,width,rng,randomized)
            for index,duration in openings.items()
        }
        if randomized and any(len(times)<min(3,len(patterns.get(index,{}).get(channels[0],[])))
                              for index,times in opening_schedule.items()):
            continue
        varied = {index: dict(by_channel) for index,by_channel in patterns.items()}
        for index,(mode,duration) in enumerate(plan):
            if mode != 'lightning' or index <= 2:
                continue
            # The first flashing lamp retains its audio-derived cues. The other
            # has a small independent lag and occasionally omits a secondary
            # strike, rather than mirroring the same lamp twice.
            cues = []
            for number,(start,end,peak) in enumerate(patterns.get(index,{}).get(channels[2],[])):
                if randomized and number and rng.random() < .16:
                    continue
                lag = rng.uniform(.06,.14) if randomized else .10
                if start+lag+width > duration:
                    continue
                cues.append((start+lag,min(duration,end+lag),peak))
            varied.setdefault(index,{})[channels[2]] = cues
        try:
            return _build_edges(plan,varied,channels,normal,anchor,width,
                                opening_schedule=opening_schedule,**options)
        except ValueError as error:
            if 'rolling light-write budget' not in str(error):
                raise
    raise ValueError('Three-light schedule cannot fit the rolling light-write budget')


def build_edges(plan, patterns, channels, normal, anchor, pulse_width=.20, *,
                min_pulse_spacing=.60, merge_window=.025, max_writes_per_second=10,
                max_cue_shift=.12, rng=None, randomize_opening=True):
    """Build bounded light edges, with an irregular opening by default.

    The first opening cue stays fixed. Secondary opening cues are sampled and
    jittered by at most 90 ms, with at least 550 ms between opening strikes.
    Omissions create longer pauses without increasing flash speed. Later
    bursts keep their existing audio-aligned timing. Every candidate is checked
    against the full rolling request budget; at most 24 candidates are tried,
    followed by the conservative, bounded source-cue schedule. Three channels
    use a sparser shared opening, then one yellow anchor and two independently
    timed flashers, within the same request budget.
    """
    plan, channels = list(plan), list(channels)
    options = dict(min_pulse_spacing=min_pulse_spacing, merge_window=merge_window,
                   max_writes_per_second=max_writes_per_second, max_cue_shift=max_cue_shift)
    if len(channels) == 3:
        return _three_channel_edges(plan,patterns,channels,normal,anchor,pulse_width,
                                    options,rng,randomize_opening)
    fallback = _build_edges(plan,patterns,channels,normal,anchor,pulse_width,**options)
    if not randomize_opening:
        return fallback
    openings = {index: duration for index,(mode,duration) in enumerate(plan)
                if mode == 'lightning' and index <= 2}
    if not openings:
        return fallback
    rng = rng or random.SystemRandom()
    for _ in range(24):
        schedules = {}
        for index,duration in openings.items():
            cues = patterns.get(index,{}).get(channels[0],[])
            starts = _opening_times(cues,duration,pulse_width,rng)
            if starts is None:
                break
            schedules[index] = starts
        if len(schedules) != len(openings):
            continue
        try:
            return _build_edges(plan,patterns,channels,normal,anchor,pulse_width,
                                opening_schedule=schedules,**options)
        except ValueError as error:
            if 'rolling light-write budget' not in str(error):
                raise
    return fallback


async def _drain(task):
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
        except Exception:
            break
    return task.result()


async def _send(send, colors):
    # A canceled coroutine cannot cancel an in-flight network write safely. Wait
    # for it before cleanup so a late old "on" cannot win over a newer "off".
    task = asyncio.create_task(send(colors))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        with contextlib.suppress(Exception):
            await _drain(task)
        raise


async def render_edges(edges, send, *, clock=time.monotonic, sleep=asyncio.sleep,
                       start=None, observe=None):
    """Apply edges at absolute times; return send/late/collapse statistics.

    ``observe`` is an optional synchronous callback receiving a dict containing
    offset, elapsed, colors and lateness immediately before each network write.
    Cancellation drains the outstanding write, then attempts final darkness.
    """
    edges = list(edges)
    previous = -math.inf
    channels = set()
    for at, colors in edges:
        if not math.isfinite(at) or at < 0 or at < previous:
            raise ValueError('Edges must be ordered nonnegative times')
        previous = at
        channels.update(colors)
        for color in colors.values():
            _rgb(color)
    start = clock() if start is None else start
    desired, applied = {}, {}
    stats = {'sends': 0, 'channel_writes': 0, 'collapsed_edges': 0, 'max_lateness': 0.0}
    index, completed = 0, False
    try:
        while index < len(edges):
            target = start + edges[index][0]
            delay = target - clock()
            if delay > 0:
                await sleep(delay)
            now = clock()
            first, consumed = index, 0
            while index < len(edges) and start + edges[index][0] <= now + 1e-9:
                desired.update(edges[index][1])
                index += 1
                consumed += 1
            if not consumed:
                continue
            stats['collapsed_edges'] += max(0, consumed - 1)
            changes = {channel: color for channel, color in desired.items() if applied.get(channel) != color}
            if not changes:
                continue
            lateness = max(0.0, now - start - edges[first][0])
            stats['max_lateness'] = max(stats['max_lateness'], lateness)
            if observe:
                observe({'offset': edges[index-1][0], 'elapsed': now-start,
                         'colors': changes, 'lateness': lateness})
            await _send(send, changes)
            applied.update(changes)
            stats['sends'] += 1
            stats['channel_writes'] += len(changes)
        completed = True
        stats['elapsed'] = clock() - start
        return stats
    finally:
        if not completed and channels:
            with contextlib.suppress(Exception):
                await _send(send, dict.fromkeys(channels, BLACK))
