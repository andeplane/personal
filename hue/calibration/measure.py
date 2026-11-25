#!/usr/bin/env python3
"""Estimate Sonos file-start delay from a private microphone capture and source WAV."""
from array import array
import argparse
import json
import math
import sys
import wave


def envelope(path):
    with wave.open(str(path), 'rb') as reader:
        if reader.getsampwidth() != 2 or reader.getnchannels() != 1:
            raise ValueError('Expected mono 16-bit PCM WAV')
        rate = reader.getframerate()
        samples = array('h', reader.readframes(reader.getnframes()))
    if sys.byteorder != 'little':samples.byteswap()
    size = rate // 100
    return [math.sqrt(sum(x*x for x in samples[i:i+size])/size)
            for i in range(0,len(samples)-size+1,size)]


def match(recording, source):
    capture, template = envelope(recording), envelope(source)
    n = len(template)
    if len(capture) < n:raise ValueError('Recording is shorter than the source clip')
    mean = sum(template)/n
    centered = [x-mean for x in template]
    norm = math.sqrt(sum(x*x for x in centered))
    if norm == 0:raise ValueError('Source is silent')
    best = (-1.0, 0)
    for offset in range(len(capture)-n+1):
        window = capture[offset:offset+n]
        m = sum(window)/n
        denom = math.sqrt(sum((x-m)**2 for x in window))*norm
        score = sum(x*y for x,y in zip(window,centered))/denom if denom else -1
        if score > best[0]:best = (score, offset/100)
    return {'correlation':round(best[0],4), 'file_start_in_recording_seconds':best[1]}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recording');parser.add_argument('source')
    parser.add_argument('--recording-start-epoch',type=float,required=True)
    parser.add_argument('--command-epoch',type=float,required=True)
    parser.add_argument('--remote-clock-offset',type=float,default=0)
    args=parser.parse_args()
    result=match(args.recording,args.source)
    result['estimated_playback_delay_seconds']=round(args.recording_start_epoch-args.remote_clock_offset+
        result['file_start_in_recording_seconds']-args.command_epoch,3)
    result['accepted']=result['correlation']>=0.65 and 0<=result['estimated_playback_delay_seconds']<=2
    result['measurement_limits']='10ms RMS windows; recorder-start and host-clock uncertainty not included'
    print(json.dumps(result))
    if not result['accepted']:raise SystemExit(2)
