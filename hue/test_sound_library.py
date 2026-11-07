import array
import asyncio
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import wave
from sound_library import SoundLibrary, read_pcm, RATE


class MixTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        clips=[]
        for ident,value,frames in [('a',24000,240),('b',12000,480)]:
            path=self.root/(ident+'.wav')
            with wave.open(str(path),'wb') as wav:
                wav.setparams((1,2,RATE,0,'NONE','not compressed'))
                wav.writeframes(array.array('h',[value]*frames).tobytes())
            clips.append(dict(id=ident,name=ident,category='Test',duration=frames/RATE,file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        (self.root/'catalog.json').write_text(json.dumps({'clips':clips}))
        self.library=SoundLibrary(self.root/'catalog.json',self.root/'cache')

    def tearDown(self):self.temp.cleanup()

    def test_overlay_normalizes_without_clipping_and_keeps_timeline(self):
        path,duration=self.library.mix(['a','b'],'together')
        pcm=read_pcm(path)
        self.assertEqual(len(pcm),480)
        self.assertEqual(pcm[0],30000)
        self.assertEqual(pcm[-1],10000)
        self.assertEqual(duration,.02)

    def test_sequence_preserves_order_and_bounds_cache(self):
        first,_=self.library.mix(['a'],'together')
        path,_=self.library.mix(['a','b'],'sequence')
        pcm=read_pcm(path)
        self.assertEqual(len(pcm),720)
        self.assertEqual(pcm[239],24000)
        self.assertEqual(pcm[240],12000)
        self.assertFalse(first.exists())
        self.assertNotIn(first.name,self.library.files)

    def test_invalid_selection_and_tampering_are_rejected(self):
        for ids,mode in [([], 'together'),(['a']*5,'together'),(['../secret'],'together'),(['a'],'unknown')]:
            with self.assertRaises(ValueError):self.library.mix(ids,mode)
        (self.root/'a.wav').write_bytes(b'changed')
        with self.assertRaises(ValueError):SoundLibrary(self.root/'catalog.json',self.root/'cache')

    async def test_http_serves_only_registered_audio(self):
        await self.library.serve('127.0.0.1',0)
        try:
            port=self.library.runner.sites.copy().pop()._server.sockets[0].getsockname()[1]
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.get(f'http://127.0.0.1:{port}/audio/a.wav') as response:
                    self.assertEqual(response.status,200)
                    self.assertEqual(await response.read(),(self.root/'a.wav').read_bytes())
                for path in ('catalog.json','secret.json','../catalog.json'):
                    async with session.get(f'http://127.0.0.1:{port}/audio/{path}') as response:
                        self.assertEqual(response.status,404)
        finally:await self.library.close()


class BundledLibraryTests(unittest.TestCase):
    def test_audition_pack_contains_requested_counts_and_verified_pcm(self):
        from collections import Counter
        with tempfile.TemporaryDirectory() as cache:
            library=SoundLibrary(Path(__file__).parent/'sounds/catalog.json',cache)
            counts=Counter(c['category'] for c in library.clips)
            self.assertGreaterEqual(counts['Thunder'],11)
            self.assertGreaterEqual(counts['Scream'],11)
            self.assertTrue(all(c['license']=='CC0-1.0' for c in library.clips))
            self.assertEqual(len({c['sha256'] for c in library.clips}),len(library.clips))
            self.assertIn('heavy-close',library.by_id)
            self.assertGreater(library.by_id['deep-rolling'][0]['duration'],10)
            self.assertFalse({'human-scream','horror-scream'}.intersection(library.by_id))
            self.assertEqual({c['file'] for c in library.clips},
                             {p.name for p in (Path(__file__).parent/'sounds').glob('*.wav')})
            for clip in library.clips:
                pcm=read_pcm(library.by_id[clip['id']][1])
                self.assertAlmostEqual(clip['duration'],len(pcm)/RATE,places=6)
                self.assertLessEqual(max(map(abs,pcm)),30000)
                self.assertTrue(clip['source'].startswith('https://freesound.org/people/'))
                self.assertEqual(clip['license_url'],'https://creativecommons.org/publicdomain/zero/1.0/')
                if 'preview_url' in clip:
                    self.assertEqual(len(clip['preview_sha256']),64)
                    self.assertEqual(len(clip['source_html_sha256']),64)


class BuilderCacheTests(unittest.TestCase):
    def test_offline_rebuild_requires_exact_verified_input(self):
        from build_sound_library import prepare_source
        source=('test','Test','Scream','author','123')
        url='https://freesound.org/people/author/sounds/123/'
        with tempfile.TemporaryDirectory() as directory:
            cache=Path(directory)
            mp3=cache/'123.mp3';mp3.write_bytes(b'verified fixture')
            prior=dict(source=url,preview_url='https://cdn.freesound.org/previews/0/123-hq.mp3',
                       preview_sha256=hashlib.sha256(mp3.read_bytes()).hexdigest(),source_html_sha256='a'*64)
            path,provenance=prepare_source(source,cache,[prior],offline=True)
            self.assertEqual(path,mp3)
            self.assertEqual(provenance['preview_sha256'],prior['preview_sha256'])
            mp3.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'cached input changed'):
                prepare_source(source,cache,[prior],offline=True)
            with self.assertRaisesRegex(ValueError,'verified cached input'):
                prepare_source(source,cache,[],offline=True)


class FullThunderTests(unittest.TestCase):
    def test_full_tracks_preserve_tail_and_first_four_second_cues(self):
        from prepare_recorded_thunder import rms_windows
        root=Path(__file__).parent
        catalog=json.loads((root/'audio/full/catalog.json').read_text())
        sources={clip['id']:clip for clip in json.loads((root/'sounds/catalog.json').read_text())['clips']}
        self.assertGreaterEqual(len(catalog),4)
        for item in catalog:
            path=root/'audio/full'/item['file']
            self.assertEqual(path.name,item['file'])
            self.assertTrue(item['file'].startswith('storm-'))
            self.assertNotIn(item['file'],{clip['file'] for clip in sources.values()})
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),item['sha256'])
            pcm=read_pcm(path)
            self.assertAlmostEqual(len(pcm)/RATE,item['audio_duration'],places=6)
            self.assertGreaterEqual(item['audio_duration'],8)
            self.assertLessEqual(item['audio_duration'],11.5)
            self.assertEqual(item['cue_duration'],4)
            self.assertEqual(item['license'],'CC0-1.0')
            self.assertEqual(item['input_preview_sha256'],sources[item['id']]['preview_sha256'])
            self.assertLessEqual(max(map(abs,pcm)),30000)
            self.assertLessEqual(abs(pcm[-1]),1)
            envelope=rms_windows(pcm[:4*RATE],RATE)
            self.assertTrue(4<=len(item['strikes'])<=6)
            self.assertEqual(len(item['strikes']),len(item['audio_peak_seconds']))
            for (start,end,level),peak in zip(item['strikes'],item['audio_peak_seconds']):
                self.assertTrue(0<=start<peak<end<=4)
                self.assertTrue(0<level<=1)
                index=round(peak*50)
                self.assertGreaterEqual(envelope[index],envelope[index-1])
                self.assertGreater(envelope[index],envelope[index+1])
