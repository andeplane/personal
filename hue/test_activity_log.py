import asyncio
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock

from activity_log import ActivityLog
from control_actions import dispatch
from lightning import Controller, MotionGate


class HistoryTests(unittest.TestCase):
    def test_motion_reports_deduplicate_push_and_poll_but_keep_fresh_detections(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'activity.sqlite3'
            log = ActivityLog(path)
            log.motion(True, 100, 'event', 'Motion detected')
            log.motion(True, 100, 'poll', 'Motion detected · scene running')
            log.motion(True, 101, 'event', 'Motion detected · scene running')
            log.motion(False, 102, 'event', 'Motion cleared')
            items = ActivityLog(path).page()['activity']
            self.assertEqual([i['message'] for i in items], ['Motion cleared', 'Motion detected · scene running', 'Motion detected'])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertTrue(items[-1]['at'].startswith('1970-01-01T00:01:40'))

    def test_all_history_is_paged_without_overlaps_or_missing_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            log = ActivityLog(Path(directory)/'activity.sqlite3')
            for i in range(225): log.add('motion', str(i))
            ids = []; before = None
            while True:
                result = log.page(before)
                ids.extend(row['id'] for row in result['activity'])
                if not result['activity_more']: break
                before = result['activity'][-1]['id']
            self.assertEqual(ids, list(range(225, 0, -1)))
            with self.assertRaises(ValueError): log.page(-1)


class RunHistoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_reports_during_scene_are_recorded_without_retriggering(self):
        with tempfile.TemporaryDirectory() as directory:
            c = Controller({'host':'bridge.local','username':'test'},
                           {'activity_file':str(Path(directory)/'a.sqlite3'), 'motion':'sensor'})
            c.dark=AsyncMock(); c.refresh_host=AsyncMock(); c.http=Mock()
            c.http.get.side_effect=OSError('event stream offline')
            report=lambda value, seconds: [{'motion':{'motion_report':{
                'motion':value,'changed':f'2026-10-31T08:00:0{seconds}Z'}}}]
            c.request=AsyncMock(side_effect=[report(False,0),report(True,1),report(True,2)])
            started=asyncio.Event()
            async def effect():
                c.status(state='playing');started.set();await asyncio.Event().wait()
            c.effect=AsyncMock(side_effect=effect)
            listener=asyncio.create_task(c.listen())
            try:
                await asyncio.wait_for(started.wait(), 4)
                for _ in range(30):
                    rows=c.activity_log.page()['activity']
                    if any(r['message']=='Motion detected · scene running' for r in rows):break
                    await asyncio.sleep(.1)
                else:self.fail('Motion during the scene was not recorded')
                self.assertEqual(c.effect.await_count,1)
            finally:
                listener.cancel()
                if c.sequence_task:c.sequence_task.cancel()
                await asyncio.gather(listener,c.sequence_task,return_exceptions=True)

    async def test_started_finished_and_cancelled_are_distinct(self):
        with tempfile.TemporaryDirectory() as directory:
            c = Controller({'host':'bridge.local','username':'test'}, {'activity_file':str(Path(directory)/'a.sqlite3')})
            c.refresh_host = AsyncMock()
            async def finish(): c.status(state='playing')
            c.effect = AsyncMock(side_effect=finish)
            await c.trigger(MotionGate())
            rows = c.activity_log.page()['activity']
            self.assertEqual([r['message'] for r in rows[:3]], ['Scene finished','Scene started','Scene requested'])
            started = asyncio.Event()
            async def wait():
                c.status(state='playing');started.set();await asyncio.Event().wait()
            c.effect = AsyncMock(side_effect=wait)
            task = asyncio.create_task(c.trigger(MotionGate(), origin='manual'))
            await started.wait();task.cancel()
            with self.assertRaises(asyncio.CancelledError): await task
            rows = c.activity_log.page()['activity']
            self.assertEqual([r['message'] for r in rows[:3]], ['Scene stopped','Scene started','Scene requested'])
            self.assertTrue(all(r['source']=='manual' for r in rows[:3]))
            result = await dispatch(c, {'action':'events', 'before':rows[0]['id']})
            self.assertEqual(result['activity'][0]['message'], 'Scene started')
