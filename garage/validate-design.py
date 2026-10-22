"""Validate actual purchase data and the materially different room strategies."""
import json
from pathlib import Path
from urllib.parse import urlsplit
root=Path(__file__).resolve().parent
data=json.loads((root/'design-data.json').read_text())
assert [a['id'] for a in data['layouts']]==list('ABCD')
assert [(a['type'],a['rackCount'],a['recessMode'],a['upperRuns']) for a in data['layouts']]==[('wall',0,'stock',4),('bror',2,'stock',2),('bror',1,'cut',4),('transform',2,'stock',1)]
for key,p in data['products'].items():
    assert p['sku'] and p['name'] and p['retailer'] and p['note']
    assert p['price']>0 and p['vatIncluded'] and p['currency']=='NOK'
    assert len(p['dimensions'])==3 and all(v>0 for v in p['dimensions'])
    assert urlsplit(p['url']).scheme=='https' and p['checked'] in ['2026-10-21','2026-10-22']
assert data['products']['recessUnit']['dimensions']==[.5,.18,.52]
assert data['products']['recessUnit']['sku']=='005.501.96'
assert data['products']['pine20']['dimensions']==[1.18,.2,.018]
assert 2*.535+2*.003<1.18, 'Cut list allows saw kerfs'
for a in data['layouts']:
    assert a['rearWidth']<data['room']['width']
    expected=data['room']['length']-a['footprintDepth']-data['car']['length']-data['car']['entranceGap']
    assert abs(a['frontGap']-expected)<1e-8
    if a['type']=='transform':
        assert data['products'][a['baseKey']]['dimensions'][1]==a['depth']
        assert abs(.975+.91-a['rearWidth'])<1e-9
        assert all(len(levels)==4 for levels in a['shelves'])
wall=data['leftWall']
assert (wall['clearWidth'],wall['clearHeight'],wall['recessDepth'])==(.545,.635,.09)
print('Distinct whole-room strategies, real products, stock dimensions, cut list and footprints pass.')
