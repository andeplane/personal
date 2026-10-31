import asyncio
import threading
import unittest
from light_writer import LightWriter


class LightWriterTests(unittest.IsolatedAsyncioTestCase):
    async def test_eleventh_write_waits_using_budget_shared_across_calls(self):
        now=0.0;writes=[];sleeps=[]
        async def sleep(delay):
            nonlocal now
            sleeps.append(delay);now+=delay
        def request(identifier,body):writes.append((now,identifier,body));return identifier
        writer=LightWriter(request,clock=lambda:now,sleep=sleep)
        for index in range(11):await writer.write({str(index):{'on':True}})
        self.assertEqual([at for at,_,_ in writes[:10]],[0.0]*10)
        self.assertEqual(writes[10][0],1.0)
        self.assertEqual(sleeps,[1.0])

    async def test_at_most_two_blocking_jobs_and_callback_results(self):
        mutex=threading.Lock();release=threading.Event();entered=threading.Event()
        active=peak=0;seen=[]
        def request(identifier,body):
            nonlocal active,peak
            with mutex:
                active+=1;peak=max(peak,active)
                if active==2:entered.set()
            release.wait(2)
            with mutex:active-=1;seen.append(identifier)
            return {'id':identifier}
        writer=LightWriter(request)
        task=asyncio.create_task(writer.write({str(i):{'on':True} for i in range(5)}))
        self.assertTrue(await asyncio.to_thread(entered.wait,1))
        self.assertEqual(peak,2)
        release.set();result=await task
        self.assertLessEqual(peak,2)
        self.assertEqual(set(seen),set(map(str,range(5))))
        self.assertEqual(result['results']['4'],{'id':'4'})
        self.assertEqual(set(result['request_ms']),set(map(str,range(5))))

    async def test_cancel_drains_late_on_before_next_off(self):
        entered=threading.Event();release=threading.Event();writes=[]
        def request(identifier,body):
            if body['on']:entered.set();release.wait(2)
            writes.append(body['on'])
        writer=LightWriter(request)
        old=asyncio.create_task(writer.write({'lamp':{'on':True}}))
        self.assertTrue(await asyncio.to_thread(entered.wait,1))
        old.cancel()
        off=asyncio.create_task(writer.write({'lamp':{'on':False}}))
        await asyncio.sleep(.01)
        self.assertFalse(old.done());self.assertFalse(off.done())
        release.set()
        with self.assertRaises(asyncio.CancelledError):await old
        await off
        self.assertEqual(writes,[True,False])

    async def test_cancel_discards_unissued_jobs_even_while_waiting_for_budget(self):
        entered=asyncio.Event();never=asyncio.Event();writes=[]
        async def sleep(_):entered.set();await never.wait()
        def request(identifier,body):writes.append(identifier)
        writer=LightWriter(request,clock=lambda:0,sleep=sleep,limit=1)
        task=asyncio.create_task(writer.write({'first':{},'unissued':{}}))
        await entered.wait();task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertEqual(writes,['first'])

    async def test_error_waits_for_other_request_before_propagating(self):
        entered=threading.Event();release=threading.Event();finished=[]
        def request(identifier,body):
            if identifier=='bad':raise OSError('unavailable')
            entered.set();release.wait(2);finished.append(identifier)
        writer=LightWriter(request)
        task=asyncio.create_task(writer.write({'bad':{},'slow':{},'unissued':{}}))
        self.assertTrue(await asyncio.to_thread(entered.wait,1))
        await asyncio.sleep(.01);self.assertFalse(task.done())
        release.set()
        with self.assertRaises(OSError):await task
        self.assertEqual(finished,['slow'])

    async def test_same_device_calls_remain_ordered_and_failed_writes_count(self):
        now=0.;writes=[]
        async def sleep(delay):
            nonlocal now
            now+=delay
        def request(identifier,body):
            writes.append(body['value'])
            if body.get('fail'):raise OSError('failed')
            return body['value']
        writer=LightWriter(request,clock=lambda:now,sleep=sleep,limit=1)
        with self.assertRaises(OSError):await writer.write({'lamp':{'value':0,'fail':True}})
        result=await writer.write({'lamp':{'value':1}})
        self.assertEqual(writes,[0,1])
        self.assertEqual(result['wait_ms'],1000)
        self.assertEqual(result['results'],{'lamp':1})

    async def test_invalid_input_rejected_before_requests(self):
        called=[];writer=LightWriter(lambda *args:called.append(args))
        for states in ([],{'lamp':None}):
            with self.assertRaises(ValueError):await writer.write(states)
        for limit in (0,-1,True,1.5):
            with self.assertRaises(ValueError):LightWriter(lambda *_:None,limit=limit)
        self.assertEqual(called,[])
