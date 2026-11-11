from array import array
import importlib.util
from pathlib import Path
import random
import tempfile
import unittest
import wave

spec=importlib.util.spec_from_file_location('measure',Path(__file__).parent/'calibration/measure.py')
measure=importlib.util.module_from_spec(spec);spec.loader.exec_module(measure)


class CalibrationTests(unittest.TestCase):
    def test_known_delay_is_recovered_despite_gain_and_background_noise(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory)
            rng=random.Random(1)
            source=[]
            for i in range(400):
                level=rng.randint(100,10000)
                source.extend(rng.randint(-level,level) for _ in range(240))
            recording=[rng.randint(-30,30) for _ in range(24000)]
            recording.extend(int(x*0.2)+rng.randint(-30,30) for x in source)
            recording.extend(rng.randint(-30,30) for _ in range(24000))
            for name,samples in [('source.wav',source),('capture.wav',recording)]:
                with wave.open(str(base/name),'wb') as output:
                    output.setnchannels(1);output.setsampwidth(2);output.setframerate(24000)
                    output.writeframes(array('h',samples).tobytes())
            result=measure.match(base/'capture.wav',base/'source.wav')
            self.assertEqual(result['file_start_in_recording_seconds'],1)
            self.assertGreater(result['correlation'],0.99)
