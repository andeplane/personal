#!/usr/bin/env python3
"""Measure private camera/microphone evidence for a Hue lightning test.

Requires ffmpeg, ffprobe, numpy and matplotlib on the analysing computer. Outputs
only curves and measurements, never copies camera frames into the repository.
Brightness is camera-relative, not lux: exposure, white balance and clipping can
change the measured waveform. The default fixture ROI/thresholds suit the first
M4 ceiling-camera setup; choose new values after moving the camera or lamps.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

FPS = 30
SAMPLE_RATE = 24000


def segments(mask, rate, offset=0):
    """Half-open spans, preserving one-frame pulses and gaps."""
    edges = np.diff(np.r_[False, np.asarray(mask, dtype=bool), False].astype(int))
    return [(float(a / rate + offset), float(b / rate + offset))
            for a, b in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1))]


def rms_envelope(samples, size=240):
    samples = np.asarray(samples, dtype=float)
    count = len(samples) // size
    if not count:
        return np.zeros(0)
    return np.sqrt(np.mean(samples[:count * size].reshape(count, size) ** 2, axis=1))


def pearson_windows(capture, template):
    """Gain-independent Pearson score at each possible 10 ms template origin."""
    capture = np.asarray(capture, dtype=float)
    template = np.asarray(template, dtype=float)
    n = len(template)
    if n < 2 or len(capture) < n:
        return np.zeros(0)
    centered = template - template.mean()
    norm = np.sum(centered ** 2)
    if norm == 0:
        return np.zeros(len(capture) - n + 1)
    cs = np.r_[0, np.cumsum(capture)]
    squares = np.r_[0, np.cumsum(capture ** 2)]
    variance = (squares[n:] - squares[:-n]) - (cs[n:] - cs[:-n]) ** 2 / n
    numerator = np.correlate(capture, centered, 'valid')
    return numerator / np.sqrt(np.maximum(variance, 1e-9) * norm)



def detect_intensity_pulses(luma, fps=FPS):
    """Detect reflected-light rises without a fixed white-balance threshold.

    A one-second median estimates the drifting background. Pulse width is then
    measured against the *pre-rise* background, not the moving median: a held
    light cannot masquerade as a short flash just because the median catches up.
    """
    luma = np.asarray(luma, dtype=float)
    half = max(1, round(fps / 2))
    baseline = np.median(np.lib.stride_tricks.sliding_window_view(
        np.pad(luma, (half, half), mode='edge'), 2 * half + 1), axis=1)
    differences = np.diff(luma)
    noise = 1.4826 * np.median(np.abs(differences - np.median(differences))) if len(differences) else 0
    rise_threshold = max(8., float(noise) * 6)
    temporal_rise = np.r_[0, np.diff(luma)]
    candidates = segments((luma - baseline > rise_threshold) | (temporal_rise > rise_threshold), fps)
    pulses = []
    for start, candidate_end in candidates:
        a = round(start * fps)
        lo = max(0, a - round(.35 * fps))
        hi = max(lo + 1, a)
        before = float(np.quantile(luma[lo:hi], .1, method='lower'))
        peak_end = min(len(luma), max(a + 1, round(candidate_end * fps)))
        peak_index = a + int(luma[a:peak_end].argmax())
        peak = float(luma[peak_index])
        amplitude = peak - before
        if amplitude < 12:
            continue
        return_threshold = before + max(8, amplitude * .2)
        end = len(luma)
        for index in range(peak_index + 1, len(luma) - 1):
            if (luma[index] < return_threshold or
                    luma[index] - luma[index-1] < -max(8, amplitude * .15)):
                end = index
                break
        pulses.append({'start': start, 'end': end / fps, 'duration': end / fps - start,
                       'peak_reflection_luma': peak, 'background_luma': before,
                       'amplitude': amplitude, 'peak_time': peak_index / fps,
                       'recording_end_censored': end == len(luma)})
    return pulses, baseline, {'median_window_seconds': (2 * half + 1) / fps,
                             'rise_threshold': rise_threshold, 'minimum_amplitude': 12,
                             'return_fraction_of_peak_above_pre_rise_background': .2,
                             'sharp_fall_fraction_of_amplitude': .15}


def source_matches(capture, sources, audio_offset, threshold=.65, expected=None):
    candidates = []
    for name, template in sources.items():
        scores = pearson_windows(capture, template)
        if expected is not None and len(scores):
            origins = np.arange(len(scores)) / 100 + audio_offset
            allowed = np.zeros(len(scores), dtype=bool)
            for request in expected:
                if request['file'] == name:
                    allowed |= ((origins >= request['time'] - .1) &
                                (origins <= request['time'] + 3))
            scores[~allowed] = -1
        # Correlation alone can match a quiet microphone noise floor. Require
        # acoustic energy comparable to real playback before accepting a match.
        if len(scores):
            windows = np.lib.stride_tricks.sliding_window_view(capture, len(template))
            floor = max(float(np.percentile(capture, 25)) * 8,
                        float(np.percentile(capture, 99)) * .1, 1e-8)
            mean_floor = max(float(np.percentile(capture, 25)) * 4,
                             float(np.percentile(capture, 99)) * .025, 1e-8)
            scores[(windows.max(axis=1) < floor) | (windows.mean(axis=1) < mean_floor)] = -1
        # Retain local best candidates at least a source duration apart.
        while len(scores) and float(scores.max()) >= threshold:
            index = int(scores.argmax())
            candidates.append({'file': name, 'start': float(index / 100 + audio_offset),
                               'correlation': float(scores[index]), 'source_duration': len(template) / 100})
            exclusion = max(1, len(template) - 30)
            scores[max(0, index - exclusion):index + exclusion + 1] = -1
    # A different template can weakly resemble the same burst; keep strongest.
    accepted = []
    for match in sorted(candidates, key=lambda x: x['correlation'], reverse=True):
        if all(abs(match['start'] - other['start']) > min(match['source_duration'], other['source_duration']) * .85 for other in accepted):
            accepted.append(match)
    return sorted(accepted, key=lambda x: x['start'])



def scene_motion_candidates(frames, fps=FPS):
    """Flag sustained structural changes, suppressing uniform exposure changes.

    This is a review aid, not optical tracking or proof of camera movement.
    A moving person or uneven illumination can also alter scene structure.
    """
    gray = frames[:, ::4, ::4].mean(axis=3)
    mean = gray.mean(axis=(1, 2), keepdims=True)
    scale = np.maximum(gray.std(axis=(1, 2), keepdims=True), 5)
    normalized = (gray - mean) / scale
    change = np.r_[0, np.abs(np.diff(normalized, axis=0)).mean(axis=(1, 2))]
    raw = segments(change > .12, fps)
    merged = []
    for start, end in raw:
        if merged and start - merged[-1][1] <= .2:
            merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return change, [(a, b) for a, b in merged if b - a >= .25]


def decode_audio(path, bandpass=None):
    filters = []
    if bandpass:
        low, high = bandpass
        if not 0 < low < high < SAMPLE_RATE / 2:
            raise ValueError("Audio bandpass must be positive and below Nyquist")
        filters = ["-af", f"highpass=f={low},lowpass=f={high}"]
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
                                   '-map', '0:a:0', *filters, '-ac', '1', '-ar', str(SAMPLE_RATE),
                                   '-f', 's16le', '-'])
    return np.frombuffer(raw, dtype='<i2').astype(float)


def trace_data(path, recording_epoch, kind="frame"):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    frames = [row for row in rows if row.get('kind') == kind]
    times, values = [], []
    for row in frames:
        colors = row['colors'].values()
        # Exclude the warm-yellow anchor from the planned white-flash waveform.
        white = [min(c) / 65535 for c in colors if max(c) > 0 and min(c) >= .9 * max(c)]
        times.append(row['epoch'] - recording_epoch)
        values.append(max(white, default=0))
    times, values = np.array(times), np.array(values)
    pulses = []
    if len(times):
        active = values >= .3
        edges = np.diff(np.r_[False, active, False].astype(int))
        step = float(np.median(np.diff(times))) if len(times) > 1 else .02
        for a, b in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
            pulses.append((float(times[a]), float(times[b] if b < len(times) else times[b - 1] + step)))
    events = [{**row, 'time_in_recording': row['epoch'] - recording_epoch}
              for row in rows if row.get('kind') not in ('frame', 'wire', 'rest_edge') and 'epoch' in row]
    return times, values, pulses, events


def compare_pulses(planned, observed, maximum_delay=.5):
    remaining = list(enumerate(observed))
    comparisons = []
    for start, end in planned:
        nearby = [(index, pulse) for index, pulse in remaining
                  if -.1 <= pulse['start'] - start <= maximum_delay]
        match = min(nearby, key=lambda item: abs(item[1]['start'] - start)) if nearby else None
        result = {'planned_start': start, 'planned_end': end, 'observed': bool(match)}
        if match:
            index, pulse = match
            remaining = [(i, p) for i, p in remaining if i != index]
            result.update(observed_start=pulse['start'], observed_end=pulse['end'],
                          observed_duration=pulse['end'] - pulse['start'],
                          short_flash=pulse['end'] - pulse['start'] <= .3 + 1e-9,
                          onset_delay=pulse['start'] - start)
        comparisons.append(result)
    return comparisons


def analyze(movie, output, roi=(135, 0, 95, 60), white_threshold=25,
            room_threshold=90, trace=None, recording_epoch=None, sources_dir=None, exclude_before=0, audio_bandpass=None,
            reflection_roi=(190,70,120,105)):
    movie, output = Path(movie), Path(output)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                                '-of', 'json', str(movie)]))
    audio_stream = next(s for s in probe['streams'] if s['codec_type'] == 'audio')
    video_stream = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    audio_offset = float(audio_stream.get('start_time', 0)) - float(video_stream.get('start_time', 0))
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(movie), '-map', '0:v:0',
                                   '-vf', f'fps={FPS},scale=320:180', '-pix_fmt', 'rgb24',
                                   '-f', 'rawvideo', '-'])
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 180, 320, 3)
    t = np.arange(len(frames)) / FPS
    x, y, width, height = roi
    if min(x, y) < 0 or width <= 0 or height <= 0 or x + width > 320 or y + height > 180:
        raise ValueError('ROI must fit the 320×180 analysis image')
    scene_change, motion_candidates = scene_motion_candidates(frames)
    fixture_rgb = frames[:, y:y + height, x:x + width].mean(axis=(1, 2))
    room_rgb = frames.mean(axis=(1, 2))
    whole_luma = room_rgb @ np.array([.2126, .7152, .0722])
    rx, ry, rw, rh = reflection_roi
    if min(rx, ry) < 0 or rw <= 0 or rh <= 0 or rx + rw > 320 or ry + rh > 180:
        raise ValueError('Reflection ROI must fit the 320×180 analysis image')
    reflection_rgb = frames[:, ry:ry+rh, rx:rx+rw].mean(axis=(1,2))
    luma = reflection_rgb @ np.array([.2126,.7152,.0722])
    room_brightness = room_rgb.mean(axis=1)
    # Independent whole-frame aid when the direct fixture ROI is uncertain.
    # Daylight/windows can also contribute, so this is never a stand-alone verdict.
    neutral_bright = np.empty(len(frames))
    for offset in range(0, len(frames), 64):
        pixels = frames[offset:offset + 64].astype(np.uint16)
        neutral_bright[offset:offset + len(pixels)] = ((pixels.min(axis=3) > 180) &
            (pixels[:, :, :, 2] * 100 >= 85 * pixels[:, :, :, 0]) &
            (pixels[:, :, :, 2] * 100 >= 85 * pixels[:, :, :, 1])).mean(axis=(1, 2))
    del pixels
    blue_red_ratio = room_rgb[:, 2] / np.maximum(room_rgb[:, 0], 1)
    local_luma = np.median(np.lib.stride_tricks.sliding_window_view(np.pad(luma, (15, 15), mode='edge'), 31), axis=1)
    local_neutral = np.median(np.lib.stride_tricks.sliding_window_view(np.pad(neutral_bright, (15, 15), mode='edge'), 31), axis=1)
    reflected_candidates = segments((luma - local_luma > 15) & (neutral_bright - local_neutral > .005), FPS)
    white_score = fixture_rgb[:, 2] - .75 * fixture_rgb[:, 0]
    yellow_score = fixture_rgb[:, 0] - fixture_rgb[:, 2]
    detected = (white_score > white_threshold) & (room_brightness > room_threshold)
    color_intervals = segments(detected, FPS)
    pulses, intensity_baseline, intensity_method = detect_intensity_pulses(luma, FPS)
    for pulse in pulses:
        a, b = round(pulse['start']*FPS), round(pulse['end']*FPS)
        pulse['peak_white_score'] = float(white_score[a:b].max())
    audio = rms_envelope(decode_audio(movie, audio_bandpass))
    audio_t = np.arange(len(audio)) / 100 + audio_offset
    sources_dir = Path(sources_dir) if sources_dir else Path(__file__).resolve().parents[1] / 'audio'
    source_catalog = json.loads((sources_dir / 'catalog.json').read_text())
    sources = {c['file']: rms_envelope(decode_audio(sources_dir / c['file'], audio_bandpass)) for c in source_catalog}
    expected_audio = None
    if trace and recording_epoch is not None:
        expected_audio = []
        for line in Path(trace).read_text().splitlines():
            row = json.loads(line)
            if row.get('kind') == 'audio_request' and row.get('file'):
                expected_audio.append({'file': row['file'], 'time': row['epoch'] - recording_epoch})
    matches = source_matches(audio, sources, audio_offset, expected=expected_audio)
    peak_alignment = []
    for match in matches:
        source = next(c for c in source_catalog if c['file'] == match['file'])
        for peak in source['audio_peak_seconds']:
            expected_peak = match['start'] + peak
            lo = max(0, int((expected_peak - audio_offset - .10) * 100))
            hi = min(len(audio), int((expected_peak - audio_offset + .10) * 100) + 1)
            actual_peak = float(audio_t[lo + int(audio[lo:hi].argmax())]) if hi > lo else expected_peak
            near = min(pulses, key=lambda p: abs(p['start'] - actual_peak)) if pulses else None
            peak_alignment.append({'file': match['file'], 'audio_file_start': match['start'],
                                   'source_peak_time': expected_peak, 'microphone_peak_time': actual_peak,
                                   'nearby_flash_start': near['start'] if near and abs(near['start'] - actual_peak) <= .4 else None,
                                   'flash_minus_audio_peak': near['start'] - actual_peak if near and abs(near['start'] - actual_peak) <= .4 else None})
    report = {'movie_name': movie.name, 'movie_sha256': hashlib.sha256(movie.read_bytes()).hexdigest(),
              'duration': len(frames) / FPS, 'analysis_fps': FPS, 'fixture_roi_in_320x180': list(roi),
              'reflection_roi_in_320x180': list(reflection_roi),
              'primary_pulse_method': intensity_method,
              'secondary_white_colour_intervals': color_intervals,
              'thresholds': {'white_score': white_threshold, 'room_mean_rgb': room_threshold},
              'intensity_holds_over_300ms': [p for p in pulses if p['duration'] > .3],
              'intensity_pulses': pulses,
              'white_pulses_colour_is_secondary_only': True,
              'audio_stream_start_relative_to_video': audio_offset, 'audio_bandpass_hz': audio_bandpass, 'white_pulses': pulses,
              'source_matches': matches, 'audio_peak_flash_alignment': peak_alignment,
              'source_catalog': str(sources_dir / 'catalog.json'),
              'audio_request_matching_window_seconds': [-.1, 3] if expected_audio is not None else None,
              'excluded_moving_camera_before': exclude_before,
              'scene_motion_candidates': motion_candidates,
              'whole_frame_reflected_flash_candidates': reflected_candidates,
              'scene_review_required': any(b > exclude_before for a, b in motion_candidates),
              'limits': ['Camera-relative brightness and colour; not lux or linear light output.',
                         'Queued frames, UDP transmission and HTTP acknowledgements do not prove physical light response.',
                         'Automatic exposure, white balance, rolling shutter and bulb clipping affect amplitudes.',
                         '30 Hz pulse timing has at least one-frame uncertainty (33 ms); partial exposures add uncertainty.',
                         'Audio uses 10 ms RMS windows from AAC; the AAC stream timestamp offset is included.',
                         'Wall-clock alignment additionally depends on recording callback and host-clock uncertainty.',
                         'Scene-specific ROI and detection thresholds must be reviewed after moving the setup.',
                         'Scene-change warnings may include uneven flash illumination; inspect framing before inferring movement.']}
    planned_t = planned_values = wire_t = wire_values = rest_t = rest_values = None
    if trace:
        if recording_epoch is None:
            raise ValueError('Trace comparison requires --recording-start-epoch')
        planned_t, planned_values, planned_pulses, events = trace_data(trace, recording_epoch)
        report['trace_events'] = events
        rest_t, rest_values, rest_pulses, _ = trace_data(trace, recording_epoch, 'rest_edge')
        rest_pulses = [(a, b) for a, b in rest_pulses if a >= exclude_before and a < len(frames) / FPS]
        if rest_pulses:
            rest_rows = [json.loads(line) for line in Path(trace).read_text().splitlines()
                         if line.strip() and json.loads(line).get('kind') == 'rest_edge']
            report['rest_pulse_count'] = len(rest_pulses)
            report['rest_pulse_comparison'] = compare_pulses(rest_pulses, pulses)
            report['matched_rest_pulse_count'] = sum(x['observed'] for x in report['rest_pulse_comparison'])
            report['rest_request_ms_p50_p95_max'] = np.percentile([row.get('request_ms', 0) for row in rest_rows], [50,95,100]).tolist()
            report['rest_active_gap_brightness_values'] = sorted({row.get('active_gap_brightness', 0) for row in rest_rows})
        wire_t, wire_values, wire_pulses, _ = trace_data(trace, recording_epoch, 'wire')
        wire_pulses = [(a, b) for a, b in wire_pulses if a >= exclude_before and a < len(frames) / FPS]
        if wire_pulses:
            wire_rows = [json.loads(line) for line in Path(trace).read_text().splitlines()
                         if line.strip() and json.loads(line).get('kind') == 'wire']
            epochs = [row['epoch'] for row in wire_rows]
            report['wire_pulse_count'] = len(wire_pulses)
            report['wire_pulse_comparison'] = compare_pulses(wire_pulses, pulses)
            report['matched_wire_pulse_count'] = sum(x['observed'] for x in report['wire_pulse_comparison'])
            report['wire_transport'] = {
                'frame_count': len(wire_rows),
                'max_frame_interval': float(max(np.diff(epochs))) if len(epochs) > 1 else None,
                'max_queue_depth': max(row.get('queue_depth', 0) for row in wire_rows),
                'send_ms_p50_p95_max': np.percentile([row.get('send_ms', 0) for row in wire_rows], [50,95,100]).tolist()}

        planned_pulses = [(a, b) for a, b in planned_pulses if b >= exclude_before and a >= exclude_before and a < len(frames) / FPS]
        report['pulse_comparison'] = compare_pulses(planned_pulses, pulses)
        frame_rows = [json.loads(line) for line in Path(trace).read_text().splitlines()
                      if line.strip() and json.loads(line).get('kind') == 'frame']
        for comparison in report['pulse_comparison']:
            near_rows = [row for row in frame_rows if comparison['planned_start'] - .1 <= row['epoch'] - recording_epoch <= comparison['planned_end'] + .1]
            queued = [row for row in near_rows if any(max(c) > 0 and min(c) >= .9 * max(c) for c in row['colors'].values())]
            epochs = [row['epoch'] for row in near_rows]
            comparison['queued_white_frame_count'] = len(queued)
            comparison['max_nearby_queue_interval'] = float(max(np.diff(epochs))) if len(epochs) > 1 else None
            comparison['recording_end_censored'] = (not comparison['observed'] and
                comparison['planned_end'] + .5 > len(frames) / FPS)
        report['end_censored_pulse_count'] = sum(x['recording_end_censored'] for x in report['pulse_comparison'])
        delays = [x['onset_delay'] for x in report['pulse_comparison'] if x['observed']]
        report['matched_pulse_count'] = len(delays)
        report['matched_short_flash_count'] = sum(x.get('short_flash', False) for x in report['pulse_comparison'])
        report['planned_pulse_count'] = len(planned_pulses)
        if delays:
            report['median_flash_onset_delay'] = float(np.median(delays))
            report['p95_flash_onset_delay'] = float(np.percentile(delays, 95))
    (output / 'analysis.json').write_text(json.dumps(report, indent=2) + '\n')
    np.savez_compressed(output / 'curves.npz', video_time=t, room_luma=whole_luma,
                        reflection_luma=luma, intensity_baseline=intensity_baseline, fixture_rgb=fixture_rgb,
                        white_score=white_score, yellow_score=yellow_score,
                        audio_time=audio_t, audio_rms=audio, scene_change_score=scene_change,
                        neutral_bright_fraction=neutral_bright, whole_frame_blue_red_ratio=blue_red_ratio)
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(3, 1, figsize=(15, 9), sharex=True)
    axes[0].plot(t, luma, color='#34495e', linewidth=.8, label='Diffuse wall reflected intensity f(t)')
    axes[0].plot(t, intensity_baseline, color='#888888', linewidth=.6, linestyle=':', label='Adaptive background baseline')
    axes[0].set_ylabel("Camera luma Y′")
    axes[0].legend(loc='upper left')
    axes[1].plot(t, white_score, color='#2979ff', linewidth=.8, label='White flash colour score')
    axes[1].plot(t, yellow_score, color='#d99a00', linewidth=.65, alpha=.65, label='Yellow background colour score')
    axes[1].axhline(white_threshold, color='#2979ff', linestyle=':', alpha=.6)
    if planned_t is not None:
        axes[1].plot(planned_t, planned_values * 80 - 25, color='#888888', linewidth=.75, alpha=.8, label='Planned white output (scaled)')
        if wire_t is not None and len(wire_t):
            axes[1].plot(wire_t, wire_values * 80 - 25, color='#d81b60', linewidth=.75, alpha=.85, label='Actual UDP-transmitted white output (scaled)')
        if rest_t is not None and len(rest_t):
            axes[1].plot(rest_t, rest_values * 80 - 25, color='#d81b60', linewidth=.75, alpha=.85, label='HTTP-acknowledged white output (scaled)')
    axes[1].set_ylabel('Camera colour units')
    axes[1].legend(loc='upper left')
    audio_label = 'Microphone RMS · 10 ms' + (f' · {audio_bandpass[0]}–{audio_bandpass[1]} Hz' if audio_bandpass else '')
    axes[2].plot(audio_t, audio, color='#663399', linewidth=.7, label=audio_label)
    for match in matches:
        axes[2].axvline(match['start'], color='#777777', linewidth=.6, linestyle='--')
        axes[2].text(match['start'] + .15, max(audio) * .8, match['file'].replace('.wav', ''), fontsize=8)
    for a, b in motion_candidates:
        for ax in axes:
            ax.axvspan(a, b, color='#777777', alpha=.12, linewidth=0)
    for pulse in pulses:
        for ax in axes:
            ax.axvspan(pulse['start'], pulse['end'], color='#2979ff', alpha=.10, linewidth=0)
    axes[2].set_ylabel('Microphone RMS')
    axes[2].set_xlabel('Seconds from video start')
    axes[2].legend(loc='upper left')
    for ax in axes:
        ax.grid(alpha=.15)
        ax.set_xlim(0, len(frames) / FPS)
    warning = " · SCENE CHANGES: REVIEW FIXED ROI" if report['scene_review_required'] else ""
    fig.suptitle(f"{movie.name}: {len(pulses)} intensity-rise candidates; {len(matches)} matched thunder recordings{warning}", fontsize=12)
    fig.text(.01, .007, 'Relative camera evidence, not photometry. Timing: 30 Hz video / 10 ms audio RMS; exposure and start-clock uncertainty remain.', fontsize=8)
    fig.tight_layout(rect=(0, .02, 1, .97))
    fig.savefig(output / 'intensity-and-audio.png', dpi=140)
    plt.close(fig)
    return report



def analyze_batch(entries, output_root, sources_dir=None, **options):
    """Analyze an explicitly enumerated private capture set, without device I/O.

    entries: [{movie, trace?, recording_start_epoch?, exclude_before?}, ...].
    Each capture gets its own subfolder and an aggregate index is written.
    """
    output_root = Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    summaries = []
    for entry in entries:
        movie = Path(entry['movie'])
        output = output_root / movie.stem
        report = analyze(movie, output, trace=entry.get('trace'),
                         recording_epoch=entry.get('recording_start_epoch'),
                         sources_dir=sources_dir,
                         exclude_before=entry.get('exclude_before', 0), **options)
        summaries.append({'movie_name': movie.name, 'report': str(output / 'analysis.json'),
                          'white_pulse_candidates': len(report['white_pulses']),
                          'matched_pulses': report.get('matched_pulse_count'),
                          'planned_pulses': report.get('planned_pulse_count'),
                          'scene_review_required': report['scene_review_required']})
    (output_root / 'batch-index.json').write_text(json.dumps(summaries, indent=2) + '\n')
    return summaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('movie', type=Path)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--roi', type=int, nargs=4, default=(135, 0, 95, 60), metavar=('X', 'Y', 'WIDTH', 'HEIGHT'))
    parser.add_argument('--reflection-roi', type=int, nargs=4, default=(190,70,120,105), metavar=('X','Y','WIDTH','HEIGHT'), help='Diffuse reflection ROI excluding lamps and the window')
    parser.add_argument('--white-threshold', type=float, default=25, help='Secondary colour diagnostic only; never gates primary intensity detection')
    parser.add_argument('--room-threshold', type=float, default=90, help='Secondary colour diagnostic brightness floor only')
    parser.add_argument('--trace', type=Path)
    parser.add_argument('--recording-start-epoch', type=float)
    parser.add_argument('--sources-dir', type=Path, help='Directory containing source WAV files and catalog.json')
    parser.add_argument('--audio-bandpass', type=float, nargs=2, metavar=('LOW_HZ', 'HIGH_HZ'), help='Apply the same bandpass to microphone and templates when bass frequency responses differ')
    parser.add_argument('--exclude-before', type=float, default=0, help='Exclude unstable/moving-camera segment from planned-pulse verdicts')
    args = parser.parse_args()
    report = analyze(args.movie, args.output_dir, tuple(args.roi), args.white_threshold,
                     args.room_threshold, args.trace, args.recording_start_epoch, args.sources_dir, args.exclude_before, args.audio_bandpass, tuple(args.reflection_roi))
    print(json.dumps({'duration': report['duration'], 'intensity_events': len(report['white_pulses']),
                      'matched_thunder_recordings': len(report['source_matches']),
                      'report': str(args.output_dir / 'analysis.json')}, indent=2))


if __name__ == '__main__':
    main()
