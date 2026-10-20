"""Render the researched shopping data into static HTML, CSV and the downloadable guide.

Run after changing components.json. No third-party Python dependencies needed.
Does not regenerate CAD or change printable geometry.
"""
import csv
import html
import io
import json
from pathlib import Path
import re
import zipfile
from datetime import date

ROOT = Path(__file__).resolve().parent
data = json.loads((ROOT / 'components.json').read_text())
items = data['items']
assert len({item['id'] for item in items}) == len(items)
e = lambda value: html.escape(str(value), quote=True)
groups = list(dict.fromkeys(item['group'] for item in items))
sections = []
for group in groups:
    rows = [item for item in items if item['group'] == group]
    section = [f'<div class="shopping-group"><div class="group-heading"><h3>{e(group)}</h3><span>{len(rows):02d} POSTER</span></div>']
    if group == 'Har du dette fra før?':
        section.append('<p class="group-note">Kjøp bare det som mangler. Disse postene er valgfrie tillegg til startpakken.</p>')
    for item in rows:
        badge = '<span class="optional-badge">VALGFRITT</span>' if item['optional'] else ''
        extra = f'<p class="product-extra">{e(item["extra"])}</p>' if item['extra'] else ''
        origin = 'Norsk butikk' if item['origin'] == 'no' else 'Utenlandsk butikk / distributør'
        section.append(f'''<article class="product" data-origin="{e(item['origin'])}">
          <input type="checkbox" id="buy-{e(item['id'])}" aria-label="På plass: {e(item['name'])}">
          <div><h4><label for="buy-{e(item['id'])}">{e(item['name'])}</label>{badge}</h4><p>{e(item['description'])}</p>{extra}<div class="product-meta"><span class="quantity">{e(item['qty'])}</span><span class="origin">{origin}</span></div></div>
          <div class="product-buy"><a href="{e(item['url'])}" target="_blank" rel="noopener noreferrer" aria-label="Se {e(item['name'])} hos {e(item['store'])} (ny fane)">{e(item['store'])} ↗</a><span class="price">{e(item['price'])}</span><span>{e(item['stock'])}</span></div>
        </article>''')
    section.append('</div>')
    sections.append('\n'.join(section))

page = ROOT / 'index.html'
source = page.read_text()
start, end = '<!-- SHOPPING_LIST_START -->', '<!-- SHOPPING_LIST_END -->'
assert source.count(start) == source.count(end) == 1
source = source.split(start)[0] + start + '\n' + '\n'.join(sections) + '\n      ' + end + source.split(end)[1]
page.write_text(source)

csv_text = io.StringIO()
writer = csv.writer(csv_text, lineterminator='\n')
writer.writerow(['Kategori', 'Produkt', 'Kjøp antall', 'Butikk', 'Butikktype', 'Pris vist 2026-10-20', 'Lagerforbehold', 'Valgfritt', 'Bruk', 'Merknad', 'Lenke'])
for item in items:
    writer.writerow([item['group'], item['name'], item['qty'], item['store'], item['origin'], item['price'], item['stock'], 'Ja' if item['optional'] else 'Nei', item['description'], item['extra'], item['url']])
(ROOT / 'downloads/shopping-list.csv').write_text(csv_text.getvalue(), encoding='utf-8-sig')

# Keep the downloadable instructions in sync with the page instead of shipping an older US-only list.
readme = ROOT / 'downloads/README.md'
guide = readme.read_text()
shopping = ['## Buy list', '', 'Shopping list checked 20 October 2026. Product-page prices and availability may change. Norway delivery, freight, checkout VAT and import charges have not been verified. No purchase has been made. The exact resistor value is pending a first-lamp test.', '']
for group in groups:
    shopping.extend([f'### {group}', ''])
    for item in items:
        shopping.append(f"- **{item['qty']} — [{item['name']}]({item['url']})** ({item['store']}). {item['description']} {item['extra']} Price: {item['price']}. Availability: {item['stock']}.")
    shopping.append('')
shopping.extend(['The bank stays outside the enclosure. Use its supplied charging cable and an existing compatible USB charger, or the optional charger listed above. USB-A is the always-on output. Confirm the charging input against the manual for the revision received; the top USB-C PD port is not always-on compatible.', ''])
guide, count = re.subn(r'## Buy list\n.*?(?=## Box dimensions)', '\n'.join(shopping) + '\n', guide, count=1, flags=re.S)
assert count == 1
guide = guide.replace('insulate unused green/white data wires separately', 'identify and individually insulate all unused data/shield conductors')
readme.write_text(guide.rstrip() + '\n')

package = ROOT / 'downloads/bookshelf-lighting-v1.zip'
with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted((ROOT / 'downloads').rglob('*')):
        if path.is_file() and path != package:
            checked = date.fromisoformat(data['checked'])
            info = zipfile.ZipInfo('bookshelf-lighting-v1/' + str(path.relative_to(ROOT / 'downloads')), (checked.year, checked.month, checked.day, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
print(f'Rendered {len(items)} products, CSV, guide and ZIP.')
