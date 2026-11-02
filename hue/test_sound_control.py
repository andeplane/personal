import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

from lightning import Controller
from control_actions import dispatch
from overnight import Overnight, iso
from sound_control import restore_sound, save_controls


class SoundControlTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.c=Controller({'host':'bridge.local','username':'test'},
                          {'lights':['1'],'audio_enabled':True,'control_state_file':str(self.root/'controls.json')})
        self.c.sonos=Mock();self.c.sonos.close=AsyncMock()
        self.c.dark=AsyncMock()

    async def asyncTearDown(self):
        for name in ('sequence_task','audio_only_task','audio_control_task'):
            task=getattr(self.c,name,None)
            if task and not task.done():task.cancel()
        await asyncio.gather(*(getattr(self.c,n) for n in ('sequence_task','audio_only_task','audio_control_task') if getattr(self.c,n,None)),return_exceptions=True)

    async def test_sound_off_stops_audio_but_preserves_light_sequence_and_motion(self):
        c=self.c;c.motion_armed=True;c.sequence_task=asyncio.create_task(asyncio.sleep(100))
        c.audio_only_task=asyncio.create_task(asyncio.sleep(100));c.pending_audio=(1,{})
        reply=await dispatch(c,{'action':'sound','enabled':False})
        self.assertFalse(reply['audio_enabled']);self.assertTrue(reply['motion_armed'])
        self.assertFalse(c.sequence_task.done());self.assertTrue(c.audio_only_task.cancelled())
        self.assertIsNone(c.pending_audio);c.sonos.close.assert_awaited_once();c.dark.assert_not_awaited()
        saved=json.loads((self.root/'controls.json').read_text())
        self.assertFalse(saved['audio_enabled']);self.assertTrue(saved['motion_armed'])
        with self.assertRaisesRegex(ValueError,'Sound is off'):
            await dispatch(c,{'action':'play','ids':['x'],'mode':'together'})

    async def test_sound_on_and_later_arm_writes_preserve_preference(self):
        c=self.c;c.settings['audio_enabled']=False;c.motion_armed=False
        reply=await dispatch(c,{'action':'sound','enabled':True})
        self.assertTrue(reply['audio_enabled']);self.assertFalse(reply['motion_armed'])
        c.set_armed(True)
        saved=json.loads((self.root/'controls.json').read_text())
        restarted=Controller({'host':'bridge.local','username':'test'}, {'lights':['1'],'audio_enabled':False})
        restore_sound(restarted,saved)
        self.assertTrue(restarted.settings['audio_enabled'])
        self.assertEqual((self.root/'controls.json').stat().st_mode&0o777,0o600)

    async def test_explicit_on_cancels_silent_schedule_and_survives_restart(self):
        path=self.root/'night.json'
        path.write_text(json.dumps({'enabled':True,'until':iso(9999999999),'next_at':iso(9999999900)}))
        c=self.c;c.overnight=Overnight(path);c.settings['audio_enabled']=False
        await dispatch(c,{'action':'sound','enabled':True})
        self.assertFalse(c.overnight.enabled)
        restarted=Controller({'host':'bridge.local','username':'test'},
                             {'lights':['1'],'audio_enabled':False,'overnight_file':str(path)})
        restore_sound(restarted,json.loads((self.root/'controls.json').read_text()))
        self.assertTrue(restarted.settings['audio_enabled'])
        await restarted.overnight.run(restarted)
        self.assertTrue(restarted.health['audio_enabled'])

    async def test_enabling_creates_backend_without_restarting_controller(self):
        c=self.c;c.sonos=None;c.settings.update(audio_enabled=False,audio_backend='sonos',sonos_config='private-config.json')
        backend=Mock();backend.config={'volume':54}
        with patch('sonos_audio.SonosAudio',return_value=backend) as constructor:
            await dispatch(c,{'action':'sound','enabled':True})
        constructor.assert_called_once_with('private-config.json')
        self.assertIs(c.sonos,backend);self.assertTrue(backend.sound_allowed())
        c.settings['audio_enabled']=False
        self.assertFalse(backend.sound_allowed())

    async def test_new_night_does_not_reuse_old_sound_on_preference(self):
        path=self.root/'night.json'
        path.write_text(json.dumps({'enabled':True,'until':iso(9999999999),'next_at':iso(9999999900)}))
        c=self.c;c.overnight=Overnight(path)
        restore_sound(c,{'audio_enabled':True,'audio_overnight_until':'previous-night'})
        self.assertFalse(c.settings['audio_enabled'])
        save_controls(c)
        saved=json.loads((self.root/'controls.json').read_text())
        self.assertFalse(saved['audio_enabled'])
        self.assertEqual(saved['audio_overnight_until'],iso(9999999999))

    async def test_invalid_toggle_cannot_change_sound(self):
        for value in (None,1,'false'):
            with self.assertRaises(ValueError):await dispatch(self.c,{'action':'sound','enabled':value})
        self.assertTrue(self.c.settings['audio_enabled'])

    async def test_status_includes_actual_sound_policy(self):
        self.c.health['audio_enabled']=False
        self.assertTrue((await dispatch(self.c,{'action':'status'}))['audio_enabled'])
