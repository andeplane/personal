"""Independent, low-rate white flashes on the designated door bulb."""
import asyncio
import contextlib
import random

from hue import HueError


async def blink_once(c, light):
    for _ in range(2):
        await c.light_writer.write({light: {'on': True, 'bri': 254, 'ct': 154, 'transitiontime': 0}})
        await asyncio.sleep(random.uniform(.35, .48))
        await c.light_writer.write({light: {'on': False, 'transitiontime': 0}})
        await asyncio.sleep(random.uniform(.25, .45))


async def door_blink_loop(c):
    light = str(c.settings['door_blink_light'])
    if not light.isdigit() or light in c.settings['lights']:
        c.activity('monitor', 'Door blinking disabled: invalid or overlapping bulb', source='door light')
        return
    failed = False
    try:
        while True:
            try:
                bulb = await asyncio.to_thread(c.bridge.request, 'GET', '/lights/' + light)
                if not bulb['state'].get('reachable') or 'ct' not in bulb['state']:
                    raise HueError('Door bulb unavailable')
                await c.light_writer.write({light: {'on': False, 'transitiontime': 0}})
                await blink_once(c, light)
                if failed:
                    c.activity('monitor', 'Door light blinking recovered', source='door light')
                failed = False
            except Exception:
                with contextlib.suppress(Exception):
                    await c.light_writer.write({light: {'on': False, 'transitiontime': 0}})
                if not failed:
                    c.activity('monitor', 'Door light unavailable; blinking will retry', source='door light')
                failed = True
            await asyncio.sleep(5 if failed else random.uniform(25, 35))
    finally:
        with contextlib.suppress(Exception):
            await c.light_writer.write({light: {'on': False, 'transitiontime': 0}})
