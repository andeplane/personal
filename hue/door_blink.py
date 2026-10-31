"""Independent, intermittent white bursts on the designated door bulb."""
import asyncio
import contextlib
import random
import time

from hue import HueError


OFF = {'on': False, 'transitiontime': 0}
WHITE = {'on': True, 'bri': 254, 'ct': 154, 'transitiontime': 0, 'alert': 'none'}


def burst_pattern(rng=None):
    """Return a 3–4-second window with four or five irregular short flashes."""
    rng = rng or random.SystemRandom()
    duration = rng.uniform(3.1, 3.9)
    count = rng.choice((4, 5, 5))
    widths = [rng.uniform(.24, .28) for _ in range(count)]
    lead, tail = rng.uniform(0, .05), rng.uniform(0, .05)
    gap_total = duration-lead-tail-sum(widths)
    extra = gap_total-.25*(count-1)
    weights = [rng.uniform(.15, 1) for _ in range(count-1)]
    gaps = [.25+extra*weight/sum(weights) for weight in weights]
    pulses, at = [], lead
    for index, width in enumerate(widths):
        pulses.append((at, at+width))
        at += width+(gaps[index] if index<len(gaps) else 0)
    return duration, pulses


async def blink_once(c, light, *, rng=None, clock=None, sleep=None):
    """Run one burst through the shared writer; every exit attempts full off."""
    clock, sleep = clock or time.monotonic, sleep or asyncio.sleep
    duration, pulses = burst_pattern(rng)
    started = clock()
    try:
        for begin, end in pulses:
            await sleep(max(0, started+begin-clock()))
            # Skip an obsolete flash instead of replaying it after congestion.
            if clock() >= started+end:
                continue
            await c.light_writer.write({light: dict(WHITE)})
            # Hold from the acknowledged on so the physical pulse is visible.
            await sleep(end-begin)
            await c.light_writer.write({light: dict(OFF)})
        await sleep(max(0, started+duration-clock()))
    finally:
        await c.light_writer.write({light: dict(OFF)})


async def door_blink_loop(c, *, rng=None, clock=None, sleep=None):
    rng = rng or random.SystemRandom()
    clock, sleep = clock or time.monotonic, sleep or asyncio.sleep
    light = str(c.settings['door_blink_light'])
    if not light.isdigit() or light in map(str, c.settings['lights']):
        c.activity('monitor', 'Door blinking disabled: invalid or overlapping bulb', source='door light')
        return
    failed = False
    try:
        while True:
            started = clock()
            try:
                bulb = await asyncio.to_thread(c.bridge.request, 'GET', '/lights/' + light)
                if not bulb['state'].get('reachable') or 'ct' not in bulb['state']:
                    raise HueError('Door bulb unavailable')
                await c.light_writer.write({light: dict(OFF)})
                await blink_once(c, light, rng=rng, clock=clock, sleep=sleep)
                if failed:
                    c.activity('monitor', 'Door light blinking recovered', source='door light')
                failed = False
            except Exception:
                if not failed:
                    c.activity('monitor', 'Door light unavailable; blinking will retry', source='door light')
                failed = True
            # This is a start-to-start interval, not an extra wait after the burst.
            # A long outage never creates a backlog of overdue flashes.
            next_start = started+rng.uniform(60, 120)
            if next_start <= clock():
                next_start = clock()+rng.uniform(60, 120)
            while failed and clock()<next_start:
                try:
                    await c.light_writer.write({light: dict(OFF)})
                    break
                except Exception:
                    await sleep(min(5, max(0, next_start-clock())))
            await sleep(max(0, next_start-clock()))
    finally:
        with contextlib.suppress(Exception):
            await c.light_writer.write({light: dict(OFF)})
