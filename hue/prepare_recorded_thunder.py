#!/usr/bin/env python3
"""Trim CC0 thunder previews and derive flash cues from their measured RMS peaks.

Input: mono 24 kHz, 16-bit WAV files decoded with ffmpeg from the source previews.
Default output: four-second WAV excerpts plus measured flash cues.
--full-library input: verified sound-library HQ MP3 cache. Its output retains
8–11.5 seconds of natural rumble with an independent four-second cue window.
"""
from array import array
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import wave

SOURCES = {
    'close-crack': {'title': 'thunder crack.wav', 'author': 'cognito perceptu',
                    'source': 'https://freesound.org/people/cognito%20perceptu/sounds/347853/'},
    'rolling-crack': {'title': 'rayjensen - thunder-crack 41k 16bit mono.wav', 'author': 'rayjensen',
                      'source': 'https://freesound.org/people/rayjensen/sounds/200990/'},
}


def rms_windows(samples, rate):
    size = rate // 50
    return [math.sqrt(sum(s*s for s in samples[i:i+size]) / len(samples[i:i+size]))
            for i in range(0, len(samples), size)]


def prepare(source_dir, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    catalog = []
    for name, credit in SOURCES.items():
        original = source_dir / (name + '.wav')
        with wave.open(str(original), 'rb') as reader:
            if (reader.getnchannels(), reader.getsampwidth(), reader.getframerate()) != (1, 2, 24000):
                raise ValueError('Expected mono 24 kHz 16-bit WAV input.')
            samples = array('h', reader.readframes(reader.getnframes()))
        if sys.byteorder != 'little':
            samples.byteswap()
        envelope = rms_windows(samples, 24000)
        onset = next(i / 50 for i, value in enumerate(envelope) if value >= max(envelope) * 0.3)
        start = max(0, onset - 0.5)
        excerpt = samples[int(start*24000):int(start*24000)+96000]
        excerpt.extend([0] * (96000 - len(excerpt)))
        peak = max(abs(s) for s in excerpt)
        for i in range(len(excerpt)):
            t = i / 24000
            fade = min(1, t / 0.01, (4-t) / 0.25)
            excerpt[i] = int(excerpt[i] / peak * 23000 * fade)
        envelope = rms_windows(excerpt, 24000)
        candidates = [i for i in range(6, 189)
                      if envelope[i] >= envelope[i-1] and envelope[i] >= envelope[i+1]]
        peaks = []
        for i in sorted(candidates, key=lambda i: envelope[i], reverse=True):
            if envelope[i] < max(envelope)*0.2:
                continue
            if all(abs(i-j) >= 25 for j in peaks):
                peaks.append(i)
            if len(peaks) == 4:
                break
        if not peaks:
            raise ValueError('No usable thunder peaks.')
        peaks.sort()
        cues = [[round(i/50-0.1, 3), round(i/50+0.06, 3),
                 round(max(0.45, envelope[i]/max(envelope)), 3)] for i in peaks]
        if sys.byteorder != 'little':
            excerpt.byteswap()
        dest = output_dir / (name + '.wav')
        with wave.open(str(dest), 'wb') as writer:
            writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(24000)
            writer.writeframes(excerpt.tobytes())
        catalog.append({**credit, 'license': 'CC0-1.0',
                        'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/',
                        'file': dest.name, 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(),
                        'duration': 4, 'source_excerpt_start': round(start, 3),
                        'input_wav_sha256': hashlib.sha256(original.read_bytes()).hexdigest(),
                        'audio_peak_seconds': [i/50 for i in peaks], 'strikes': cues,
                        'processing': 'Public HQ MP3 preview decoded to mono 24kHz PCM; trimmed, peak-normalized and faded. Flash cues lead measured 20ms RMS peaks by 100ms.'})
    (output_dir / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
    for item in catalog:
        print(item['file'], 'sound peaks:', item['audio_peak_seconds'])


FULL_LIBRARY_IDS = ('heavy-close', 'close-strike', 'deep-long', 'deep-rolling', 'loud-rumble')


def prepare_full(source_dir, output_dir, library_catalog=None):
    """Keep natural thunder tails while exposing only the first 4s as flash cues.

    source_dir contains checksum-verified HQ MP3 inputs from build_sound_library.
    Existing four-second automatic clips are deliberately left unchanged.
    """
    import subprocess
    library_catalog = library_catalog or Path(__file__).parent/'sounds/catalog.json'
    library = {clip['id']: clip for clip in json.loads(library_catalog.read_text())['clips']}
    output_dir.mkdir(parents=True, exist_ok=True)
    catalog = []
    for ident in FULL_LIBRARY_IDS:
        source = library[ident]
        if source.get('license') != 'CC0-1.0':
            raise ValueError('Full thunder sources must be verified CC0 recordings')
        number = source['source'].strip('/').split('/')[-1]
        original = source_dir/(number+'.mp3')
        if hashlib.sha256(original.read_bytes()).hexdigest() != source['preview_sha256']:
            raise ValueError('Full thunder input checksum changed')
        decoded = source_dir/(number+'-full-input.wav')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(original),
                        '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(decoded)], check=True)
        with wave.open(str(decoded), 'rb') as reader:
            samples = array('h', reader.readframes(reader.getnframes()))
        if sys.byteorder != 'little':
            samples.byteswap()
        envelope = rms_windows(samples, 24000)
        onset = next(i/50 for i, value in enumerate(envelope) if value >= max(envelope)*0.15)
        # Preserve a little air before the attack. Keep up to 11.5 seconds of
        # the original recording, rather than replacing its tail with a loop.
        start_frame = int(max(0, onset-0.25)*24000)
        excerpt = samples[start_frame:start_frame+int(11.5*24000)]
        if len(excerpt) < 8*24000:
            raise ValueError('Full thunder recording must retain at least eight seconds')
        duration = len(excerpt)/24000
        peak = max(abs(value) for value in excerpt) or 1
        for i in range(len(excerpt)):
            seconds = i/24000
            fade = min(1, seconds/0.01, max(0, (duration-seconds)/1.0))
            excerpt[i] = int(excerpt[i]/peak*30000*fade)
        envelope = rms_windows(excerpt[:4*24000], 24000)
        candidates = [i for i in range(4, 196)
                      if envelope[i] >= envelope[i-1] and envelope[i] > envelope[i+1]]
        peaks = []
        for index in sorted(candidates, key=lambda i: envelope[i], reverse=True):
            if all(abs(index-other) >= 23 for other in peaks):
                peaks.append(index)
            if len(peaks) == 5:
                break
        if not 4 <= len(peaks) <= 6:
            raise ValueError('Expected four to six separate measured RMS peaks')
        peaks.sort()
        cues = [[round(max(0, i/50-0.08), 3), round(min(4, i/50+0.06), 3),
                 round(envelope[i]/max(envelope), 5)] for i in peaks]
        output = output_dir/('storm-'+ident+'.wav')
        if sys.byteorder != 'little':
            excerpt.byteswap()
        with wave.open(str(output), 'wb') as writer:
            writer.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
            writer.writeframes(excerpt.tobytes())
        catalog.append({
            'id': ident, 'title': source['name'], 'author': source['author'],
            'source': source['source'], 'license': source['license'],
            'license_url': source['license_url'], 'preview_url': source['preview_url'],
            'input_preview_sha256': source['preview_sha256'],
            'input_wav_sha256': hashlib.sha256(decoded.read_bytes()).hexdigest(),
            'file': output.name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
            'audio_duration': duration, 'cue_duration': 4,
            'source_excerpt_start': start_frame/24000,
            'audio_peak_seconds': [i/50 for i in peaks], 'strikes': cues,
            'cue_lead_seconds': 0.08,
            'processing': 'Publisher HQ MP3 preview decoded to mono 24kHz PCM. Original 8–11.5s recording excerpt retained with its natural rumble; peak normalized to 30000, 10ms onset fade, 1s tail fade. Five measured first-four-second 20ms RMS peaks supply flash cues, with 80ms cue lead. No loops or synthesized rumble.',
        })
    temp = output_dir/'catalog.tmp'
    temp.write_text(json.dumps(catalog, indent=2)+'\n')
    temp.replace(output_dir/'catalog.json')
    allowed = {item['file'] for item in catalog}
    for stale in output_dir.glob('*.wav'):
        if stale.name not in allowed:
            stale.unlink()
    return catalog


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_dir', type=Path)
    parser.add_argument('output_dir', type=Path)
    parser.add_argument('--full-library', action='store_true',
                        help='Build full-length tails from the checksum-verified sound-library source cache')
    args = parser.parse_args()
    if args.full_library:
        result = prepare_full(args.source_dir, args.output_dir)
        for item in result:
            print(item['file'], item['audio_duration'], 'seconds; sound peaks:', item['audio_peak_seconds'])
    else:
        prepare(args.source_dir, args.output_dir)
