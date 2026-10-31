#!/usr/bin/env python3
"""Rebuild normalized CC0 sound-library excerpts from publisher HQ previews.

Requires ffmpeg. Downloads stay in the private user cache. Existing inputs are
checksum-verified and reused; --refresh verifies current publisher pages and
redownloads, while --offline refuses all network access.
"""
import argparse
import array
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
import wave

RATE = 24000
ROOT = Path(__file__).resolve().parent
SOURCES = [
    ('witch-laugh', 'Witch laugh', 'Laugh', 'NikoMyth', '348142'),
    ('evil-laugh-deep', 'Evil laugh · deep', 'Laugh', 'ckvoiceover', '401332'),
    ('villain-cackle', 'Villain cackle', 'Laugh', 'el_boss', '650618'),
    ('demonic-chuckle', 'Demonic chuckle', 'Laugh', 'scorpion67890', '169317'),
    ('sinister-laugh', 'Sinister laugh', 'Laugh', 'pepv', '212579'),
    ('cartoon-villain-laugh', 'Cartoon-villain laugh', 'Laugh', 'riippumattog', '704363'),
    ('haunted-laugh', 'Haunted laugh', 'Laugh', 'tchild', '319766'),
    ('ghost-howl', 'Ghost howl', 'Ghost', 'JanIsAGuy', '432778'),
    ('monster-scream', 'Monster scream', 'Scream', 'Marvin_Chiriguaya', '705784'),
    ('jump-scream', 'Jumpscare scream', 'Scream', 'Breviceps', '587354'),
    ('scream', 'Scream', 'Scream', 'Volonda', '439517'),
    ('short-scream', 'Short human scream', 'Scream', 'claracarpintero', '219856'),
    ('ghost-scream', 'Ghost scream', 'Scream', 'MikkyLachae', '259264'),
    ('high-scream', 'High-pitched scream', 'Scream', 'Topschool', '360464'),
    ('startled-scream', 'Startled shout', 'Scream', 'SamsterBirdies', '343768'),
    ('deep-short', 'Deep thunder · short', 'Thunder', 'SholeColtis', '683420'),
    ('deep-rolling', 'Deep thunder · rolling', 'Thunder', 'SholeColtis', '683419'),
    ('deep-long', 'Deep thunder · long', 'Thunder', 'SholeColtis', '683417'),
    ('deep-long-2', 'Deep thunder · long 2', 'Thunder', 'SholeColtis', '683418'),
    ('mid-short', 'Mid thunder · short', 'Thunder', 'SholeColtis', '683421'),
    ('bass-rumble', 'Very low bass rumble', 'Thunder', 'BlueDelta', '367223'),
    ('heavy-close', 'Heavy close thunderclap', 'Thunder', 'Pingel', '2689'),
    ('close-strike', 'Close lightning strike', 'Thunder', 'guitarguy1985', '87963'),
    ('loud-rumble', 'Loud rumbling clap', 'Thunder', 'Josh74000MC', '477839'),
    ('sharp-crack', 'Sharp thunder crack', 'Thunder', 'Fission9', '476228'),
    ('loud-storm', 'Loud thunderclaps', 'Thunder', 'Rvgerxini', '620529'),
    ('pained-shout', 'Pained shout', 'Scream', 'Guy110', '353189'),
    ('long-male-scream', 'Long male scream', 'Scream', 'ihitokage', '656064'),
]
REJECTED_IDS = frozenset(('human-scream', 'horror-scream'))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def prepare_source(source, cache, previous, offline=False, refresh=False):
    ident, _, _, author, number = source
    url = f'https://freesound.org/people/{author}/sounds/{number}/'
    mp3 = cache / (number + '.mp3')
    prior = next((c for c in previous if c.get('source') == url and c.get('preview_sha256')), None)
    if prior and mp3.exists() and not refresh:
        if sha256(mp3) != prior['preview_sha256']:
            raise ValueError(f'{ident}: cached input changed; use --refresh to redownload')
        return mp3, {key: prior[key] for key in ('preview_url', 'preview_sha256', 'source_html_sha256')}
    if offline:
        raise ValueError(f'{ident}: a verified cached input is required for --offline')
    html_bytes = fetch(url)
    html = html_bytes.decode()
    if 'creativecommons.org/publicdomain/zero' not in html:
        raise ValueError(f'{ident}: publisher page does not identify the sound as CC0')
    found = re.search(r'https://cdn\.freesound\.org/previews/[^\s\"<>]+-hq\.mp3', html)
    if not found:
        raise ValueError(f'{ident}: publisher HQ preview was not found')
    preview = found.group(0)
    download = mp3.with_suffix('.download')
    download.write_bytes(fetch(preview))
    download.replace(mp3)
    return mp3, {
        'preview_url': preview,
        'preview_sha256': sha256(mp3),
        'source_html_sha256': hashlib.sha256(html_bytes).hexdigest(),
    }


def read_source(mp3, wav):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(mp3), '-ar', str(RATE),
                    '-ac', '1', '-c:a', 'pcm_s16le', str(wav)], check=True)
    with wave.open(str(wav)) as reader:
        samples = array.array('h', reader.readframes(reader.getnframes()))
    if sys.byteorder != 'little':
        samples.byteswap()
    if not samples:
        raise ValueError('Empty audio source')
    return samples


def excerpts(ident, category, data):
    limit = (30 if category == 'Thunder' else 8) * RATE
    start = 0
    if len(data) > limit:
        block = RATE // 10
        energies = [sum(x*x for x in data[i:i+block]) for i in range(0, len(data), block)]
        peak_block = max(range(len(energies)), key=energies.__getitem__)
        start = max(0, min(peak_block*block-RATE, len(data)-limit))
    if ident != 'scream':
        return [(start, min(len(data), start+limit))]
    # Separate acted vocal phrases by RMS and silence, retaining source offsets.
    blocks = [sum(x*x for x in data[i:i+1200])/1200 for i in range(0, len(data), 1200)]
    active = [i for i, value in enumerate(blocks) if value > max(blocks)*.012]
    groups = []
    for index in active:
        if not groups or index-groups[-1][-1] > 8:
            groups.append([])
        groups[-1].append(index)
    ranges = [(max(0, group[0]*1200-2400),
               min(len(data), (group[-1]+1)*1200+4800, group[0]*1200+8*RATE))
              for group in groups if len(group) > 5][:3]
    if len(ranges) != 3:
        raise ValueError('Expected three separate scream phrases; review the source before publishing')
    return ranges


def write_excerpt(path, data, category):
    peak = max(abs(x) for x in data) or 1
    target_peak = 30000 if category == 'Thunder' else 24000
    samples = array.array('h', (round(x*target_peak/peak) for x in data))
    for index in range(min(240, len(samples)//2)):
        samples[index] = round(samples[index]*index/240)
        samples[-1-index] = round(samples[-1-index]*index/240)
    if sys.byteorder != 'little':
        samples.byteswap()
    with wave.open(str(path), 'wb') as writer:
        writer.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        writer.writeframes(samples.tobytes())


def build(root=ROOT, cache=None, offline=False, refresh=False):
    if offline and refresh:
        raise ValueError('--offline and --refresh cannot be combined')
    out = root / 'sounds'
    out.mkdir(exist_ok=True)
    cache = cache or Path.home()/'.config/hue-halloween/downloads'
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    catalog = out / 'catalog.json'
    previous = json.loads(catalog.read_text())['clips'] if catalog.exists() else []
    with ThreadPoolExecutor(max_workers=4) as pool:
        inputs = list(pool.map(lambda source: prepare_source(source, cache, previous, offline, refresh), SOURCES))
    clips = []
    for source, (mp3, provenance) in zip(SOURCES, inputs):
        ident, name, category, author, number = source
        data = read_source(mp3, cache/(number+'.wav'))
        for index, (start, end) in enumerate(excerpts(ident, category, data)):
            suffix = f'-{index+1}' if ident == 'scream' else ''
            key = ident+suffix
            target = out/(key+'.wav')
            write_excerpt(target, data[start:end], category)
            clips.append(dict(id=key, name=name+(f' {index+1}' if suffix else ''), category=category,
                              file=target.name, duration=(end-start)/RATE,
                              source=f'https://freesound.org/people/{author}/sounds/{number}/',
                              author=author, license='CC0-1.0', license_url='https://creativecommons.org/publicdomain/zero/1.0/',
                              source_offset_seconds=start/RATE, sha256=sha256(target), **provenance))
    originals = json.loads((root/'audio/catalog.json').read_text())
    for ident, name in [('close-crack', 'Close thunder'), ('rolling-crack', 'Rolling thunder')]:
        target = out/(ident+'.wav')
        original = next(c for c in originals if c['file'] == target.name)
        shutil.copyfile(root/'audio'/target.name, target)
        clips.append(dict(id=ident, name=name, category='Thunder', file=target.name, duration=4,
                          license='CC0-1.0', license_url=original['license_url'], source=original['source'],
                          author=original['author'], source_offset_seconds=original['source_excerpt_start'],
                          sha256=sha256(target), input_wav_sha256=original['input_wav_sha256']))
    priority = {'heavy-close': 0, 'close-strike': 1, 'bass-rumble': 2, 'deep-rolling': 3}
    clips.sort(key=lambda clip: (0 if clip['category'] == 'Thunder' else 1,
                                priority.get(clip['id'], 10), clip['name']))
    if REJECTED_IDS.intersection(c['id'] for c in clips):
        raise ValueError('Rejected sounds cannot be restored')
    temp = catalog.with_suffix('.tmp')
    temp.write_text(json.dumps({'version': 1, 'clips': clips}, indent=2)+'\n')
    temp.replace(catalog)
    # This directory is generated. Remove stale assets so rejected clips cannot linger.
    allowed = {clip['file'] for clip in clips}
    for stale in out.glob('*.wav'):
        if stale.name not in allowed:
            stale.unlink()
    return clips


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    clips = build(offline=args.offline, refresh=args.refresh)
    print([(c['id'], round(c['duration'], 2)) for c in clips])
