"""Validate space-study inputs. This does not establish physical installation."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
data = json.loads((root / 'design-data.json').read_text())
assert [a['id'] for a in data['layouts']] == list('ABCD')
assert [a['depth'] for a in data['layouts']] == [.4, .5, .6, .8]
for a in data['layouts']:
    expected = data['room']['length'] - a['depth'] - data['car']['length'] - data['car']['entranceGap']
    assert abs(a['frontGap'] - expected) < 1e-9
    assert a['rearWidth'] < data['room']['width']
    assert .28 <= a['upperDepth'] <= a['depth']
    assert len(a['shelves']) == 3 and min(a['shelves'][2]) >= 1.4
    for levels in a['shelves']:
        assert levels == sorted(set(levels))
        assert 0 < min(levels) <= max(levels) <= a['top']
    assert a['unpriced'] and 'loft' in a['equipment']
assert not data['products'] and not data['common'], 'Retired price lists must not imply a complete new specification'
wall = data['leftWall']
assert wall['clearWidth'] == .545 and wall['clearHeight'] == .635
assert 0 < wall['recessDepth'] < .12
for lower, upper in zip(wall['ledgeTops'], wall['ledgeTops'][1:]):
    assert abs(upper - .045 - lower - wall['clearHeight']) < 1e-9
assert wall['basketClearance'] > data['car']['height']
assert wall['basketProjection'] <= .25
assert data['loft']['length'] + data['loft']['accessDepth'] < data['room']['length'] - .8
print('Four coordinated plans: shelf heights, depth tradeoffs, parking arithmetic, wall measurements and default loft approach pass.')
