import asyncio
import json
from pathlib import Path
import random
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock

from overnight import Overnight, iso
from lightning import Controller
from control_actions import dispatch


class OvernightTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)/'night.json'
        self.now = 100000.0

    def schedule(self, next_offset=2, end_offset=2800):
        self.path.write_text(json.dumps({'enabled':True,'until':iso(self.now+end_offset),
                                       'next_at':iso(self.now+next_offset)}))
        return Overnight(self.path, clock=lambda:self.now, rng=random.Random(7))

    def controller(self):
        c = Controller({'host':'bridge.local','username':'test'}, {'lights':['1'],'audio_enabled':False})
        c.trigger=AsyncMock(); c.dark=AsyncMock(); c.activity=Mock()
        return c

    async def test_schedule_runs_silent_without_backlog_and_stops_at_deadline(self):
        night = self.schedule(); c=self.controller(); starts=[]
        async def trigger(*args,**kwargs): starts.append((self.now,kwargs))
        c.trigger.side_effect=trigger
        async def sleep(delay):
            self.now += delay
            await asyncio.sleep(0)
        await night.run(c,sleep)
        self.assertGreaterEqual(len(starts),2)
        self.assertTrue(all(s['sound'] is False and s['origin']=='overnight (silent)' for _,s in starts))
        self.assertTrue(all(1080 <= b[0]-a[0] <= 1321 for a,b in zip(starts,starts[1:])))
        self.assertFalse(json.loads(self.path.read_text())['enabled'])
        c.dark.assert_awaited_once()

    async def test_audio_configuration_is_fail_closed(self):
        night=self.schedule();c=self.controller();c.settings['audio_enabled']=True
        await night.run(c)
        self.assertFalse(night.enabled);c.trigger.assert_not_awaited()

    async def test_busy_skips_instead_of_overlapping(self):
        night=self.schedule(end_offset=10);c=self.controller();c.busy=True
        async def sleep(delay): self.now+=delay
        await night.run(c,sleep)
        c.trigger.assert_not_awaited()
        self.assertTrue(any('skipped' in call.args[1] for call in c.activity.call_args_list))

    async def test_stop_control_persistently_cancels_timer(self):
        c=self.controller();c.overnight=self.schedule()
        await dispatch(c,{'action':'stop'});await c.control_task
        self.assertFalse(c.overnight.enabled)
        self.assertFalse(Overnight(self.path,clock=lambda:self.now).enabled)

    def test_restarts_do_not_replay_overdue_scenes(self):
        night=self.schedule(next_offset=-300)
        self.assertTrue(1080 <= night.next_at-self.now <= 1320)

    def test_expired_schedule_stays_inactive(self):
        night=self.schedule(end_offset=-10)
        self.assertFalse(night.enabled)

    def test_overnight_configuration_forces_audio_off(self):
        self.schedule()
        c=Controller({'host':'bridge.local','username':'test'},
                     {'lights':['1'],'audio_enabled':True,'overnight_file':str(self.path)})
        self.assertFalse(c.settings['audio_enabled'])

