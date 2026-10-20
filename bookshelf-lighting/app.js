/* The shopping list is rendered into HTML, so product links also work offline / without JS. */
(() => {
  const key = 'bookshelf-lighting-v1-owned';
  const products = [...document.querySelectorAll('.product')];
  const boxes = products.map(p => p.querySelector('input[type=checkbox]'));
  let owned = new Set();
  try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(saved)) owned = new Set(saved.filter(v => typeof v === 'string')); } catch { /* Private browsing or malformed old data. */ }
  const search = document.querySelector('#search');
  const store = document.querySelector('#store-filter');
  const missing = document.querySelector('#missing-only');
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function update() {
    const query = normalize(search.value.trim());
    let visible = 0;
    let checked = 0;
    products.forEach((product, i) => {
      const done = boxes[i].checked;
      checked += Number(done);
      product.classList.toggle('checked', done);
      product.hidden = (query && !normalize(product.textContent).includes(query)) || (store.value !== 'all' && product.dataset.origin !== store.value) || (missing.checked && done);
      visible += Number(!product.hidden);
    });
    document.querySelectorAll('.shopping-group').forEach(group => { group.hidden = ![...group.querySelectorAll('.product')].some(p => !p.hidden); });
    document.querySelector('#no-results').hidden = visible !== 0;
    document.querySelector('#progress-text').textContent = `${checked} av ${products.length} ting på plass`;
    const bar = document.querySelector('#shopping-progress'); bar.max = products.length; bar.value = checked;
  }
  boxes.forEach(box => {
    box.checked = owned.has(box.id);
    box.addEventListener('change', () => {
      if (box.checked) owned.add(box.id); else owned.delete(box.id);
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
