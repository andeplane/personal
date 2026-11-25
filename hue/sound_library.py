"""CC0 clip library, bounded PCM mixer, and an allowlisted LAN media endpoint."""
import array
import hashlib
import json
from pathlib import Path
import wave
from aiohttp import web

RATE = 24000


def read_pcm(path):
    with wave.open(str(path)) as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, RATE):
            raise ValueError('Expected mono 24 kHz 16-bit PCM')
        if not 0 < wav.getnframes() <= RATE * 120:
            raise ValueError('Sound duration out of bounds')
        return array.array('h', wav.readframes(wav.getnframes()))


class SoundLibrary:
    def __init__(self, catalog, cache):
        catalog = Path(catalog)
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.clips = json.loads(catalog.read_text())['clips']
        self.files = {}
        self.by_id = {}
        for clip in self.clips:
            path = catalog.parent / clip['file']
            if path.name != clip['file'] or path.suffix != '.wav':
                raise ValueError('Invalid sound filename')
            if hashlib.sha256(path.read_bytes()).hexdigest() != clip['sha256']:
                raise ValueError('Sound checksum mismatch')
            samples = read_pcm(path)
            if len(samples) > RATE * 30:
                raise ValueError('Clip too long')
            self.files[path.name] = path
            self.by_id[clip['id']] = (clip, path)
        self.runner = None

    def listing(self):
        return [{k: c[k] for k in ('id', 'name', 'category', 'duration')} for c in self.clips]

    def mix(self, ids, mode):
        if mode not in ('together', 'sequence') or not isinstance(ids, list) or not 1 <= len(ids) <= 4:
            raise ValueError('Choose one to four sounds and a valid mix mode')
        if any(not isinstance(i, str) or i not in self.by_id for i in ids):
            raise ValueError('Unknown sound')
        tracks = [read_pcm(self.by_id[i][1]) for i in ids]
        size = max(map(len, tracks)) if mode == 'together' else sum(map(len, tracks))
        mixed = [0] * size
        offset = 0
        for track in tracks:
            for index, sample in enumerate(track):
                mixed[offset + index] += sample
            if mode == 'sequence':
                offset += len(track)
        peak = max(map(abs, mixed)) or 1
        gain = min(1, 30000 / peak)
        pcm = array.array('h', (round(x * gain) for x in mixed))
        digest = hashlib.sha256(pcm.tobytes()).hexdigest()
        path = self.cache / ('mix-' + digest + '.wav')
        # Bounded cache; selected file remains available until the next command.
        for old in self.cache.glob('mix-*.wav'):
            if old != path:
                self.files.pop(old.name, None)
                old.unlink()
        if not path.exists():
            with wave.open(str(path), 'wb') as wav:
                wav.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
                wav.writeframes(pcm.tobytes())
        self.files[path.name] = path
        return path, size / RATE

    async def serve(self, host, port):
        async def sound(request):
            path = self.files.get(request.match_info['name'])
            if path is None or not path.is_file():
                raise web.HTTPNotFound()
            return web.FileResponse(path, headers={'Content-Type': 'audio/wav'})
        app = web.Application()
        app.router.add_get('/audio/{name}', sound)
        self.runner = web.AppRunner(app, access_log=None)
        await self.runner.setup()
        try:
            await web.TCPSite(self.runner, host, port).start()
        except BaseException:
            await self.runner.cleanup()
            raise

    async def close(self):
        if self.runner:
            await self.runner.cleanup()
