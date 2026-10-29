#!/usr/bin/env python3
"""Trim CC0 thunder previews and derive flash cues from their measured RMS peaks.

Input: mono 24 kHz, 16-bit WAV files decoded with ffmpeg from the source previews.
Output: four-second WAV excerpts plus source credits and measured cue timestamps.
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_dir', type=Path)
    parser.add_argument('output_dir', type=Path)
    args = parser.parse_args()
    prepare(args.source_dir, args.output_dir)
