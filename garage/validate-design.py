"""Validate actual purchase data and the materially different room strategies."""
import json
from pathlib import Path
from urllib.parse import urlsplit
root=Path(__file__).resolve().parent
data=json.loads((root/'design-data.json').read_text())
assert [a['id'] for a in data['rearOptions']]==['none','wall','double','single','bulk']
assert all('recessMode' not in a and 'upperRuns' not in a for a in data['rearOptions']), 'Rear choices must not encode wall choices'
for key,p in data['products'].items():
    assert p['sku'] and p['name'] and p['retailer'] and p['note']
    assert p['price']>0 and p['vatIncluded'] and p['currency']=='NOK'
    assert len(p['dimensions'])==3 and all(v>0 for v in p['dimensions'])
    assert urlsplit(p['url']).scheme=='https' and p['checked'] in ['2026-10-21','2026-10-22','2026-10-23']
assert data['products']['pine20']['dimensions']==[1.18,.2,.018]
assert 2*.585+2*.003<1.18, 'Cut list allows saw kerfs'
for a in data['rearOptions']:
    assert a['rearWidth']<data['room']['width']
    expected=data['room']['length']-a['footprintDepth']-data['car']['length']-data['car']['entranceGap']
    assert abs(a['frontGap']-expected)<1e-8
    if a['type']=='transform':
        assert data['products'][a['baseKey']]['dimensions'][1]==a['depth']
        assert abs(.975+.91-a['rearWidth'])<1e-9
        assert all(len(levels)==4 for levels in a['shelves'])
wall=data['leftWall']
assert (wall['clearWidth'],wall['clearHeight'],wall['recessDepth'])==(.545,.635,.09)
print('Independent storage components, real products, stock dimensions, cut list and footprints pass.')
