"""Reject stale Imagegen previews when the modeled garage changes."""
import argparse
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCENE_FILES = (
    'source/visual-template.html', 'build-viewer.py', 'materials.js',
    'products.js', 'bikes.js', 'room.js', 'expanded-storage.js',
    'example-contents.js', 'left-wall.js', 'space.js', 'storage.js',
    'interaction.js',
)
LAYOUT_COPY = {'name', 'system', 'summary', 'equipment', 'unpriced'}
PRODUCT_GEOMETRY = {'sku', 'dimensions', 'includedShelves'}
CONTROLS = {'rear-height', 'loft-length', 'garage-upper', 'garage-left-baskets',
            'garage-loft', 'garage-gear', 'garage-bikes'}


class Defaults(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        key = attrs.get('id')
        if tag == 'input' and key in CONTROLS:
            self.values[key] = (attrs.get('value') if attrs.get('type') == 'range'
                                else 'checked' in attrs)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def model_hash(root=ROOT):
    data = json.loads((root / 'design-data.json').read_text())
    defaults = Defaults()
    defaults.feed((root / 'index.html').read_text())
    geometry = {key: data[key] for key in ('room', 'car', 'common', 'leftWall', 'loft')}
    geometry['layouts'] = [{k: v for k, v in a.items() if k not in LAYOUT_COPY}
                           for a in data['layouts']]
    geometry['products'] = {key: {k: v for k, v in p.items() if k in PRODUCT_GEOMETRY}
                            for key, p in data['products'].items()}
    payload = {'geometry': geometry, 'defaults': defaults.values,
               'sources': {name: sha(root / name) for name in SCENE_FILES}}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def validate(root=ROOT):
    manifest = json.loads((root / 'photo-prompts.json').read_text())
    current = model_hash(root)
    assert manifest.get('modelSHA256') == current, (
        'Garage Imagegen images are stale. Export the current car-free plans, '
        'regenerate and visually inspect all affected images. Do not just update the hash.')
    data = json.loads((root / 'design-data.json').read_text())
    plans = manifest['plans']
    assert [p['id'] for p in plans] == list('abcd')
    for plan, layout in zip(plans, data['layouts']):
        assert plan['depthCm'] == round(layout['depth'] * 100), 'Wrong image depth'
        assert plan['prompt'] and plan['reviewedAgainstSource'], 'Image review missing'
        for path_key, hash_key in [('output', 'outputSHA256'), ('source3D', 'source3DHash')]:
            path = root / plan[path_key]
            assert path.is_file() and sha(path) == plan[hash_key], f"Changed/missing {path}"
    assert len({p['source3DHash'] for p in plans}) == 4, 'Each depth needs its own render'
    assert len({p['outputSHA256'] for p in plans}) == 4, 'Do not reuse an image across depths'
    print('All four Imagegen images match the current model fingerprint and their own depth references.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--print-model-hash', action='store_true')
    args = parser.parse_args()
    if args.print_model_hash:
        print(model_hash())
    else:
        validate()
