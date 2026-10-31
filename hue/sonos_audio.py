"""Play the prepared thunder files on one explicitly selected, ungrouped Sonos."""
import asyncio
import json
import ipaddress
import threading
from pathlib import Path
from urllib.parse import quote, urlparse

from soco import SoCo, discover, config

config.REQUEST_TIMEOUT = 3


class SonosAudio:
    def __init__(self, config_path):
        self.config_path = Path(config_path)
        self.config = json.loads(self.config_path.read_text())
        if not 0 <= self.config['volume'] <= 100:
            raise ValueError('Use a Sonos volume between 0 and 100.')
        parsed = urlparse(self.config['url_base'])
        try:
            local_http = parsed.scheme == 'http' and ipaddress.ip_address(parsed.hostname).is_private and not ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            local_http = False
        if (parsed.scheme != 'https' and not local_http) or parsed.username or parsed.password or not parsed.hostname:
            raise ValueError('Audio needs HTTPS or an explicit private LAN address.')
        self.speaker = None
        self.original_volume = None
        self.last_uri = None
        self.lock = threading.RLock()
        self.library = None

    def _resolve(self):
        if self.speaker is not None:
            return self.speaker
        candidate = SoCo(self.config['host'])
        try:
            matches = candidate.uid == self.config['uid']
        except Exception:
            matches = False
        if not matches:
            candidate = next((p for p in discover(timeout=4) or [] if p.uid == self.config['uid']), None)
            if candidate is None:
                raise ConnectionError('The selected Sonos is unavailable.')
        self.speaker = candidate
        return candidate

    def _play(self, path):
        with self.lock:
            self._play_locked(path)

    def _play_locked(self, path):
        path = Path(path)
        if path.name not in ('close-crack.wav', 'rolling-crack.wav') and not (self.library and self.library.files.get(path.name) == path):
            raise ValueError('Only registered sound files may be played.')
        speaker = self._resolve()
        if speaker.uid != self.config['uid'] or len(speaker.group.members) != 1:
            raise ValueError('The selected Sonos identity or grouping changed.')
        state = speaker.get_current_transport_info()['current_transport_state']
        if state == 'PLAYING':
            current = speaker.get_current_track_info().get('uri')
            if current != self.last_uri:
                raise ValueError('Sonos is playing other audio; thunder skipped.')
        if self.original_volume is None:
            self.original_volume = speaker.volume
        speaker.volume = self.config['volume']
        uri = self.config['url_base'].rstrip('/') + '/' + quote(path.name)
        speaker.play_uri(uri, title='Halloween thunder')
        self.last_uri = uri

    async def play(self, path):
        await asyncio.to_thread(self._play, path)

    def _close(self):
        with self.lock:
            try:
                self._close_locked()
            finally:
                self.original_volume = None
                self.last_uri = None

    def _close_locked(self):
        if self.speaker is None or self.last_uri is None:
            return
        speaker = self.speaker
        # Do not stop new music or change a regrouped speaker during cleanup.
        if speaker.uid != self.config['uid'] or len(speaker.group.members) != 1:
            return
        current = speaker.get_current_track_info().get('uri')
        if current != self.last_uri:
            return
        if speaker.get_current_transport_info()['current_transport_state'] == 'PLAYING':
            speaker.stop()
        if self.original_volume is not None and speaker.volume == self.config['volume']:
            speaker.volume = self.original_volume
        self.last_uri = None

    async def close(self):
        await asyncio.to_thread(self._close)


def audio_starts(plan):
    offset = 0.0
    for index, (mode, duration) in enumerate(plan):
        if mode == 'lightning':
            yield index, offset
        offset += duration


async def play_timeline(plan, tracks, start, lead_seconds, play, clock):
    if not 0 <= lead_seconds <= 2:
        raise ValueError('Playback lead must be between zero and two seconds.')
    for index, offset in audio_starts(plan):
        audio = tracks.get(index)
        if audio:
            await asyncio.sleep(max(0, start + offset - lead_seconds - clock()))
            await play(audio)
