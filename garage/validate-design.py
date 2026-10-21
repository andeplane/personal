"""Catalogue identity, nominal installed footprints and purchase-data completeness."""
import json
from pathlib import Path
from urllib.parse import urlsplit
root=Path(__file__).resolve().parent
data=json.loads((root/'design-data.json').read_text())
assert [a['id'] for a in data['layouts']]==list('ABCD')
assert [a['depth'] for a in data['layouts']]==[.4,.55,.6,.8]
for key,p in data['products'].items():
    assert p['sku'] and p['name'] and p['retailer'] and p['note']
    assert p['price']>0 and p['vatIncluded'] and p['currency']=='NOK'
    assert len(p['dimensions'])==3 and all(v>0 for v in p['dimensions'])
    assert urlsplit(p['url']).scheme=='https' and p['checked']=='2026-10-21'
assert data['products']['shelf']['sku']=='104.487.35'
assert data['products']['upright']['sku']=='804.487.32'
assert data['products']['deep']['sku']=='896.174.43'
assert data['products']['deep']['dimensions']==[.85,.55,1.9]
assert data['products']['basketSmall']['dimensions']==[.435,.08,.07]
assert data['products']['basketLarge']['dimensions']==[.435,.135,.14]
assert not any(k in data['products'] for k in ['pinePanel','insertScrews']), 'No bespoke inserts'
for a in data['layouts']:
    assert a['rearWidth']<data['room']['width']
    expected=data['room']['length']-a['footprintDepth']-data['car']['length']-data['car']['entranceGap']
    assert abs(a['frontGap']-expected)<1e-8
    if a['type']=='transform':
        assert data['products'][a['baseKey']]['dimensions'][1]==a['depth']
        assert data['products'][a['extensionKey']]['dimensions'][1]==a['depth']
        assert abs(.975+2*.91-a['rearWidth'])<1e-9
        assert all(len(levels)==4 for levels in a['shelves']), 'Exactly included stock shelves'
wall=data['leftWall']
assert wall['clearWidth']==.545 and wall['clearHeight']==.635
assert wall['recessDepth']==.09
assert data['products']['basketSmall']['dimensions'][1]+.018<.125
assert wall['highBasketBottom']>data['car']['height']
print('Catalogue products, original BOAXEL/BROR identities, fixed basket sizes, shelf counts and footprints pass.')
