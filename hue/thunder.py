#!/usr/bin/env python3
"""Generate a short original thunder effect in the private runtime folder."""
from array import array
import math
from pathlib import Path
import random
import sys
import wave


def generate(path):
    rate = 24000
    rng = random.Random(8913)
    low = deep = 0.0
    samples = []
    for index in range(rate * 4):
        t = index / rate
        noise = rng.uniform(-1, 1)
        low += 0.09 * (noise - low)
        deep += 0.012 * (noise - deep)
        envelope = min(t / 0.035, 1) * math.exp(-1.15 * t)
        roll = 0.65 + 0.35 * math.sin(15 * t) ** 2
        samples.append(envelope * (deep * 5 + low * 1.5 + noise * 0.05) * roll)
    peak = max(abs(s) for s in samples)
    pcm = array('h', (int(s / peak * 25000) for s in samples))
    if sys.byteorder != 'little':
        pcm.byteswap()
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(pcm.tobytes())
    path.chmod(0o600)


if __name__ == '__main__':
    generate(Path.home() / '.config/hue-halloween/thunder.wav')
    print('Prepared four-second thunder sound privately; playback is not enabled.')
