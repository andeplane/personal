/* The shopping list is rendered into HTML, so product links also work offline / without JS. */
(() => {
  const key = 'bookshelf-lighting-v1-owned';
  const products = [...document.querySelectorAll('.product')];
  const boxes = products.map(p => p.querySelector('input[type=checkbox]'));
  const ownedKey = box => box.dataset.ownershipKey || box.id;
  let owned = new Set();
  try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(saved)) owned = new Set(saved.filter(v => typeof v === 'string')); } catch { /* Private browsing or malformed old data. */ }
  const search = document.querySelector('#search');
  const store = document.querySelector('#store-filter');
  const missing = document.querySelector('#missing-only');
  const batteryReserve = document.querySelector('#battery-reserve');
  const shippingReserve = document.querySelector('#shipping-reserve');
  const includeExtras = document.querySelector('#include-extras');
  const budgetKey = 'bookshelf-lighting-budget-v1';
  const money = ore => new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', minimumFractionDigits: 2 }).format(ore / 100);
  const lineCost = product => Number(product.dataset.lineOre);
  const included = product => product.dataset.budgetCategory !== 'extras' || includeExtras.checked;
  try {
    const prefs = JSON.parse(localStorage.getItem(budgetKey) || 'null');
    if (prefs && Number.isFinite(prefs.battery) && prefs.battery >= 0 && prefs.battery <= 100000) batteryReserve.value = prefs.battery;
    if (prefs && Number.isFinite(prefs.shipping) && prefs.shipping >= 0 && prefs.shipping <= 100000) shippingReserve.value = prefs.shipping;
    if (typeof prefs?.extras === 'boolean') includeExtras.checked = prefs.extras;
  } catch { /* Defaults remain available when browser storage is unavailable. */ }
  function updateBudget() {
    const selected = products.filter(included);
    const goods = selected.reduce((sum, product) => sum + lineCost(product), 0);
    const ownedCost = selected.reduce((sum, product) => sum + (product.querySelector('input').checked ? lineCost(product) : 0), 0);
    document.querySelectorAll('[data-store-total]').forEach(cell => {
      const total = selected.filter(product => product.dataset.store === cell.dataset.storeTotal && !product.querySelector('input').checked).reduce((sum, product) => sum + lineCost(product), 0);
      cell.textContent = money(total);
    });
    document.querySelectorAll('[data-route-total]').forEach(cell => {
      const total = selected.filter(product => product.dataset.purchaseRoute === cell.dataset.routeTotal && !product.querySelector('input').checked).reduce((sum, product) => sum + lineCost(product), 0);
      cell.textContent = money(total);
    });
    if (!batteryReserve.value || !shippingReserve.value || !batteryReserve.checkValidity() || !shippingReserve.checkValidity()) {
      document.querySelector('#budget-total').textContent = 'Fyll inn reservene';
      document.querySelector('#budget-remaining').textContent = 'Fyll inn reservene';
      document.querySelector('#budget-formula').textContent = 'Begge reservefeltene trenger et beløp fra 0 til 100 000 kr. Tomme felt regnes ikke som 0 kr.';
      document.querySelector('#budget-with-tools').textContent = 'Fyll inn reservene';
      document.querySelector('.price-peek').textContent = 'Se og fullfør kostnadsbudsjettet ↓';
      return;
    }
    const battery = Math.round(batteryReserve.valueAsNumber * 100);
    const shipping = Math.round(shippingReserve.valueAsNumber * 100);
    const reserves = battery + shipping;
    const toolCost = selected.filter(product => product.dataset.budgetCategory === 'tools').reduce((sum, product) => sum + lineCost(product), 0);
    document.querySelector('#budget-total').textContent = money(goods + reserves);
    document.querySelector('#budget-remaining').textContent = money(goods - ownedCost + reserves);
    document.querySelector('#budget-with-tools').textContent = money(goods - toolCost + reserves);
    document.querySelector('#budget-formula').textContent = `Varer ${money(goods)} + batterireserve ${money(battery)} + fraktreserve ${money(shipping)}.`;
    document.querySelector('#budget-owned').textContent = `${money(ownedCost)} trukket fra for ting som er kjøpt / finnes fra før. Reserver ${money(reserves)} kommer i tillegg til gjenstående varer.`;
    document.querySelector('.price-peek').textContent = `Budsjett: ${money(goods - toolCost + reserves)} med egne verktøy · ${money(goods + reserves)} fra null ↓`;
    try { localStorage.setItem(budgetKey, JSON.stringify({ battery: battery / 100, shipping: shipping / 100, extras: includeExtras.checked })); } catch { /* Totals still work without persistence. */ }
  }
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function update() {
    updateBudget();
    const query = normalize(search.value.trim());
    let visible = 0;
    let checked = 0;
    products.forEach((product, i) => {
      const done = boxes[i].checked;
      checked += Number(done);
      product.classList.toggle('checked', done);
      product.hidden = (query && !normalize(product.textContent).includes(query)) || (store.value !== 'all' && product.dataset.purchaseRoute !== store.value) || (missing.checked && done);
      visible += Number(!product.hidden);
    });
    document.querySelectorAll('.shopping-group').forEach(group => { group.hidden = ![...group.querySelectorAll('.product')].some(p => !p.hidden); });
    document.querySelector('#no-results').hidden = visible !== 0;
    document.querySelector('#progress-text').textContent = `${checked} av ${products.length} ting på plass`;
    const bar = document.querySelector('#shopping-progress'); bar.max = products.length; bar.value = checked;
  }
  boxes.forEach(box => {
    box.checked = owned.has(ownedKey(box));
    box.addEventListener('change', () => {
      if (box.checked) owned.add(ownedKey(box)); else owned.delete(ownedKey(box));
      try { localStorage.setItem(key, JSON.stringify([...owned])); } catch { /* Checklist still works for this visit. */ }
      update();
    });
  });
  search.addEventListener('input', update); store.addEventListener('change', update); missing.addEventListener('change', update);
  document.querySelector('#reset-list').addEventListener('click', () => {
    owned.clear(); boxes.forEach(box => { box.checked = false; });
    try { localStorage.removeItem(key); } catch { /* No persistence available. */ }
    update();
  });
  batteryReserve.addEventListener('input', updateBudget);
  shippingReserve.addEventListener('input', updateBudget);
  includeExtras.addEventListener('change', updateBudget);
  document.querySelector('#own-tools').addEventListener('click', () => {
    products.forEach((product, i) => {
      if (product.dataset.budgetCategory === 'tools') { boxes[i].checked = true; owned.add(ownedKey(boxes[i])); }
    });
    try { localStorage.setItem(key, JSON.stringify([...owned])); } catch { /* No persistence available. */ }
    update();
  });
  document.querySelector('#print-list').addEventListener('click', () => window.print());
  update();
})();

let viewerPromise;
let selectedPart = 'controller-base';
let selectionVersion = 0;
const loadButton = document.querySelector('#load-3d');

async function createViewer() {
  // Same pinned three.js release as the site's garage planner. Loaded only on request.
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js');
  const [{ OrbitControls }, { STLLoader }] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/controls/OrbitControls.js'),
    import('https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/STLLoader.js')
  ]);
  const container = document.querySelector('#model-viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xf6f5ef);
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 3000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x45625a, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 3.5); light.position.set(100, -100, 200); scene.add(light);
  const fill = new THREE.DirectionalLight(0xffe7c8, 1.3); fill.position.set(-100, 80, 80); scene.add(fill);
  let mesh;
  const loader = new STLLoader();
  function render() { renderer.render(scene, camera); }
  controls.addEventListener('change', render);
  const observer = new ResizeObserver(() => {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
  });
  observer.observe(container);
  return async function showPart(part, version) {
    const geometry = await loader.loadAsync(`downloads/print-files/${part}.stl`);
    if (version !== selectionVersion) { geometry.dispose(); return; }
    geometry.center(); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
    mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x384b48, roughness: 0.68, metalness: 0.06 }));
    scene.add(mesh);
    container.hidden = false;
    document.querySelector('.cad-preview>img').hidden = true;
    document.querySelector('#model-help').hidden = false;
    document.querySelector('#model-help').textContent = 'Dra for å rotere · rull / klyp for zoom · velg en del under. Visningen viser geometrien; bruk STL-filen i sliceren.';
    const width = container.clientWidth, height = container.clientHeight;
    camera.aspect = width / height;
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distance = geometry.boundingSphere.radius * 1.15 / Math.sin(Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect)));
    camera.position.set(distance * .62, -distance * .8, distance * .9);
    camera.near = .1; camera.far = distance * 15; camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0); controls.minDistance = geometry.boundingSphere.radius * 1.1; controls.maxDistance = distance * 4;
    controls.update(); renderer.setSize(width, height, false); render();
  };
}

async function displayPart(part, title) {
  selectedPart = part;
  const version = ++selectionVersion;
  loadButton.disabled = true; loadButton.textContent = 'Laster 3D…';
  try {
    if (!viewerPromise) viewerPromise = createViewer();
    const show = await viewerPromise;
    if (version !== selectionVersion) return;
    await show(part, version);
    if (version !== selectionVersion) return;
    document.querySelector('#model-caption').textContent = title;
    loadButton.textContent = 'Tilbakestill visning ↺';
    document.querySelector('#model-viewport').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  } catch (error) {
    console.warn('3D viewer unavailable:', error);
    viewerPromise = undefined;
    document.querySelector('.cad-preview>img').hidden = false;
    document.querySelector('#model-viewport').hidden = true;
    document.querySelector('#model-help').hidden = false;
    document.querySelector('#model-help').textContent = '3D-visningen kunne ikke lastes. CAD-bildet og nedlastingene virker fortsatt. Prøv igjen med nett og WebGL aktivert.';
    loadButton.textContent = 'Prøv 3D igjen ↗';
  } finally { if (version === selectionVersion) loadButton.disabled = false; }
}
loadButton.addEventListener('click', () => {
  const partButton = document.querySelector(`[data-part="${selectedPart}"]`);
  displayPart(selectedPart, partButton.dataset.title);
});
document.querySelectorAll('[data-part]').forEach(button => button.addEventListener('click', () => displayPart(button.dataset.part, button.dataset.title)));
