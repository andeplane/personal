"""Validate the priced subset and the space-study inputs, not physical installation."""
from decimal import Decimal
import json
from pathlib import Path

root = Path(__file__).resolve().parent
data = json.loads((root / 'design-data.json').read_text())
for layout in data['layouts']:
    total = sum(Decimal(str(data['products'][key]['price'])) * count
                for key, count in layout['items'] + data['common'])
    assert total == Decimal(str(layout['productsTotal'])), layout['id']
    assert total + Decimal(str(layout['allowance'])) == Decimal(str(layout['budgetTotal']))
    assert not any(key in {'small', 'tiny', 'flat', 'large'}
                   for key, _ in layout['items'] + data['common']), 'No assumed box purchases'
    assert abs(layout['frontGap'] - (data['room']['length'] - (0 if layout['id'] == 'F' else layout['depth']) -
               data['car']['length'] - data['car']['entranceGap'])) < 1e-9
    assert layout['rearWidth'] < data['room']['width']
    assert layout['unpriced'], 'Keep additions outside the priced subset explicit'
    for levels in layout['shelves']:
        assert levels == sorted(set(levels))
        assert min(levels) > 0 and max(levels) <= data['room']['shelfHeightLimit']
    if layout['id'] == 'B':
        assert len(layout['shelves'][0]) == len(layout['shelves'][1]) == 5
    if layout['id'] == 'D':
        assert len(layout['shelves'][0]) == 4
    if layout['id'] == 'E':
        assert len(layout['shelves'][0]) == 5
        assert 'Two additional' in layout['unpriced']
print('All six layouts: priced subsets, no boxes, shelf counts, height and parking arithmetic pass.')
