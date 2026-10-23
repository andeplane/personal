"""Exercise the release guard with deliberate model / asset changes."""
import contextlib
import importlib.util
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('freshness', ROOT / 'validate-images.py')
freshness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(freshness)


class ImageFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in [*freshness.SCENE_FILES, 'design-data.json', 'index.html']:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        plans = []
        for study in json.loads((ROOT / 'design-data.json').read_text())['imageStudies']:
            letter,depth=study['id'],study['depthCm']
            image, source = self.root / f'{letter}.jpg', self.root / f'{letter}.png'
            image.write_bytes(f'generated-test-fixture-{letter}'.encode())
            source.write_bytes(f'source-test-fixture-{letter}'.encode())
            plans.append(dict(id=letter, depthCm=depth, configuration=study['configuration'], prompt='test fixture',
                              reviewedAgainstSource=True, output=image.name,
                              outputSHA256=freshness.sha(image), source3D=source.name,
                              source3DHash=freshness.sha(source)))
        self.manifest = dict(modelSHA256=freshness.model_hash(self.root), plans=plans)
        self.save_manifest()

    def save_manifest(self):
        (self.root / 'photo-prompts.json').write_text(json.dumps(self.manifest))

    def validate(self):
        with contextlib.redirect_stdout(io.StringIO()):
            freshness.validate(self.root)

    def edit_data(self, change):
        path = self.root / 'design-data.json'
        data = json.loads(path.read_text())
        change(data)
        path.write_text(json.dumps(data))

    def test_unchanged_model_passes(self):
        self.validate()

    def test_changed_recess_depth_blocks_release(self):
        self.edit_data(lambda d: d['leftWall'].__setitem__('recessDepth', .08))
        with self.assertRaisesRegex(AssertionError, 'stale'):
            self.validate()

    def test_changed_depth_blocks_release(self):
        self.edit_data(lambda d: d['rearOptions'][4].__setitem__('depth', .7))
        with self.assertRaisesRegex(AssertionError, 'stale'):
            self.validate()

    def test_changed_renderer_blocks_release(self):
        with (self.root / 'storage.js').open('a') as f:
            f.write('\n// changed geometry\n')
        with self.assertRaisesRegex(AssertionError, 'stale'):
            self.validate()

    def test_changed_default_roof_blocks_release(self):
        path = self.root / 'index.html'
        path.write_text(path.read_text().replace('value="245"', 'value="260"'))
        with self.assertRaisesRegex(AssertionError, 'stale'):
            self.validate()

    def test_price_only_change_does_not_require_new_image(self):
        self.edit_data(lambda d: d['products']['deep'].__setitem__('price', 1800))
        self.validate()

    def test_replaced_image_is_detected(self):
        (self.root / 'rear-double.jpg').write_bytes(b'obsolete image')
        with self.assertRaisesRegex(AssertionError, 'Changed/missing'):
            self.validate()

    def test_wrong_depth_label_is_detected(self):
        self.manifest['plans'][3]['depthCm'] = 60
        self.save_manifest()
        with self.assertRaisesRegex(AssertionError, 'Wrong image depth'):
            self.validate()


if __name__ == '__main__':
    unittest.main()
