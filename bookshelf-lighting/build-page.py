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
assert all(item['origin'] == 'no' for item in items), 'Purchase links must be Norwegian stores'
for item in items:
    assert isinstance(item['unitPriceOre'], int) and item['unitPriceOre'] > 0, f"Missing verified price: {item['id']}"
    assert isinstance(item['buyQuantity'], int) and item['buyQuantity'] > 0
    assert item['budgetCategory'] in ('parts', 'tools', 'extras')
    assert item['priceChecked'] == data['checked'] == item['stockChecked']
    assert 'sjekk butikk' not in (item['price'] + item['stock']).lower()
def money(ore):
    return f'{ore / 100:,.2f}'.replace(',', ' ').replace('.', ',') + ' kr'
def amount(category):
    return sum(i['unitPriceOre'] * i['buyQuantity'] for i in items if i['budgetCategory'] == category)
parts, tools, extras = amount('parts'), amount('tools'), amount('extras')
reserve = data['budget']['batteryReserveOre'] + data['budget']['shippingReserveOre']
e = lambda value: html.escape(str(value), quote=True)
routes = data['purchasePlan']['routes']
route_by_id = {r['id']: r for r in routes}
assert set(route_by_id) == {'storo', 'city', 'online', 'hold'}
assert all(i['purchaseRoute'] in route_by_id for i in items)
assert all(i['purchaseRoute'] == 'hold' for i in items if i.get('pending'))
groups = list(route_by_id)

sections = []
for group in groups:
    rows = [item for item in items if item['purchaseRoute'] == group]
    route = route_by_id[group]
    route_subtotal = sum(i['unitPriceOre'] * i['buyQuantity'] for i in rows if not i['optional'])
    section = [f'<div class="shopping-group" id="route-{e(group)}"><div class="group-heading"><h3>{e(route["title"])}</h3><span>{len(rows):02d} POSTER</span><strong data-route-total="{e(group)}">{money(route_subtotal)}</strong></div><p class="group-note">{e(route["location"])}. Beløpet viser gjenstående varer i denne gruppen; valgfrie tillegg er utelatt til de velges.</p>']
    if group == 'Har du dette fra før?':
        section.append('<p class="group-note">Kjøp bare det som mangler. Disse postene er valgfrie tillegg til startpakken.</p>')
    for item in rows:
        badge = '<span class="optional-badge">AVVENT KJØP</span>' if item.get('pending') else ('<span class="optional-badge">VALGFRITT</span>' if item['optional'] else '')
        extra = f'<p class="product-extra">{e(item["extra"])}</p>' if item['extra'] else ''
        origin = 'Norsk butikk' if item['origin'] == 'no' else 'Utenlandsk butikk / distributør'
        section.append(f'''<article class="product" data-origin="{e(item['origin'])}" data-line-ore="{item['unitPriceOre'] * item['buyQuantity']}" data-budget-category="{item['budgetCategory']}" data-store="{e(item['store'])}" data-purchase-route="{item['purchaseRoute']}">
          <input type="checkbox" id="buy-{e(item['id'])}" aria-label="På plass: {e(item['name'])}">
          <div><h4><label for="buy-{e(item['id'])}">{e(item['name'])}</label>{badge}</h4><p>{e(item['description'])}</p>{extra}<div class="product-meta"><span class="quantity">{e(item['qty'])}</span><span class="origin">{origin}</span><span class="purchase-route">{e(item['purchaseLocation'])}</span></div></div>
          <div class="product-buy"><a href="{e(item['url'])}" target="_blank" rel="noopener noreferrer" aria-label="Se {e(item['name'])} hos {e(item['store'])} (ny fane)">{e(item['store'])} ↗</a><strong class="line-price">{money(item['unitPriceOre'] * item['buyQuantity'])} totalt</strong><span class="price">{item['buyQuantity']} × {money(item['unitPriceOre'])} · {e(item['unitLabel'])}</span><span class="local-stock">{e(item['localStock'])}</span><span>{e(item['stock'])}</span><span>Kontrollert {e(item['priceChecked'])} · inkl. mva.</span></div>
        </article>''')
    section.append('</div>')
    sections.append('\n'.join(section))

page = ROOT / 'index.html'
source = page.read_text()
start, end = '<!-- SHOPPING_LIST_START -->', '<!-- SHOPPING_LIST_END -->'
assert source.count(start) == source.count(end) == 1
source = source.split(start)[0] + start + '\n' + '\n'.join(sections) + '\n      ' + end + source.split(end)[1]
stores = list(dict.fromkeys(i['store'] for i in items))
store_rows = ''.join(f'<tr><th scope="row">{e(store)}</th><td data-store-total="{e(store)}">{money(sum(i['unitPriceOre'] * i['buyQuantity'] for i in items if i['store']==store and not i['optional']))}</td></tr>' for store in stores)
budget_html = f'''<section id="budsjett" class="budget-panel" aria-labelledby="budget-heading">
 <p class="eyebrow">KOSTNAD FOR FEM LYKTER</p><h2 id="budget-heading">Hva koster prosjektet?</h2>
 <div class="budget-cards"><div><span>Byggdeler i listen</span><strong>{money(parts)}</strong><small>Inkl. full filamentrull og kandidatdelene.</small></div><div><span>Verktøy hvis alt må kjøpes</span><strong>{money(tools)}</strong><small>Engangskjøp. Bruk eller lån det du har.</small></div><div class="budget-total"><span>Planleggingsbudsjett fra null</span><strong id="budget-total">{money(parts+tools+reserve)}</strong><small id="budget-formula">Varer {money(parts+tools)} + batterireserve {money(data['budget']['batteryReserveOre'])} + fraktreserve {money(data['budget']['shippingReserveOre'])}.</small></div></div>
 <p class="budget-scenario">Med verktøy fra før: <b id="budget-with-tools">{money(parts+reserve)}</b> inkludert de samme reservene. Uten reserver er varebeløpet for hele basislisten <b>{money(parts+tools)}</b>.</p>
 <p class="budget-caveat"><b>Dette er et budsjett, ikke en ferdig levert pris.</b> Batteri, holder og batterisidens vern er ikke valgt. De er dekket av en synlig reserve, ikke satt til 0 kr. Frakten er også en reserve for flere butikker. Lyktene du allerede eier og selve 3D-printeren er ikke med. Kampanjerabatter og strøm til printing er ikke trukket fra eller lagt til.</p>
 <div class="budget-controls"><label>Batteri, holder og vern · anslag (kr)<input id="battery-reserve" type="number" min="0" max="100000" step="0.01" value="{data['budget']['batteryReserveOre']/100:g}"></label><label>Samlet frakt · anslag (kr)<input id="shipping-reserve" type="number" min="0" max="100000" step="0.01" value="{data['budget']['shippingReserveOre']/100:g}"></label><label class="budget-extra"><input id="include-extras" type="checkbox"> Ta med valgfrie tillegg (+{money(extras)})</label></div>
 <p class="small-note">Reserver er redigerbare planleggingsanslag, ikke innhentede tilbud. Prisene på alle {len(items)} listede varer er lest i nettbutikkene {e(data['checked'])}, inkl. mva. Antall er regnet med: eksempelvis seks kontaktpar à 99 kr = 594 kr. Ekstra loddetinn, skyvelære, vegglader og loddematte er valgfrie og utelatt som standard.</p>
 <div class="budget-remaining"><div><span>Gjenstår å kjøpe · inkl. valgte reserver</span><strong id="budget-remaining" aria-live="polite">{money(parts+tools+reserve)}</strong><small id="budget-owned">Kryss av «har fra før / kjøpt» i listen; beløpet trekkes fra her.</small></div><div class="budget-shortcuts"><button class="small-button" id="own-tools" type="button">Jeg har verktøyene</button><a href="#handleliste">Gå til kjøpslisten ↓</a></div></div>
 <details><summary>Fordeling per butikk · varer som gjenstår</summary><table class="store-totals"><thead><tr><th scope="col">Butikk</th><th scope="col">Varer inkl. mva.</th></tr></thead><tbody>{store_rows}</tbody></table><p class="small-note">Frakt og batterireserve står separat over. Kontrollboksens kandidatdeler er med i budsjettet, men merket «avvent kjøp». Søk og butikkfilter endrer ikke totalsummen.</p></details>
</section>'''
trip_cards = []
for route in routes:
    rid = route['id']
    base = sum(i['unitPriceOre'] * i['buyQuantity'] for i in items if i['purchaseRoute'] == rid and not i['optional'])
    optional = sum(i['unitPriceOre'] * i['buyQuantity'] for i in items if i['purchaseRoute'] == rid and i['optional'])
    link = f'<a href="{e(route["url"])}" target="_blank" rel="noopener noreferrer">Butikk, adresse og åpningstider ↗</a>' if route['url'] else ''
    trip_cards.append(f'''<article class="trip-card"><h3>{e(route['title'])}</h3><p>{e(route['location'])}</p><strong data-route-total="{rid}">{money(base)}</strong><small>Varer inkl. mva. · ekstra valgfrie varer: {money(optional)}</small><p>{e(route['details'])}</p>{link}<a class="trip-list-link" href="#route-{rid}">Se varene og kryss av ↓</a></article>''')
trip_html = '<section id="handletur" class="trip-panel" aria-labelledby="trip-heading"><p class="eyebrow">LOKAL HANDLEPLAN · KONTROLLERT 20. OKTOBER 2026</p><h2 id="trip-heading">Storo, sentrum eller nett?</h2><p>Handle listen som en konkret tur: Storo for det som faktisk er på lager der, Torggata 6 som alternativ for tre varer, og nettbestilling for resten. Kjøp bare verktøy du mangler. Knappene går til samme avkryssingsliste som budsjettet bruker.</p><div class="trip-cards">' + ''.join(trip_cards) + '</div><p class="small-note">Lagerstatus er et øyeblikksbilde fra butikkvelgerne, ikke fra kjedenes nettlager. Ingen reservasjon eller ordre er lagt inn. Sjekk/velg hentebutikken på produktlenken før avreise, særlig der bare ett eksemplar er oppgitt. Frakt og batterireserve står separat i budsjettet. Ingen kampanjerabatt er forutsatt.</p></section>'
ts, te = '<!-- TRIP_START -->', '<!-- TRIP_END -->'
assert source.count(ts) == source.count(te) == 1
source = source.split(ts)[0] + ts + '\n' + trip_html + '\n' + te + source.split(te)[1]
bs, be = '<!-- BUDGET_START -->', '<!-- BUDGET_END -->'
assert source.count(bs) == source.count(be) == 1
source = source.split(bs)[0] + bs + '\n' + budget_html + '\n' + be + source.split(be)[1]
ps, pe = '<!-- PRICE_PEEK_START -->', '<!-- PRICE_PEEK_END -->'
assert source.count(ps) == source.count(pe) == 1
source = source.split(ps)[0] + ps + f'<a class="price-peek" href="#budsjett">Budsjett: {money(parts+reserve)} med egne verktøy · {money(parts+tools+reserve)} fra null ↓</a>' + pe + source.split(pe)[1]
page.write_text(source)

csv_text = io.StringIO()
writer = csv.writer(csv_text, lineterminator='\n')
writer.writerow(['Kategori', 'Kjøpsmåte', 'Kjøpssted', 'Lokal lagerstatus', 'Produkt', 'Kjøp antall', 'Butikk', 'Butikktype', 'Enhetspris inkl. mva. (øre)', 'Antall kjøpsenheter', 'Linjesum inkl. mva. (øre)', 'Prisgrunnlag', 'Lager kontrollert 2026-10-20', 'Valgfritt', 'Bruk', 'Merknad', 'Lenke'])
for item in items:
    writer.writerow([item['group'], item['purchaseRoute'], item['purchaseLocation'], item['localStock'], item['name'], item['qty'], item['store'], item['origin'], item['unitPriceOre'], item['buyQuantity'], item['unitPriceOre'] * item['buyQuantity'], item['price'], item['stock'], 'Ja' if item['optional'] else 'Nei', item['description'], item['extra'], item['url']])
(ROOT / 'downloads/shopping-list.csv').write_text(csv_text.getvalue(), encoding='utf-8-sig')

# Keep the downloadable instructions in sync with the page instead of shipping an older US-only list.
readme = ROOT / 'downloads/README.md'
guide = readme.read_text()
shopping = ['## Buy list', '', 'Norwegian purchase links checked 20 October 2026. Prices and availability may change. Pending controller candidates are not a complete shopping list. Battery, holder and battery-side protection remain unresolved. No purchase has been made.', '']
shopping.extend([f"Build parts: {money(parts)}. Tools: {money(tools)}. Base-list goods total: {money(parts+tools)} including VAT. Optional extras: {money(extras)} (not included by default).", '', f"Planning total from zero: {money(parts+tools+reserve)}, including a battery/holder/protection reserve of {money(data['budget']['batteryReserveOre'])} and a shipping reserve of {money(data['budget']['shippingReserveOre'])}. With existing tools: {money(parts+reserve)}. Reserves are estimates, not quoted prices. Original lanterns and printer excluded. No campaign discount assumed.", ''])
for group in groups:
    route = route_by_id[group]
    subtotal = sum(i['unitPriceOre'] * i['buyQuantity'] for i in items if i['purchaseRoute'] == group and not i['optional'])
    shopping.extend([f'### {route["title"]} — {money(subtotal)} excluding optional items', '', route['location'] + '. ' + route['details'], ''])
    for item in [i for i in items if i['purchaseRoute'] == group]:
        shopping.append(f"- **{item['qty']} — [{item['name']}]({item['url']})** ({item['store']}). {item['description']} {item['extra']} Price: {item['buyQuantity']} x {money(item['unitPriceOre'])} = {money(item['unitPriceOre'] * item['buyQuantity'])} including VAT. Unit basis: {item['unitLabel']}. Local purchase plan: {item['purchaseLocation']}. Local stock: {item['localStock']}. Online availability: {item['stock']}.")
    shopping.append('')
shopping.extend(['Controller candidates marked AVVENT KJØP must be resolved together before ordering. The v1 controller CAD is archived and does not fit the revised components.', ''])
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
