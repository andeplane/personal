import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from analyze_capture import compare_pulses, pearson_windows, segments, source_matches, trace_data, scene_motion_candidates, detect_intensity_pulses


class CaptureAnalysisTests(unittest.TestCase):
    def test_one_frame_flash_is_not_smoothed_away(self):
        self.assertEqual(segments([False, True, False, True, True], 30),
                         [(1/30, 2/30), (3/30, 5/30)])

    def test_acoustic_match_recovers_origin_despite_gain_and_noise(self):
        rng = np.random.default_rng(7)
        template = rng.uniform(1, 50, 400)
        capture = rng.uniform(0, .2, 1200)
        capture[247:647] += template * .08
        scores = pearson_windows(capture, template)
        self.assertEqual(int(scores.argmax()), 247)
        self.assertGreater(scores[247], .99)
        matches = source_matches(capture, {'test.wav': template}, .215)
        self.assertAlmostEqual(matches[0]['start'], 2.685)

    def test_missing_early_pulse_is_reported_without_shifting_later_pulse(self):
        measured = [{'start': 4.1, 'end': 4.25}, {'start': 5.15, 'end': 5.30}]
        result = compare_pulses([(1., 1.2), (4., 4.2), (5., 5.2)], measured)
        self.assertEqual([r['observed'] for r in result], [False, True, True])
        self.assertAlmostEqual(result[1]['onset_delay'], .1)

    def test_planned_yellow_anchor_is_excluded_from_white_waveform(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'trace.jsonl'
            rows = [
                {'kind': 'frame', 'epoch': 100., 'colors': {'0': [46000,30000,4000], '1': [0,0,0]}},
                {'kind': 'frame', 'epoch': 100.02, 'colors': {'0': [46000,30000,4000], '1': [65535,65535,65535]}},
                {'kind': 'frame', 'epoch': 100.04, 'colors': {'0': [46000,30000,4000], '1': [0,0,0]}},
            ]
            path.write_text('\n'.join(map(json.dumps, rows)))
            times, values, pulses, events = trace_data(path, 99.)
            np.testing.assert_equal(values, [0,1,0])
            self.assertAlmostEqual(pulses[0][0], 1.02)
            self.assertAlmostEqual(pulses[0][1], 1.04)

    def test_uniform_exposure_change_is_not_a_camera_movement(self):
        rng = np.random.default_rng(12)
        base = rng.integers(20, 90, size=(60, 60, 3), dtype=np.uint8)
        exposure = np.stack([base * scale for scale in [1] * 8 + [2] * 8])
        _, candidates = scene_motion_candidates(exposure)
        self.assertEqual(candidates, [])
        moving = np.stack([np.roll(base, frame, axis=1) for frame in range(16)])
        _, candidates = scene_motion_candidates(moving)
        self.assertTrue(candidates)

    def test_correlated_quiet_noise_is_not_reported_as_extra_thunder(self):
        rng = np.random.default_rng(8)
        template = rng.uniform(1, 50, 400)
        capture = rng.uniform(0, .1, 2000)
        capture[300:700] += template * .01
        capture[1000:1400] += template * 10
        matches = source_matches(capture, {'thunder.wav': template}, 0)
        self.assertEqual(len(matches), 1)
        self.assertAlmostEqual(matches[0]['start'], 10)

    def test_long_white_hold_is_not_mistaken_for_a_short_flash(self):
        measured = [{'start': 1.05, 'end': 2.5}]
        result = compare_pulses([(1., 1.16)], measured)
        self.assertTrue(result[0]['observed'])
        self.assertFalse(result[0]['short_flash'])

    def test_brightness_pulses_survive_yellow_white_balance_and_exposure_drift(self):
        fps = 30
        t = np.arange(12*fps) / fps
        baseline = 70 + 1.5*t
        gain = .9 + .01*t
        rgb = np.column_stack([baseline*1.2, baseline, baseline*.35])
        expected = []
        for onset in (3.,3.7,4.4,5.1,5.8,6.5):
            mask = (t>=onset)&(t<onset+.2)
            # Strongly yellow camera WB: even the white flash's blue is low.
            rgb[mask] += np.array([70,65,20])
            expected.append((onset,onset+.2))
        rgb *= gain[:,None]
        luma = rgb @ np.array([.2126,.7152,.0722])
        pulses, _, _ = detect_intensity_pulses(luma,fps)
        comparisons = compare_pulses(expected,pulses,maximum_delay=.1)
        self.assertEqual(sum(x['observed'] for x in comparisons),6)
        self.assertTrue(all(x['short_flash'] for x in comparisons))

    def test_held_light_cannot_become_six_flashes_when_median_catches_up(self):
        luma = np.full(12*30,80.)
        luma[3*30:8*30] += 70
        pulses, _, _ = detect_intensity_pulses(luma)
        self.assertEqual(len(pulses),1)
        self.assertGreater(pulses[0]['duration'],4.5)

    def test_sparse_rest_edges_use_actual_off_timestamp_for_planned_width(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'trace.jsonl'
            rows = [{'kind':'rest_edge','epoch':t,'colors':{'1':rgb}} for t,rgb in
                    [(101.,[65535]*3),(101.2,[0]*3),(102.5,[65535]*3),(102.7,[0]*3)]]
            path.write_text('\n'.join(map(json.dumps,rows)))
            _, _, pulses, _ = trace_data(path,100.,'rest_edge')
            self.assertAlmostEqual(pulses[0][1]-pulses[0][0],.2)
            self.assertAlmostEqual(pulses[1][1]-pulses[1][0],.2)

    def test_one_frame_dark_gap_separates_real_double_flash(self):
        luma = np.full(10*30,80.)
        luma[90:96] = 150
        luma[97:103] = 150
        pulses, _, _ = detect_intensity_pulses(luma)
        self.assertEqual(len(pulses),2)
        self.assertAlmostEqual(pulses[0]['duration'],.2)
        self.assertAlmostEqual(pulses[1]['duration'],.2)
