"""Responsive, latest-intent controls for the single Hue controller.

Socket handlers acknowledge lighting/audio actions immediately. Separate workers
finish cleanup and apply only the newest queued intent; a slow lighting handshake
never holds a global command lock or prevents Stop, volume, or sound previews.
"""
import asyncio
import contextlib
import json
from pathlib import Path


def _reply(c):
    return {'ok': True, **c.health, 'motion_armed': c.motion_armed}


def _active(task):
    return task is not None and not task.done()


def _black_now(c):
    # The owned DTLS channel can go dark before slower REST cleanup finishes.
    if getattr(c, 'area_owned', False) and c.streamer.is_connected:
        with contextlib.suppress(Exception):
            c.streamer.send_colors(c.black_commands())


def _invalidate_audio(c):
    c.audio_generation = getattr(c, 'audio_generation', 0) + 1
    c.pending_audio = None
    task = c.audio_only_task
    if _active(task):
        task.cancel()
    c.sound_override = False
    c.status(audio_state='idle')


def _queue_lighting(c, action, enabled=None):
    generation = getattr(c, 'control_generation', 0) + 1
    c.control_generation = generation
    c.pending_control = (generation, action, enabled)
    if (action in ('stop', 'off', 'on') or (action == 'arm' and not enabled)
            or (action == 'start' and c.settings.get('scene') == 'mask_reveal')):
        # Suppress a pending/active effect synchronously. The worker completes
        # release and REST off afterward, even if an old connect is draining.
        _invalidate_audio(c)
        task = c.sequence_task
        if _active(task):
            task.cancel()
        _black_now(c)
    c.status(state='starting' if action in ('start', 'flash') else 'stopping',
             last_error=None, message=None, requested_motion_armed=enabled if action == 'arm' else None)
    if not _active(getattr(c, 'control_task', None)):
        c.control_task = asyncio.create_task(_lighting_worker(c))


async def _lighting_worker(c):
    while getattr(c, 'pending_control', None) is not None:
        generation, action, enabled = c.pending_control
        c.pending_control = None
        try:
            replacing = action in ('start', 'flash')
            retain_stream = replacing or (action == 'arm' and enabled)
            await c.stop_sequence(release_stream=not retain_stream,
                                  stop_audio=not replacing or (action == 'start' and c.settings.get('scene') == 'mask_reveal'))
            if generation != c.control_generation:
                continue
            if replacing:
                c.gate.ready_at = float('inf')
                plan = [('lightning', 4)] if action == 'flash' else None
                c.status(state='starting', last_error=None)
                c.sequence_task = asyncio.create_task(c.trigger(c.gate, plan, action != 'flash', origin='manual'))
            elif action == 'on':
                if c.settings.get('scene') == 'mask_reveal':
                    from horror_scene import warm_states
                    await c.write_lights(warm_states(c.settings))
                    if generation == c.control_generation:
                        c.status(state='lights_on')
                    continue
                for identifier in c.settings['lights']:
                    if generation != c.control_generation:
                        break
                    # Do not cancel this network write halfway through. A newer
                    # Stop follows it with off, so no late "on" wins the race.
                    await c.write_lights({identifier:{'on': True, 'bri': 254, 'xy': [0.50, 0.42], 'transitiontime': 0}})
                if generation == c.control_generation:
                    c.status(state='lights_on')
            elif action == 'arm':
                c.set_armed(bool(enabled and c.health.get('requested_motion_armed') is True))
                c.status(requested_motion_armed=None)
        except asyncio.CancelledError:
            raise
        except Exception:
            c.status(state='failed', last_error='control_action_failed')


def _queue_audio(c, intent):
    generation = getattr(c, 'audio_generation', 0) + 1
    c.audio_generation = generation
    c.pending_audio = (generation, intent)
    # Hold automatic thunder immediately, including while an older preview is
    # stopping or this mix is being rendered.
    c.sound_override = True
    c.status(audio_state='preparing', audio_error=None, message=None)
    if not _active(getattr(c, 'audio_control_task', None)):
        c.audio_control_task = asyncio.create_task(_audio_worker(c))


async def _audio_worker(c):
    while getattr(c, 'pending_audio', None) is not None:
        generation, intent = c.pending_audio
        c.pending_audio = None
        try:
            await c.stop_audio()
            if generation != c.audio_generation:
                continue
            c.sound_override = True
            if 'ids' in intent:
                path, duration = await asyncio.to_thread(c.library.mix, intent['ids'], intent['mode'])
            else:
                path, duration = intent['path'], intent['duration']
            if generation != c.audio_generation:
                continue
            c.audio_only_task = asyncio.create_task(_play_audio(c, generation, path, duration))
        except asyncio.CancelledError:
            raise
        except Exception:
            if generation == c.audio_generation:
                c.sound_override = False
                c.status(audio_state='failed', audio_error='sound_playback_failed')


async def _play_audio(c, generation, path, duration):
    try:
        await c.sonos.play(path)
        if generation == c.audio_generation:
            c.status(audio_state='playing')
        await asyncio.sleep(duration + 1)
    except asyncio.CancelledError:
        raise
    except Exception:
        if generation == c.audio_generation:
            c.status(audio_state='failed', audio_error='sound_playback_failed')
    finally:
        with contextlib.suppress(Exception):
            await c.sonos.close()
        if generation == c.audio_generation:
            c.sound_override = False
            if c.health.get('audio_state') != 'failed':
                c.status(audio_state='idle')


def _set_volume(c, value):
    with c.sonos.lock:
        speaker = c.sonos._resolve()
        if speaker.uid != c.sonos.config['uid'] or len(speaker.group.members) != 1:
            raise ValueError('Speaker identity/group changed')
        speaker.volume = value
        c.sonos.config['volume'] = value
        # Ending our preview must preserve an explicit slider adjustment.
        if c.sonos.original_volume is not None:
            c.sonos.original_volume = value
        path = Path(c.sonos.config_path)
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(c.sonos.config))
        temp.chmod(0o600)
        temp.replace(path)


async def dispatch(c, command):
    if not isinstance(command, dict):
        raise ValueError('A command object is required')
    action = command.get('action')
    if action == 'status':
        return _reply(c)
    if action == 'library':
        page = c.activity_log.page() if c.activity_log else {'activity': [], 'activity_more': False}
        return {**_reply(c), 'clips': c.library.listing() if c.library else [], **page}
    if action == 'events':
        before = command.get('before')
        page = c.activity_log.page(before) if c.activity_log else {'activity': [], 'activity_more': False}
        return {**_reply(c), **page}
    if action in ('start', 'flash', 'stop', 'off', 'on'):
        c.set_armed(False)
        _queue_lighting(c, action)
    elif action == 'arm':
        enabled = command.get('enabled')
        if not isinstance(enabled, bool):
            raise ValueError('enabled must be a boolean')
        # Keep actual motion paused until cleanup finishes. The pending value
        # lets the UI show the desired switch position without arming early.
        c.set_armed(False)
        _queue_lighting(c, action, enabled)
    elif action == 'play':
        if not c.library or not c.sonos:
            raise ValueError('Sound library is not enabled')
        ids, mode = command.get('ids'), command.get('mode')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 4 or mode not in ('together', 'sequence'):
            raise ValueError('Choose one to four sounds and a valid mix mode')
        if any(not isinstance(i, str) or i not in c.library.by_id for i in ids):
            raise ValueError('Unknown sound')
        c.set_armed(False)
        c.status(requested_motion_armed=None)
        _queue_audio(c, {'ids': ids, 'mode': mode})
    elif action == 'thunder':
        if not c.sonos or not c.settings.get('audio_enabled'):
            raise ValueError('Sonos is not enabled')
        from lightning import load_soundtracks
        catalog = load_soundtracks(c.settings['thunder_catalog'])
        c.set_armed(False)
        c.status(requested_motion_armed=None)
        _queue_audio(c, {'path': catalog[0]['audio_file'], 'duration': catalog[0].get('audio_duration', catalog[0]['duration'])})
    elif action == 'volume':
        value = command.get('value')
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
            raise ValueError('Volume must be 0–100')
        if not c.sonos:
            raise ValueError('Sonos is not configured')
        await asyncio.to_thread(_set_volume, c, value)
        c.status(volume=value)
    else:
        raise ValueError('Unknown control action')
    return _reply(c)
