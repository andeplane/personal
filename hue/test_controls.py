import asyncio
import contextlib
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import AsyncMock, Mock
from control_actions import dispatch
from lightning import Controller


class ControlTests(unittest.IsolatedAsyncioTestCase):
    def controller(self):
        c=Controller({'host':'bridge.local','username':'test'}, {'lights':['4','5']})
        c.dark=AsyncMock();c.bridge=Mock()
        self.controllers.append(c)
        return c

    async def asyncSetUp(self):self.controllers=[]

    async def asyncTearDown(self):
        for c in self.controllers:
            for name in ('control_task','audio_control_task','sequence_task','audio_only_task'):
                task=getattr(c,name,None)
                if task and not task.done():task.cancel()
            await asyncio.gather(*(getattr(c,n) for n in ('control_task','audio_control_task','sequence_task','audio_only_task') if getattr(c,n,None)),return_exceptions=True)

    async def lighting_idle(self,c):
        if getattr(c,'control_task',None):await c.control_task

    async def audio_ready(self,c):
        if getattr(c,'audio_control_task',None):await c.audio_control_task
        await asyncio.sleep(0)

    async def test_stop_acknowledges_then_pauses_and_cancels_sequence(self):
        c=self.controller();old=asyncio.create_task(asyncio.sleep(100));c.sequence_task=old
        reply=await dispatch(c,{'action':'stop'})
        self.assertTrue(reply['ok']);self.assertFalse(reply['motion_armed'])
        self.assertEqual(reply['state'],'stopping')
        await self.lighting_idle(c)
        self.assertTrue(old.cancelled());c.dark.assert_awaited_once()

    async def test_manual_lights_only_change_selected_bulbs(self):
        c=self.controller();await dispatch(c,{'action':'on'});await self.lighting_idle(c)
        self.assertEqual(c.health['state'],'lights_on');self.assertFalse(c.motion_armed)
        self.assertEqual([call.args[1] for call in c.bridge.request.call_args_list],['/lights/4/state','/lights/5/state'])

    async def test_flash_replaces_sequence_with_one_silent_four_second_burst(self):
        c=self.controller();old=asyncio.create_task(asyncio.sleep(100));c.sequence_task=old;c.trigger=AsyncMock()
        c.stop_sequence=AsyncMock(wraps=c.stop_sequence)
        await dispatch(c,{'action':'flash'});await self.lighting_idle(c);await c.sequence_task
        self.assertTrue(old.cancelled())
        c.stop_sequence.assert_awaited_once_with(release_stream=False,stop_audio=False)
        c.trigger.assert_awaited_once_with(c.gate,[('lightning',4)],False,origin='manual')
        self.assertFalse(c.motion_armed)

    async def test_start_restarts_instead_of_rejecting_running_sequence(self):
        c=self.controller();old=asyncio.create_task(asyncio.sleep(100));c.sequence_task=old;c.trigger=AsyncMock()
        reply=await dispatch(c,{'action':'start'});await self.lighting_idle(c);await c.sequence_task
        self.assertTrue(reply['ok']);self.assertNotIn('already running',str(reply))
        self.assertTrue(old.cancelled());c.trigger.assert_awaited_once_with(c.gate,None,True,origin='manual')

    async def test_horror_scene_start_clears_old_audio_intents(self):
        c=self.controller();c.settings['scene']='mask_reveal';c.trigger=AsyncMock()
        c.audio_only_task=asyncio.create_task(asyncio.sleep(100))
        c.pending_audio=(1, {'ids':['old']});c.sound_override=True
        c.stop_sequence=AsyncMock(wraps=c.stop_sequence)
        await dispatch(c,{'action':'start'});await self.lighting_idle(c);await c.sequence_task
        self.assertIsNone(c.pending_audio);self.assertTrue(c.audio_only_task.cancelled())
        self.assertFalse(c.sound_override)
        c.stop_sequence.assert_awaited_once_with(release_stream=False,stop_audio=True)

    async def test_latest_stop_prevents_pending_start_or_flash_from_running(self):
        c=self.controller();c.trigger=AsyncMock();entered=asyncio.Event();release=asyncio.Event()
        async def slow_stop(**_):entered.set();await release.wait()
        c.stop_sequence=AsyncMock(side_effect=slow_stop)
        await dispatch(c,{'action':'start'});await entered.wait()
        await dispatch(c,{'action':'flash'})
        reply=await asyncio.wait_for(dispatch(c,{'action':'stop'}),.1)
        self.assertEqual(reply['state'],'stopping')
        release.set();await self.lighting_idle(c)
        c.trigger.assert_not_awaited()
        self.assertFalse(c.motion_armed)

    async def test_pause_persists_and_invalid_commands_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            c=self.controller();path=Path(directory)/'controls.json';c.settings['control_state_file']=str(path)
            await dispatch(c,{'action':'arm','enabled':False});await self.lighting_idle(c)
            self.assertFalse(json.loads(path.read_text())['motion_armed'])
            self.assertEqual(path.stat().st_mode&0o777,0o600)
            for command in ({'action':'bad'}, {'action':'arm','enabled':'yes'}, {'action':'volume','value':101}):
                with self.assertRaises(ValueError):await dispatch(c,command)

    async def test_rearming_waits_for_cleanup_before_enabling_motion(self):
        c=self.controller();c.motion_armed=False
        c.audio_only_task=asyncio.create_task(asyncio.sleep(100))
        c.stop_sequence=AsyncMock(wraps=c.stop_sequence)
        reply=await dispatch(c,{'action':'arm','enabled':True})
        self.assertFalse(reply['motion_armed']);self.assertTrue(reply['requested_motion_armed'])
        await self.lighting_idle(c)
        self.assertTrue(c.motion_armed);self.assertTrue(c.audio_only_task.cancelled())
        c.stop_sequence.assert_awaited_once_with(release_stream=False,stop_audio=True)
        c.dark.assert_awaited_once()

    def sound_controller(self):
        c=self.controller();c.sonos=Mock();c.sonos.play=AsyncMock();c.sonos.close=AsyncMock()
        c.library=Mock();c.library.by_id={'a':{},'b':{}};c.library.mix=Mock(return_value=(Path('/private/mix.wav'),10))
        return c

    async def test_preview_during_lighting_does_not_cancel_the_sequence(self):
        c=self.sound_controller();c.busy=True;c.health['state']='playing'
        old=asyncio.create_task(asyncio.sleep(100));c.sequence_task=old
        reply=await dispatch(c,{'action':'play','ids':['a'],'mode':'together'})
        self.assertTrue(reply['ok']);await self.audio_ready(c)
        self.assertFalse(old.done());self.assertTrue(c.sound_override)
        self.assertEqual(c.health['state'],'playing');self.assertEqual(c.health['audio_state'],'playing')
        c.sonos.play.assert_awaited_once_with(Path('/private/mix.wav'))

    async def test_preview_replaces_previous_sound_without_stopping_lights(self):
        c=self.sound_controller();c.sequence_task=asyncio.create_task(asyncio.sleep(100))
        await dispatch(c,{'action':'play','ids':['a'],'mode':'together'});await self.audio_ready(c)
        old=c.audio_only_task
        await dispatch(c,{'action':'play','ids':['b'],'mode':'sequence'});await self.audio_ready(c)
        self.assertTrue(old.cancelled());self.assertFalse(c.sequence_task.done())
        self.assertTrue(c.sound_override)
        self.assertEqual(c.library.mix.call_args.args,(['b'],'sequence'))

    async def test_stop_invalidates_an_audio_preview_still_being_prepared(self):
        c=self.sound_controller();entered=threading.Event();release=threading.Event()
        def slow_mix(*_):entered.set();release.wait(2);return Path('/private/mix.wav'),10
        c.library.mix.side_effect=slow_mix
        await dispatch(c,{'action':'play','ids':['a'],'mode':'together'})
        await asyncio.to_thread(entered.wait,1)
        await dispatch(c,{'action':'stop'});release.set()
        await self.lighting_idle(c);await self.audio_ready(c)
        c.sonos.play.assert_not_awaited();self.assertFalse(c.sound_override)

    async def test_volume_change_survives_preview_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            c=self.sound_controller();c.sonos.config={'uid':'selected','volume':54};c.sonos.original_volume=20
            c.sonos.config_path=Path(directory)/'sonos.json';c.sonos.lock=threading.RLock()
            speaker=Mock();speaker.uid='selected';speaker.group.members=[speaker];c.sonos._resolve.return_value=speaker
            c.sequence_task=asyncio.create_task(asyncio.sleep(100))
            reply=await dispatch(c,{'action':'volume','value':67})
            self.assertEqual(reply['volume'],67);self.assertEqual(speaker.volume,67)
            self.assertEqual(c.sonos.original_volume,67);self.assertFalse(c.sequence_task.done())
            self.assertEqual(json.loads(c.sonos.config_path.read_text())['volume'],67)
