let THREE;
let OrbitControls;
let STLLoader;
let OBJLoader;

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MILLIMETRES_PER_UNIT = { mm: 1, cm: 10, m: 1000, in: 25.4 };

const viewport = document.querySelector('#viewport');
const emptyState = document.querySelector('#viewport-empty');
const stateLabel = document.querySelector('#viewport-state');
const message = document.querySelector('#inspector-message');
const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const unitsSelect = document.querySelector('#source-units');
const wireframeButton = document.querySelector('#wireframe-toggle');
const resetButton = document.querySelector('#reset-view');

const output = {
  x: document.querySelector('#dimension-x'),
  y: document.querySelector('#dimension-y'),
  z: document.querySelector('#dimension-z'),
  vertices: document.querySelector('#vertex-count'),
  triangles: document.querySelector('#triangle-count'),
  meshes: document.querySelector('#mesh-count'),
  hint: document.querySelector('#measurement-hint'),
};

let renderer;
let scene;
let camera;
let controls;
let activeGrid;
let activeAxes;
let activeModel;
let activeMeshes = [];
let currentFile;
let currentBounds;
let wireframeEnabled = false;
let viewerReady = false;
let viewerLoading = true;
let pendingFile;

function setMessage(text, kind = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
}

function setState(text, state = 'ready') {
  stateLabel.textContent = text;
  stateLabel.dataset.state = state;
}

function clearMeasurements() {
  output.x.textContent = '—';
  output.y.textContent = '—';
  output.z.textContent = '—';
  output.vertices.textContent = '—';
  output.triangles.textContent = '—';
  output.meshes.textContent = '—';
  output.hint.textContent = 'Dimensions will appear after a mesh is loaded.';
}

function initialiseViewer() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xF8FAFB, 1);
    viewport.prepend(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF8FAFB);
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000000);
    camera.position.set(180, 140, 200);

    scene.add(new THREE.HemisphereLight(0xFFFFFF, 0x63798A, 2.1));
    const keyLight = new THREE.DirectionalLight(0xFFFFFF, 2.2);
    keyLight.position.set(120, 180, 140);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xDCE8F0, 0.8);
    fillLight.position.set(-120, 70, -80);
    scene.add(fillLight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.screenSpacePanning = true;

    resizeViewer();
    window.addEventListener('resize', resizeViewer);
    requestAnimationFrame(animate);
    return true;
  } catch (error) {
    console.error('BrickForge viewer initialisation failed:', error);
    setState('3D VIEWER UNAVAILABLE', 'error');
    setMessage(
      'The 3D viewer could not start. Check browser WebGL support and try reloading this page.',
      'error',
    );
    return false;
  }
}

function resizeViewer() {
  if (!renderer || !camera) return;
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function countMeshData(root) {
  let vertices = 0;
  let triangles = 0;
  const meshes = [];

  root.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const geometry = object.geometry;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const vertexCount = geometry.attributes.position.count;
    const triangleCount = geometry.index
      ? geometry.index.count / 3
      : vertexCount / 3;
    vertices += vertexCount;
    triangles += triangleCount;
    meshes.push(object);
  });

  return { vertices, triangles: Math.round(triangles), meshes };
}

function removeActiveModel() {
  if (!activeModel) return;
  scene.remove(activeModel);
  activeModel.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => material.dispose?.());
    } else {
      object.material?.dispose?.();
    }
  });
  activeModel = null;
  activeMeshes = [];
}

function disposeHelper(helper) {
  if (!helper) return;
  scene.remove(helper);
  helper.geometry?.dispose?.();
  if (Array.isArray(helper.material)) {
    helper.material.forEach((material) => material.dispose?.());
  } else {
    helper.material?.dispose?.();
  }
}

function replaceReferenceHelpers(maxDimension, height) {
  disposeHelper(activeGrid);
  disposeHelper(activeAxes);
  const gridSize = Math.max(maxDimension * 2.2, 20);
  activeGrid = new THREE.GridHelper(gridSize, 22, 0x9DADB9, 0xD7E0E6);
  activeGrid.position.y = -height / 2;
  scene.add(activeGrid);
  activeAxes = new THREE.AxesHelper(Math.max(maxDimension * 0.32, 8));
  scene.add(activeAxes);
}

function fitCamera(size) {
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDimension * 2.15;
  camera.near = Math.max(0.01, maxDimension / 10000);
  camera.far = maxDimension * 100;
  camera.position.set(distance * 1.25, distance * 0.92, distance * 1.45);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = Math.max(maxDimension * 0.06, 0.1);
  controls.maxDistance = maxDimension * 30;
  controls.update();
}

function formatMillimetres(value) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm`;
}

function displayMeasurements(size, stats, fileName, sourceUnit) {
  output.x.textContent = formatMillimetres(size.x);
  output.y.textContent = formatMillimetres(size.y);
  output.z.textContent = formatMillimetres(size.z);
  output.vertices.textContent = stats.vertices.toLocaleString();
  output.triangles.textContent = stats.triangles.toLocaleString();
  output.meshes.textContent = stats.meshes.length.toLocaleString();
  output.hint.textContent = `${fileName} · interpreted as ${sourceUnit}`;
}

function buildModelFromGeometry(geometry) {
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x839DB0,
      roughness: 0.56,
      metalness: 0.04,
      wireframe: wireframeEnabled,
      side: THREE.DoubleSide,
    }),
  );
}

function prepareModel(object, unitFactor, sourceUnit) {
  const stats = countMeshData(object);
  if (stats.meshes.length === 0) {
    throw new Error('No triangle mesh geometry was found in this file.');
  }

  object.scale.multiplyScalar(unitFactor);
  object.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) throw new Error('The file contains no measurable geometry.');

  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(Number.isFinite)) {
    throw new Error('The mesh contains invalid or non-finite coordinates.');
  }
  if (Math.max(size.x, size.y, size.z) <= 0) {
    throw new Error('The mesh has zero size and cannot be previewed.');
  }

  const center = bounds.getCenter(new THREE.Vector3());
  object.position.sub(center);
  object.updateMatrixWorld(true);

  stats.meshes.forEach((mesh) => {
    mesh.material = new THREE.MeshStandardMaterial({
      color: 0x839DB0,
      roughness: 0.56,
      metalness: 0.04,
      wireframe: wireframeEnabled,
      side: THREE.DoubleSide,
    });
  });

  removeActiveModel();
  activeModel = object;
  activeMeshes = stats.meshes;
  scene.add(activeModel);
  replaceReferenceHelpers(Math.max(size.x, size.y, size.z), size.y);
  fitCamera(size);
  currentBounds = size;
  displayMeasurements(size, stats, currentFile.name, sourceUnit);
  emptyState.hidden = true;
  wireframeButton.disabled = false;
  resetButton.disabled = false;
  setState('MESH LOADED', 'loaded');
  setMessage(
    `Mesh loaded locally. Source units interpreted as ${sourceUnit}; measurements are shown in millimetres. No LEGO buildability check has been run.`,
    'success',
  );
}

async function parseFile(file) {
  const unit = unitsSelect.value || 'mm';
  unitsSelect.value = unit;

  if (file.size > MAX_FILE_BYTES) {
    throw new Error('This file is larger than the 100 MB prototype limit.');
  }
  if (file.size === 0) {
    throw new Error('This file is empty.');
  }

  const extension = file.name.split('.').pop()?.toLowerCase();
  let object;

  if (extension === 'stl') {
    const buffer = await file.arrayBuffer();
    const geometry = new STLLoader().parse(buffer);
    object = buildModelFromGeometry(geometry);
  } else if (extension === 'obj') {
    const sourceText = await file.text();
    object = new OBJLoader().parse(sourceText);
  } else {
    throw new Error('Unsupported file type. Please choose an STL or OBJ file.');
  }

  prepareModel(object, MILLIMETRES_PER_UNIT[unit], unit);
}

async function handleFile(file) {
  if (!file) return;
  if (!viewerReady) {
    if (viewerLoading) {
      pendingFile = file;
      setState('STARTING 3D VIEWER');
      setMessage('Preparing the 3D viewer. Your selected file will load automatically.');
    } else {
      setMessage('The 3D viewer is unavailable. Check browser WebGL support and reload this page.', 'error');
    }
    return;
  }

  currentFile = file;
  clearMeasurements();
  setState('READING FILE');
  setMessage(`Reading ${file.name} in your browser…`);

  try {
    await parseFile(file);
  } catch (error) {
    console.error('BrickForge could not load the selected mesh:', error);
    removeActiveModel();
    emptyState.hidden = false;
    wireframeButton.disabled = true;
    resetButton.disabled = true;
    currentBounds = null;
    setState('LOAD FAILED', 'error');
    setMessage(error instanceof Error ? error.message : 'The file could not be read.', 'error');
    clearMeasurements();
  }
}

fileInput.addEventListener('change', (event) => {
  const [file] = event.target.files || [];
  fileInput.value = '';
  handleFile(file);
});

unitsSelect.addEventListener('change', () => {
  if (currentFile) handleFile(currentFile);
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('is-dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
  const [file] = event.dataTransfer?.files || [];
  if (file) handleFile(file);
});

wireframeButton.addEventListener('click', () => {
  wireframeEnabled = !wireframeEnabled;
  activeMeshes.forEach((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => { material.wireframe = wireframeEnabled; });
  });
  wireframeButton.textContent = wireframeEnabled ? 'Hide wireframe' : 'Show wireframe';
  wireframeButton.setAttribute('aria-pressed', String(wireframeEnabled));
});

resetButton.addEventListener('click', () => {
  if (currentBounds) fitCamera(currentBounds);
});

async function startInspector() {
  try {
    [THREE, { OrbitControls }, { STLLoader }, { OBJLoader }] = await Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/loaders/STLLoader.js'),
      import('three/addons/loaders/OBJLoader.js'),
    ]);

    viewerReady = initialiseViewer();
    viewerLoading = false;
    if (viewerReady && pendingFile) {
      const file = pendingFile;
      pendingFile = null;
      handleFile(file);
    }
  } catch (error) {
    viewerLoading = false;
    console.error('BrickForge could not load its 3D modules:', error);
    setState('3D LIBRARY FAILED', 'error');
    setMessage(
      'The 3D viewer could not download its rendering library. Check your connection or content blocker, then reload this page.',
      'error',
    );
  }
}

startInspector();
