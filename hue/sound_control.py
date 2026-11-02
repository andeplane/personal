"""Persistent, explicit sound policy shared by desktop and mobile controls."""
import json
from pathlib import Path


def restore_sound(c, saved):
    # Each overnight schedule is a new silent session. A previous day's ON
    # preference cannot unmute it. Explicitly enabling sound acknowledges this
    # session and cancels its timer; that choice then survives a restart.
    night = c.overnight
    if night and saved.get('audio_overnight_until') != night.data['until']:
        c.settings['audio_enabled'] = False
    elif isinstance(saved.get('audio_enabled'), bool):
        c.settings['audio_enabled'] = saved['audio_enabled']


def save_controls(c):
    if not c.settings.get('control_state_file'):
        return
    path = Path(c.settings['control_state_file'])
    data = {'motion_armed':c.motion_armed, 'idle_glow_enabled':c.idle_glow_enabled,
            'audio_enabled':bool(c.settings.get('audio_enabled', False))}
    if c.overnight:
        data['audio_overnight_until'] = c.overnight.data['until']
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data))
    temporary.chmod(0o600)
    temporary.replace(path)


async def set_sound(c, enabled):
    if not isinstance(enabled, bool):
        raise ValueError('enabled must be a boolean')
    if enabled and c.sonos is None:
        if c.settings.get('audio_backend') != 'sonos' or not c.settings.get('sonos_config'):
            raise ValueError('Sonos is not configured')
        from sonos_audio import SonosAudio
        c.sonos = SonosAudio(c.settings['sonos_config'])
        c.sonos.library = c.library
        c.sonos.sound_allowed = lambda: bool(c.settings.get('audio_enabled', False))
        c.health['volume'] = c.sonos.config['volume']
    old = c.settings.get('audio_enabled', False)
    c.settings['audio_enabled'] = enabled
    try:
        save_controls(c)
    except OSError:
        c.settings['audio_enabled'] = old
        raise
    if enabled and c.overnight and c.overnight.enabled:
        c.overnight.stop(c, 'Silent schedule cancelled: sound explicitly enabled')
    if not enabled:
        # Lighting carries on; invalidate prepared previews before closing any
        # audio already playing. Only this controller's Sonos URI is stopped.
        from control_actions import _invalidate_audio
        _invalidate_audio(c)
        await c.stop_audio()
        if c.sonos:
            await c.sonos.close()
    c.status(audio_enabled=enabled, audio_error=None)
    c.activity('sound', 'Sound enabled for scenes and previews' if enabled else 'Sound off: lights only', source='manual')
