import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from door_blink import blink_once, door_blink_loop


class DoorBlinkTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_white_flashes_then_off(self):
        c=Mock();c.light_writer.write=AsyncMock()
        with patch('door_blink.asyncio.sleep',new=AsyncMock()):
            await blink_once(c,'900')
        states=[call.args[0]['900'] for call in c.light_writer.write.await_args_list]
        self.assertEqual([s['on'] for s in states],[True,False,True,False])
        self.assertTrue(all(s.get('ct') == 154 for s in states if s['on']))

    async def test_cancellation_leaves_door_off(self):
        c=Mock();c.settings={'lights':['101','102','103'],'door_blink_light':'900'}
        c.bridge.request=Mock(return_value={'state':{'reachable':True,'ct':154}})
        c.light_writer.write=AsyncMock();entered=asyncio.Event()
        async def wait(*_):entered.set();await asyncio.Event().wait()
        with patch('door_blink.asyncio.sleep',side_effect=wait):
            task=asyncio.create_task(door_blink_loop(c));await entered.wait();task.cancel()
            with self.assertRaises(asyncio.CancelledError):await task
        self.assertEqual(c.light_writer.write.await_args_list[-1].args[0],{'900':{'on':False,'transitiontime':0}})

    async def test_refuses_scene_bulb(self):
        c=Mock();c.settings={'lights':['900'],'door_blink_light':'900'}
        c.light_writer.write=AsyncMock()
        await door_blink_loop(c)
        c.light_writer.write.assert_not_awaited()
        c.activity.assert_called_once()

    async def test_failed_off_is_retried_promptly(self):
        c=Mock();c.settings={'lights':['101','102','103'],'door_blink_light':'900'}
        c.bridge.request=Mock(return_value={'state':{'reachable':True,'ct':154}})
        calls=[];retry_wait=asyncio.Event()
        async def write(states):
            calls.append(states)
            if len(calls)==3:raise OSError('temporary bridge error')
        c.light_writer.write=AsyncMock(side_effect=write)
        async def sleep(duration):
            if duration==5:
                retry_wait.set();await asyncio.Event().wait()
        with patch('door_blink.asyncio.sleep',side_effect=sleep):
            task=asyncio.create_task(door_blink_loop(c))
            await asyncio.wait_for(retry_wait.wait(),1)
            self.assertEqual(calls[-1],{'900':{'on':False,'transitiontime':0}})
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):await task
