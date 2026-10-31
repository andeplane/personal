import asyncio
from datetime import datetime, timezone, timedelta
import unittest
from unittest.mock import AsyncMock, Mock

from lightning import Controller, darkness_sample


def sensor(dark, age=0, reachable=True):
    updated=(datetime.now(timezone.utc)-timedelta(seconds=age)).isoformat()
    return {'config':{'on':True,'reachable':reachable},'state':{'dark':dark,'lastupdated':updated}}


class DarknessSampleTests(unittest.TestCase):
    def test_sensor_value_must_be_valid_reachable_and_recent(self):
        import time
        for value in (True,False):
            self.assertIs(darkness_sample(sensor(value),time.time()),value)
        self.assertIsNone(darkness_sample(sensor(True,age=1801),time.time()))
        self.assertIsNone(darkness_sample(sensor(True,reachable=False),time.time()))
        self.assertIsNone(darkness_sample(sensor(None),time.time()))


class DarknessIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_daylight_blocks_motion_then_dark_allows_new_report(self):
        c=Controller({'host':'bridge.local','username':'test'}, {'dark_sensor_id':'3','motion':'sensor','lights':[]})
        c.refresh_host=AsyncMock();c.dark=AsyncMock();c.http=Mock()
        c.http.get.side_effect=OSError('offline stream')
        current={'dark':False}; c.bridge.request=Mock(side_effect=lambda *_:sensor(current['dark']))
        calls=0; daylight_seen=asyncio.Event()
        async def request(*_):
            nonlocal calls
            calls+=1
            if calls>=2:daylight_seen.set()
            return [{'motion':{'motion_report':{'motion':calls>=2,
                     'changed':f'2026-10-31T08:00:0{min(calls,9)}Z'}}}]
        c.request=AsyncMock(side_effect=request)
        started=asyncio.Event()
        async def effect():started.set()
        c.effect=AsyncMock(side_effect=effect)
        listener=asyncio.create_task(c.listen())
        try:
            await asyncio.wait_for(daylight_seen.wait(),4)
            await asyncio.sleep(.1)
            self.assertEqual(c.health['dark_gate'],'daylight')
            c.effect.assert_not_awaited()
            current['dark']=True;c.darkness_checked=0
            await asyncio.wait_for(started.wait(),4)
            self.assertEqual(c.health['dark_gate'],'dark')
            c.effect.assert_awaited_once()
        finally:
            listener.cancel()
            if c.sequence_task:c.sequence_task.cancel()
            await asyncio.gather(listener,c.sequence_task,return_exceptions=True)

    async def test_unreachable_light_sensor_never_grants_permission(self):
        c=Controller({'host':'bridge.local','username':'test'}, {'dark_sensor_id':'3'})
        c.bridge.request=Mock(return_value=sensor(True,reachable=False))
        await c.refresh_darkness()
        self.assertIsNone(c.darkness)
        self.assertEqual(c.health['dark_gate'],'unavailable')
