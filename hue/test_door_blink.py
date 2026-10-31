import asyncio
import random
import unittest
from unittest.mock import AsyncMock, Mock

from door_blink import OFF, burst_pattern, blink_once, door_blink_loop


class DoorBlinkTests(unittest.IsolatedAsyncioTestCase):
    def controller(self):
        c=Mock();c.settings={'lights':['101','102','103'],'door_blink_light':'900'}
        c.bridge.request=Mock(return_value={'state':{'reachable':True,'ct':154}})
        c.light_writer.write=AsyncMock()
        return c

    def test_patterns_are_irregular_short_flashes_in_three_to_four_seconds(self):
        signatures=set()
        for seed in range(100):
            duration,pulses=burst_pattern(random.Random(seed))
            self.assertTrue(3<=duration<=4)
            self.assertTrue(4<=len(pulses)<=5)
            self.assertTrue(all(.24-1e-9<=end-start<=.28+1e-9 for start,end in pulses))
            self.assertTrue(all(b[0]-a[1]>=.25-1e-9 for a,b in zip(pulses,pulses[1:])))
            self.assertTrue(3<=pulses[-1][1]-pulses[0][0]<=4)
            self.assertLess(pulses[-1][1],duration)
            signatures.add(tuple(round(start,3) for start,_ in pulses))
        self.assertGreater(len(signatures),95)

    async def test_random_burst_runs_full_window_then_finishes_off(self):
        c=self.controller();now=0.;states=[]
        async def sleep(delay):
            nonlocal now
            now+=delay
        async def write(value):states.append((now,value['900']))
        c.light_writer.write.side_effect=write
        await blink_once(c,'900',rng=random.Random(1),clock=lambda:now,sleep=sleep)
        self.assertTrue(3<=now<=4)
        self.assertTrue(4<=sum(state['on'] for _,state in states)<=5)
        self.assertTrue(all(state.get('ct')==154 for _,state in states if state['on']))
        self.assertEqual(states[-1][1],OFF)

    async def test_starts_are_sixty_to_one_hundred_twenty_seconds_apart(self):
        c=self.controller();now=0.;onsets=[]
        async def sleep(delay):
            nonlocal now
            now+=delay
            await asyncio.sleep(0)
        async def write(value):
            if value['900']['on']:onsets.append(now)
            if len(onsets)>=11:raise asyncio.CancelledError
        c.light_writer.write.side_effect=write
        with self.assertRaises(asyncio.CancelledError):
            await door_blink_loop(c,rng=random.Random(2),clock=lambda:now,sleep=sleep)
        starts=[onsets[0]]
        for at in onsets[1:]:
            if at-starts[-1]>10:starts.append(at)
        self.assertGreaterEqual(len(starts),3)
        self.assertTrue(all(59.9<=b-a<=120.1 for a,b in zip(starts,starts[1:])))
        self.assertEqual(c.light_writer.write.await_args_list[-1].args[0],{'900':OFF})

    async def test_cancellation_during_white_leaves_door_off(self):
        c=self.controller();entered=asyncio.Event()
        async def sleep(_):entered.set();await asyncio.Future()
        task=asyncio.create_task(blink_once(c,'900',rng=random.Random(3),sleep=sleep))
        await entered.wait();task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertEqual(c.light_writer.write.await_args_list[-1].args[0],{'900':OFF})

    async def test_slow_writer_skips_expired_flashes(self):
        c=self.controller();now=0.;onsets=[]
        async def sleep(delay):
            nonlocal now
            now+=delay
        async def write(value):
            nonlocal now
            if value['900']['on']:onsets.append(now);now+=2
        c.light_writer.write.side_effect=write
        await blink_once(c,'900',rng=random.Random(3),clock=lambda:now,sleep=sleep)
        self.assertLess(len(onsets),4)
        self.assertEqual(c.light_writer.write.await_args_list[-1].args[0],{'900':OFF})

    async def test_refuses_scene_bulb(self):
        c=self.controller();c.settings['lights']=['900']
        await door_blink_loop(c)
        c.light_writer.write.assert_not_awaited();c.activity.assert_called_once()

    async def test_failed_off_retries_only_off_without_an_early_new_burst(self):
        c=self.controller();now=0.;writes=[];retry=asyncio.Event();failures=0
        async def sleep(delay):
            nonlocal now
            now+=delay
            if delay==5:retry.set();await asyncio.Future()
        async def write(value):
            nonlocal failures
            writes.append(value['900'])
            if len(writes)>=3 and failures<4:
                failures+=1;raise OSError('temporary bridge error')
        c.light_writer.write.side_effect=write
        task=asyncio.create_task(door_blink_loop(c,rng=random.Random(4),clock=lambda:now,sleep=sleep))
        await asyncio.wait_for(retry.wait(),1)
        self.assertTrue(all(not state['on'] for state in writes[2:]))
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertEqual(writes[-1],OFF)
