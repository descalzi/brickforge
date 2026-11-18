const DEFAULT_RAW_BASE = 'https://raw.githubusercontent.com/kulits/ldraw-parts/c70360d1c588be894997b2168c61909bc8058c4d/ldraw/';
let rawBaseUrl = DEFAULT_RAW_BASE;
import { decodeCataloguePayload, ldrawReferenceCandidates, searchPartCatalogue } from './catalogue-utils.js?v=fab991c95518';

const LDU_TO_MM = 0.4;
let curatedSpecialisedCatalogue = null;
const MAX_REFERENCE_DEPTH = 64;

const viewport = document.querySelector('#parts-viewport');
const emptyState = document.querySelector('#parts-empty');
const stateLabel = document.querySelector('#parts-state');
const message = document.querySelector('#parts-message');
const partSelect = document.querySelector('#part-select');
const partSearch = document.querySelector('#part-search');
const defaultPartOptions = Array.from(partSelect.options).map((option) => ({
  value: option.value,
  text: option.textContent,
}));
const colourSelect = document.querySelector('#part-colour');
const resetButton = document.querySelector('#parts-reset');

const partFeatureStatus = document.querySelector('#part-feature-status');
const partFeatureList = document.querySelector('#part-feature-list');
const partFeatureAnalyseButton = document.querySelector('#part-feature-analyse');
const partFeatureDownloadButton = document.querySelector('#part-feature-download');
const partFeatureBatchButton = document.querySelector('#part-feature-batch');
const partFeatureBatchClearButton = document.querySelector('#part-feature-batch-clear');
const partFeatureBatchCancelButton = document.querySelector('#part-feature-batch-cancel');
const partFeatureBatchDownloadButton = document.querySelector('#part-feature-batch-download');
const partFeatureBatchStatus = document.querySelector('#part-feature-batch-status');
const partFeatureBatchQuery = document.querySelector('#part-feature-batch-query');
const partFeatureBatchList = document.querySelector('#part-feature-batch-list');
const partFeatureCuratedButton = document.querySelector('#part-feature-curated');

const output = {
  name: document.querySelector('#part-name'),
  identity: document.querySelector('#part-identity'),
  x: document.querySelector('#part-x'),
  y: document.querySelector('#part-y'),
  z: document.querySelector('#part-z'),
  triangles: document.querySelector('#part-triangles'),
  files: document.querySelector('#part-files'),
  studs: document.querySelector('#part-studs'),
  receivers: document.querySelector('#part-receivers'),
  connectionStatus: document.querySelector('#part-connection-status'),
  source: document.querySelector('#part-source'),
  authors: document.querySelector('#part-authors'),
  licences: document.querySelector('#part-licences'),
};

const fallbackColours = new Map([
  [0, { value: '#1B2A34', edge: '#808080' }],
  [1, { value: '#1E5AA8', edge: '#333333' }],
  [2, { value: '#00852B', edge: '#333333' }],
  [3, { value: '#069D9F', edge: '#333333' }],
  [4, { value: '#B40000', edge: '#333333' }],
  [5, { value: '#D3359D', edge: '#333333' }],
  [6, { value: '#543324', edge: '#1E1E1E' }],
  [7, { value: '#8A928D', edge: '#333333' }],
  [8, { value: '#545955', edge: '#333333' }],
  [14, { value: '#F2CD37', edge: '#333333' }],
  [15, { value: '#FFFFFF', edge: '#333333' }],
]);

let THREE;
let OrbitControls;
let renderer;
let scene;
let camera;
let controls;
let activeModel;
let activeGrid;
let activeAxes;
let currentBounds;
let palette = new Map(fallbackColours);
let viewerReady = false;
let loadSequence = 0;

const rawFileCache = new Map();
const documentCache = new Map();
let connectionProfilesPromise;
let partCatalogue = [];
let connectionProfileMap = new Map();
let loadedPartId = null;
let activePartTrianglePositions = null;
let activePartBoundsMin = null;
let activePartBoundsMax = null;
let activePartDescriptor = null;
let activePartFeatures = [];
let partFeatureWorker = null;
let batchFeatureWorker = null;
let batchScanCancelled = false;
let batchScanRunning = false;
let activeBatchFeatureProfiles = [];


function clearPartFeatureAnalysis() {
  if (partFeatureWorker) {
    partFeatureWorker.terminate();
    partFeatureWorker = null;
  }
  activePartTrianglePositions = null;
  activePartBoundsMin = null;
  activePartBoundsMax = null;
  activePartDescriptor = null;
  activePartFeatures = [];
  partFeatureStatus.textContent = 'Select a part, then analyse its cross-section openings.';
  partFeatureStatus.dataset.state = 'idle';
  partFeatureList.replaceChildren();
  partFeatureAnalyseButton.disabled = !loadedPartId;
  partFeatureDownloadButton.disabled = true;
}

function collectTrianglePositions(faceMap) {
  let totalLength = 0;
  for (const positions of faceMap.values()) totalLength += positions.length;
  const flattened = new Float32Array(totalLength);
  let offset = 0;
  for (const positions of faceMap.values()) {
    flattened.set(positions, offset);
    offset += positions.length;
  }
  return flattened;
}

function calculateTriangleBounds(positions) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
    }
  }
  return { minimum, maximum };
}

function renderPartFeatureResults(features) {
  partFeatureList.replaceChildren();
  features.forEach((feature, index) => {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    const detail = document.createElement('span');
    const position = document.createElement('small');
    heading.textContent = 'Opening ' + (index + 1) + ' · ' + feature.shape;
    detail.textContent = feature.shape === 'round opening'
      ? 'Ø ' + feature.minimum_equivalent_diameter_mm.toFixed(2) + '–'
        + feature.maximum_equivalent_diameter_mm.toFixed(2) + ' mm across sections'
      : feature.minimum_width_mm.toFixed(2) + '–' + feature.maximum_width_mm.toFixed(2)
        + ' × ' + feature.minimum_length_mm.toFixed(2) + '–'
        + feature.maximum_length_mm.toFixed(2) + ' mm';
    position.textContent = 'Axis ' + feature.axis.toUpperCase()
      + ' · ' + feature.sample_support + ' slices · centre '
      + feature.center_mm.map((value) => value.toFixed(2)).join(', ') + ' mm'
      + (feature.path_class ? ' · ' + feature.path_class.replaceAll('_', ' ') : '')
      + (feature.extent_class ? ' · ' + feature.extent_class.replaceAll('_', ' ') : '')
      + (feature.branching_group_id ? ' · branching group ' + feature.branching_group_id : '');
    item.append(heading, detail, position);
    partFeatureList.append(item);
  });
}

function analyseSelectedPartFeatures() {
  if (!activePartTrianglePositions || !activePartDescriptor || partFeatureWorker || batchScanRunning) return;
  partFeatureAnalyseButton.disabled = true;
  partFeatureBatchButton.disabled = true;
  partFeatureDownloadButton.disabled = true;
  partFeatureStatus.textContent = 'Measuring nested contours across the part geometry…';
  partFeatureStatus.dataset.state = 'working';
  setState('ANALYSING PART FEATURES', 'loading');
  setMessage('Sampling principal and oblique cross-sections in a background worker…');

  try {
    partFeatureWorker = new Worker(new URL('./part-feature-worker.js?v=fab991c95518', import.meta.url), { type: 'module' });
  } catch (error) {
    partFeatureAnalyseButton.disabled = false;
    partFeatureBatchButton.disabled = partCatalogue.length === 0;
    partFeatureStatus.textContent = error instanceof Error ? error.message : 'Could not start feature analysis.';
    partFeatureStatus.dataset.state = 'error';
    setState('PART FEATURE ANALYSIS FAILED', 'error');
    setMessage(partFeatureStatus.textContent, 'error');
    return;
  }

  const worker = partFeatureWorker;
  const positions = activePartTrianglePositions.slice();
  worker.addEventListener('message', (event) => {
    if (worker !== partFeatureWorker) return;
    worker.terminate();
    partFeatureWorker = null;
    partFeatureAnalyseButton.disabled = false;
    partFeatureBatchButton.disabled = partCatalogue.length === 0;
    if (event.data.type === 'error') {
      partFeatureStatus.textContent = event.data.message;
      partFeatureStatus.dataset.state = 'error';
      setState('PART FEATURE ANALYSIS FAILED', 'error');
      setMessage(event.data.message, 'error');
      return;
    }
    activePartFeatures = event.data.features;
    renderPartFeatureResults(activePartFeatures);
    partFeatureStatus.textContent = activePartFeatures.length
      ? 'Located ' + activePartFeatures.length + ' nested opening feature(s). Measurements are geometric candidates, not proof of physical compatibility.'
      : 'No stable nested opening contours were found in the sampled principal and oblique section planes.';
    partFeatureStatus.dataset.state = activePartFeatures.length ? 'complete' : 'warning';
    partFeatureDownloadButton.disabled = false;
    setState('PART LOADED', 'loaded');
    setMessage('Part geometry analysis complete. Export a feature profile to use it in future matching.', 'success');
  });
  worker.addEventListener('error', (event) => {
    if (worker !== partFeatureWorker) return;
    worker.terminate();
    partFeatureWorker = null;
    partFeatureAnalyseButton.disabled = false;
    partFeatureBatchButton.disabled = partCatalogue.length === 0;
    partFeatureStatus.textContent = event.message || 'The feature analysis worker failed.';
    partFeatureStatus.dataset.state = 'error';
    setState('PART FEATURE ANALYSIS FAILED', 'error');
    setMessage(partFeatureStatus.textContent, 'error');
  });
  worker.postMessage({
    trianglePositions: positions,
    boundsMin: activePartBoundsMin,
    boundsMax: activePartBoundsMax,
  }, [positions.buffer]);
}


function likelyOpeningPartCandidates(limit = 12, query = 'technic beam') {
  const search = String(query || '').trim() || 'technic';
  if (search === '@curated' && curatedSpecialisedCatalogue) {
    const ids = new Set(curatedSpecialisedCatalogue.profiles.map((profile) => profile.part_id));
    return partCatalogue.filter((entry) => ids.has(entry.part_id)).slice(0, limit);
  }
  return searchPartCatalogue(partCatalogue, search, limit);
}

function analysePositionsInWorker(positions, bounds) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./part-feature-worker.js?v=fab991c95518', import.meta.url), { type: 'module' });
    batchFeatureWorker = worker;
    worker.addEventListener('message', (event) => {
      if (worker !== batchFeatureWorker) return;
      worker.terminate();
      batchFeatureWorker = null;
      if (event.data.type === 'error') reject(new Error(event.data.message));
      else resolve(event.data.features);
    });
    worker.addEventListener('error', (event) => {
      if (worker !== batchFeatureWorker) return;
      worker.terminate();
      batchFeatureWorker = null;
      reject(new Error(event.message || 'Part feature scan worker failed.'));
    });
    worker.postMessage({
      trianglePositions: positions,
      boundsMin: bounds.minimum,
      boundsMax: bounds.maximum,
    }, [positions.buffer]);
  });
}

function renderBatchFeatureProfiles(profiles) {
  partFeatureBatchList.replaceChildren();
  profiles.forEach((profile) => {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    const detail = document.createElement('span');
    heading.textContent = profile.part_id + ' · ' + profile.description;
    detail.textContent = profile.features.length + ' measured opening feature(s)'
      + (profile.source_verified_catalogue_entry?.nominal_connection_interfaces?.length
        ? ' · ' + profile.source_verified_catalogue_entry.nominal_connection_interfaces.length + ' source-derived nominal interface(s)' : '');
    item.append(heading, detail);
    partFeatureBatchList.append(item);
  });
}

async function scanLikelyOpeningParts() {
  if (batchScanRunning || partFeatureWorker) return;
  const query = partFeatureBatchQuery.value.trim() || 'technic';
  const existingIds = new Set(activeBatchFeatureProfiles.map((profile) => profile.part_id));
  const matchingCandidates = likelyOpeningPartCandidates(48, query);
  if (!matchingCandidates.length) {
    partFeatureBatchStatus.textContent = 'No catalogue parts matched “' + query + '”. Try a broader part search phrase.';
    partFeatureBatchStatus.dataset.state = 'warning';
    return;
  }
  const remainingCapacity = 48 - activeBatchFeatureProfiles.length;
  if (remainingCapacity <= 0) {
    partFeatureBatchStatus.textContent = 'The combined catalogue has reached its 48-profile limit. Clear it to start a new catalogue.';
    partFeatureBatchStatus.dataset.state = 'warning';
    return;
  }
  const candidates = matchingCandidates.filter((entry) => !existingIds.has(entry.part_id))
    .slice(0, Math.min(12, remainingCapacity));
  if (!candidates.length) {
    partFeatureBatchStatus.textContent = 'All matching candidates for “' + query + '” are already in the combined catalogue.';
    partFeatureBatchStatus.dataset.state = 'complete';
    return;
  }

  batchScanRunning = true;
  batchScanCancelled = false;
  const startingProfileCount = activeBatchFeatureProfiles.length;
  partFeatureBatchButton.disabled = true;
  partFeatureBatchCancelButton.disabled = false;
  partFeatureBatchDownloadButton.disabled = true;
  partFeatureBatchClearButton.disabled = true;
  partFeatureAnalyseButton.disabled = true;
  partSearch.disabled = true;
  partSelect.disabled = true;
  colourSelect.disabled = true;
  const errors = [];

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      if (batchScanCancelled) break;
      const entry = candidates[index];
      partFeatureBatchStatus.textContent = 'Scanning ' + (index + 1) + ' of ' + candidates.length
        + ' · ' + entry.part_id + ' · ' + (entry.description || entry.part_id);
      partFeatureBatchStatus.dataset.state = 'working';
      setState('SCANNING PART FEATURES ' + (index + 1) + '/' + candidates.length, 'loading');
      setMessage('Resolving candidate part geometry and measuring openings in a background worker…');
      try {
        const root = await getDocument(entry.filename);
        const expansion = {
          faces: new Map(),
          lines: new Map(),
          files: new Set(),
          authors: new Set(),
          licences: new Set(),
        };
        await expandPart(
          root,
          [1, 0, 0, 0, 1, 0, 0, 0, 1],
          [0, 0, 0],
          16,
          new Set(),
          0,
          expansion,
        );
        const positions = collectTrianglePositions(expansion.faces);
        if (positions.length / 9 > 100000) {
          errors.push(entry.part_id + ': exceeds the 100,000-triangle feature analysis limit');
          continue;
        }
        if (!positions.length || positions.length % 9 !== 0) {
          errors.push(entry.part_id + ': no complete triangle geometry');
          continue;
        }
        const bounds = calculateTriangleBounds(positions);
        const triangleCount = positions.length / 9;
        const previewIncluded = triangleCount <= 4000;
        const previewPositions = previewIncluded
          ? Array.from(positions, (value) => Number(value.toFixed(2)))
          : null;
        const features = await analysePositionsInWorker(positions, bounds);
        const dimensions = bounds.maximum.map((value, axis) => value - bounds.minimum[axis]);
        activeBatchFeatureProfiles.push({
          schema_version: 3,
          preview_geometry_included: previewIncluded,
          mesh_triangle_count: previewIncluded ? triangleCount : 0,
          ...(previewIncluded ? { mesh_positions_mm: previewPositions } : {}),
          part_id: entry.part_id,
          description: root.metadata.description,
          source_filename: root.source,
          source_geometry_base_url: rawBaseUrl,
          units: 'mm',
          dimensions_mm: dimensions,
          bounds_mm: [bounds.minimum, bounds.maximum],
          analysis_method: 'Nineteen sampled principal-axis and bounded oblique cross-sections; nested contours clustered across slices',
          features,
          ...(curatedSpecialisedCatalogue?.profiles.find((source) => source.part_id === entry.part_id)
            ? { source_verified_catalogue_entry: curatedSpecialisedCatalogue.profiles.find((source) => source.part_id === entry.part_id), source_library_commit: curatedSpecialisedCatalogue.source_library.commit }
            : {}),
          limitations: [
            'Measurements are based on rendered LDraw surface triangles and sampled principal/oblique section planes; curved paths are classified from centreline deviation, while branching and blind/partial labels remain candidates.',
            'Nominal connection interfaces are kept separate from measured opening geometry.',
            'A geometric opening match does not prove physical clutch, structural stability or legal part combinations.',
          ],
        });
        renderBatchFeatureProfiles(activeBatchFeatureProfiles);
      } catch (error) {
        errors.push(entry.part_id + ': ' + (error instanceof Error ? error.message : 'scan failed'));
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    batchScanRunning = false;
    partFeatureBatchButton.disabled = activeBatchFeatureProfiles.length >= 48;
    partFeatureBatchCancelButton.disabled = true;
    partFeatureBatchDownloadButton.disabled = activeBatchFeatureProfiles.length === 0;
    partFeatureBatchClearButton.disabled = activeBatchFeatureProfiles.length === 0;
    partFeatureAnalyseButton.disabled = !loadedPartId;
    partSearch.disabled = false;
    partSelect.disabled = false;
    colourSelect.disabled = false;
    const suffix = errors.length ? ' ' + errors.length + ' candidate(s) could not be scanned.' : '';
    const addedCount = activeBatchFeatureProfiles.length - startingProfileCount;
    partFeatureBatchStatus.textContent = (batchScanCancelled ? 'Scan cancelled. ' : 'Scan complete. ')
      + addedCount + ' new profile(s) added from ' + candidates.length + ' candidates; '
      + activeBatchFeatureProfiles.length + ' total profile(s) in the combined catalogue.' + suffix;
    partFeatureBatchStatus.dataset.state = activeBatchFeatureProfiles.length ? 'complete' : 'warning';
    setState(loadedPartId ? 'PART LOADED' : 'READY', loadedPartId ? 'loaded' : 'ready');
    setMessage(activeBatchFeatureProfiles.length
      ? 'A local feature catalogue is ready to export and import into the Mesh Inspector.'
      : 'No opening profiles were found in the scanned candidate set.', activeBatchFeatureProfiles.length ? 'success' : 'info');
  }
}

async function scanCuratedSpecialisedParts() {
  if (batchScanRunning) return;
  partFeatureCuratedButton.disabled = true;
  try {
    if (!curatedSpecialisedCatalogue) {
      const response = await fetch('./data/specialised-technic-part-catalogue.json?v=fab991c95518');
      if (!response.ok) throw new Error('Could not load the source-verified specialised part catalogue.');
      curatedSpecialisedCatalogue = await response.json();
    }
    partFeatureBatchQuery.value = '@curated';
    await scanLikelyOpeningParts();
  } catch (error) {
    partFeatureBatchStatus.textContent = error instanceof Error ? error.message : 'Curated part scan failed.';
    partFeatureBatchStatus.dataset.state = 'error';
  } finally {
    partFeatureCuratedButton.disabled = false;
  }
}

function clearBatchFeatureProfiles() {
  if (batchScanRunning) return;
  activeBatchFeatureProfiles = [];
  renderBatchFeatureProfiles(activeBatchFeatureProfiles);
  partFeatureBatchDownloadButton.disabled = true;
  partFeatureBatchClearButton.disabled = true;
  partFeatureBatchButton.disabled = false;
  partFeatureBatchStatus.textContent = 'Combined candidate catalogue cleared.';
  partFeatureBatchStatus.dataset.state = 'info';
}

function cancelLikelyOpeningScan() {
  if (!batchScanRunning) return;
  batchScanCancelled = true;
  partFeatureBatchCancelButton.disabled = true;
  partFeatureBatchStatus.textContent = 'Finishing the current part, then stopping the scan…';
}

function downloadPartFeatureCatalogue() {
  if (!activeBatchFeatureProfiles.length) return;
  const catalogue = {
    schema_version: 2,
    source_geometry_base_url: rawBaseUrl,
    profiles: activeBatchFeatureProfiles,
  };
  const blob = new Blob([JSON.stringify(catalogue, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ldraw-opening-feature-catalogue.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadPartFeatureProfile() {
  if (!activePartDescriptor) return;
  const previewIncluded = activePartTrianglePositions
    && activePartTrianglePositions.length / 9 <= 4000;
  const previewPositions = previewIncluded
    ? Array.from(activePartTrianglePositions, (value) => Number(value.toFixed(2)))
    : null;
  const profile = {
    schema_version: 3,
    preview_geometry_included: Boolean(previewIncluded),
    mesh_triangle_count: previewIncluded ? activePartTrianglePositions.length / 9 : 0,
    ...(previewIncluded ? { mesh_positions_mm: previewPositions } : {}),
    part_id: activePartDescriptor.part_id,
    description: activePartDescriptor.description,
    source_filename: activePartDescriptor.source_filename,
    source_geometry_base_url: activePartDescriptor.source_geometry_base_url,
    units: 'mm',
    dimensions_mm: activePartDescriptor.dimensions_mm,
    bounds_mm: [activePartBoundsMin, activePartBoundsMax],
    analysis_method: 'Nineteen sampled principal and oblique cross-sections; nested contours clustered across slices',
    features: activePartFeatures,
    limitations: [
      'Measurements are based on rendered LDraw surface triangles and principal-axis sections only.',
      'Oblique, curved, branching and blind openings may be missed or approximated.',
      'A geometric opening match does not prove clutch engagement, legal part combinations or structural stability.',
    ],
  };
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = activePartDescriptor.part_id + '.feature-profile.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setMessage(text, kind) {
  message.textContent = text;
  message.dataset.kind = kind || 'info';
}

function setState(text, state) {
  const nextState = state || 'ready';
  stateLabel.textContent = text;
  stateLabel.dataset.state = nextState;
  message.dataset.status = text;
  message.dataset.state = nextState;
  message.setAttribute('aria-busy', nextState === 'loading' ? 'true' : 'false');
}

function formatMm(value) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' mm';
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
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100000);
    camera.up.set(0, 1, 0);
    camera.position.set(100, 90, 120);

    scene.add(new THREE.HemisphereLight(0xFFFFFF, 0x63798A, 2.0));
    const keyLight = new THREE.DirectionalLight(0xFFFFFF, 2.1);
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
    console.error('BrickForge part viewer initialisation failed:', error);
    setState('3D VIEWER UNAVAILABLE', 'error');
    setMessage('The 3D viewer could not start. Check browser WebGL support and reload this page.', 'error');
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

function disposeObject(object) {
  if (!object) return;
  object.traverse((child) => {
    if (!child.isMesh && !child.isLineSegments) return;
    child.geometry && child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material && material.dispose());
  });
  scene.remove(object);
}

function removeHelpers() {
  disposeObject(activeGrid);
  disposeObject(activeAxes);
  activeGrid = null;
  activeAxes = null;
}

function removeModel() {
  disposeObject(activeModel);
  activeModel = null;
}

function replaceHelpers(maxDimension, height) {
  removeHelpers();
  activeGrid = new THREE.GridHelper(Math.max(maxDimension * 2.2, 20), 22, 0x9DADB9, 0xD7E0E6);
  activeGrid.position.y = -height / 2;
  scene.add(activeGrid);
  activeAxes = new THREE.AxesHelper(Math.max(maxDimension * 0.32, 8));
  scene.add(activeAxes);
}

function fitCamera(size) {
  const maximum = Math.max(size.x, size.y, size.z, 1);
  const distance = maximum * 2.6;
  camera.near = Math.max(0.01, maximum / 10000);
  camera.far = maximum * 100;
  camera.position.set(distance * 1.15, distance * 0.92, distance * 1.35);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = Math.max(maximum * 0.08, 0.1);
  controls.maxDistance = maximum * 30;
  controls.update();
}

async function fetchRawFile(path) {
  if (rawFileCache.has(path)) return rawFileCache.get(path);
  const request = fetch(rawBaseUrl + path, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    headers: { Accept: 'text/plain' },
  }).then(async (response) => {
    if (!response.ok) {
      const error = new Error('LDraw file request failed (' + response.status + '): ' + path);
      error.status = response.status;
      throw error;
    }
    return response.text();
  }).catch((error) => {
    rawFileCache.delete(path);
    throw error;
  });
  rawFileCache.set(path, request);
  return request;
}

const referenceCandidates = ldrawReferenceCandidates;

async function fetchReferencedFile(filename, parentPath) {
  const candidates = referenceCandidates(filename, parentPath);
  let lastError;
  for (const candidate of candidates) {
    try {
      return { path: candidate, text: await fetchRawFile(candidate) };
    } catch (error) {
      lastError = error;
      if (error.status !== 404) throw error;
    }
  }
  throw lastError || new Error('Could not resolve LDraw file: ' + filename);
}

function parseColour(token, source, lineNumber) {
  if (/^0x2[0-9a-f]{6}$/i.test(token)) return token.toUpperCase();
  if (/^-?\d+$/.test(token)) return Number.parseInt(token, 10);
  throw new Error(source + ':' + lineNumber + ': invalid colour code ' + token);
}

function parseNumbers(tokens, source, lineNumber) {
  const values = tokens.map(Number);
  if (!values.every(Number.isFinite)) {
    throw new Error(source + ':' + lineNumber + ': invalid or non-finite geometry value');
  }
  return values;
}

function parseLDrawText(content, source) {
  const records = [];
  const metadata = {
    description: '',
    name: '',
    author: '',
    libraryType: '',
    licence: '',
  };

  content.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line) return;

    if (line.startsWith('0')) {
      const payload = line.slice(1).trim();
      if (!payload) return;
      if (/^NAME:/i.test(payload)) metadata.name = payload.split(':').slice(1).join(':').trim();
      else if (/^AUTHOR:/i.test(payload)) metadata.author = payload.split(':').slice(1).join(':').trim();
      else if (/^!LDRAW_ORG/i.test(payload)) metadata.libraryType = payload.slice(10).trim();
      else if (/^!LICENSE/i.test(payload)) metadata.licence = payload.slice(8).trim();
      else if (!metadata.description && !payload.startsWith('!')) metadata.description = payload;
      return;
    }

    const tokens = line.split(/\s+/);
    const lineType = Number.parseInt(tokens[0], 10);
    if (lineType === 1) {
      if (tokens.length < 15) throw new Error(source + ':' + lineNumber + ': malformed type-1 record');
      const values = parseNumbers(tokens.slice(2, 14), source, lineNumber);
      records.push({
        type: 1,
        colour: parseColour(tokens[1], source, lineNumber),
        position: [values[0], values[1], values[2]],
        matrix: values.slice(3, 12),
        filename: tokens.slice(14).join(' '),
        lineNumber: lineNumber,
      });
    } else if (lineType >= 2 && lineType <= 5) {
      const pointCounts = { 2: 2, 3: 3, 4: 4, 5: 4 };
      const pointCount = pointCounts[lineType];
      if (tokens.length !== 2 + pointCount * 3) {
        throw new Error(source + ':' + lineNumber + ': malformed type-' + lineType + ' record');
      }
      const values = parseNumbers(tokens.slice(2), source, lineNumber);
      const points = [];
      for (let offset = 0; offset < values.length; offset += 3) {
        points.push([values[offset], values[offset + 1], values[offset + 2]]);
      }
      records.push({
        type: lineType,
        colour: parseColour(tokens[1], source, lineNumber),
        points: points,
        lineNumber: lineNumber,
      });
    }
  });

  if (!metadata.description) metadata.description = source.split('/').pop();
  return { source: source, records: records, metadata: metadata };
}

async function getConnectionProfiles() {
  if (!connectionProfilesPromise) {
    connectionProfilesPromise = fetch('./data/connection-profiles/basic-bricks.json?v=fab991c95518', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      if (!response.ok) throw new Error('Connection profile catalogue request failed (' + response.status + ').');
      const catalogue = await response.json();
      if (catalogue.schema_version !== 1 || !Array.isArray(catalogue.profiles)) {
        throw new Error('Unsupported connection profile catalogue format.');
      }
      return new Map(catalogue.profiles.map((profile) => [String(profile.part_id), profile]));
    }).catch((error) => {
      connectionProfilesPromise = null;
      throw error;
    });
  }
  return connectionProfilesPromise;
}

async function getDocument(path) {
  if (documentCache.has(path)) return documentCache.get(path);
  const pending = fetchRawFile(path).then((content) => parseLDrawText(content, path)).catch((error) => {
    documentCache.delete(path);
    throw error;
  });
  documentCache.set(path, pending);
  return pending;
}

async function resolveDocument(filename, parentPath) {
  const candidates = referenceCandidates(filename, parentPath);
  let lastError;
  for (const candidate of candidates) {
    try {
      return await getDocument(candidate);
    } catch (error) {
      lastError = error;
      if (error.status !== 404) throw error;
    }
  }
  throw lastError || new Error('Could not resolve LDraw file: ' + filename);
}

function multiplyMatrices(left, right) {
  const result = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let index = 0; index < 3; index += 1) {
        sum += left[row * 3 + index] * right[index * 3 + column];
      }
      result.push(sum);
    }
  }
  return result;
}

function applyMatrix(matrix, point) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[3] * x + matrix[4] * y + matrix[5] * z,
    matrix[6] * x + matrix[7] * y + matrix[8] * z,
  ];
}

function addVectors(left, right) {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function colourKey(colour, inheritedColour, isEdge) {
  if (colour === 24 || isEdge) return 'edge:' + String(inheritedColour);
  return String(colour === 16 ? inheritedColour : colour);
}

function appendPoint(target, point, matrix, translation) {
  const transformed = addVectors(applyMatrix(matrix, point), translation);
  // LDraw's -Y-up frame is rotated 180 degrees about X for Three.js Y-up.
  target.push(
    transformed[0] * LDU_TO_MM,
    -transformed[1] * LDU_TO_MM,
    -transformed[2] * LDU_TO_MM,
  );
}

async function expandPart(document, matrix, translation, inheritedColour, ancestors, depth, output) {
  if (depth > MAX_REFERENCE_DEPTH) {
    throw new Error('Maximum LDraw reference depth (' + MAX_REFERENCE_DEPTH + ') exceeded at ' + document.source);
  }
  if (ancestors.has(document.source)) {
    throw new Error('Cyclic LDraw file reference detected at ' + document.source);
  }

  ancestors.add(document.source);
  output.files.add(document.source);
  const metadata = document.metadata;
  if (metadata.author) output.authors.add(metadata.author);
  if (metadata.licence) output.licences.add(metadata.licence);

  for (const record of document.records) {
    if (record.type === 1) {
      if (record.colour === 24) {
        throw new Error(document.source + ':' + record.lineNumber + ': a type-1 reference cannot use colour 24');
      }
      const child = await resolveDocument(record.filename, document.source);
      const childColour = record.colour === 16 ? inheritedColour : record.colour;
      const childMatrix = multiplyMatrices(matrix, record.matrix);
      const childTranslation = addVectors(applyMatrix(matrix, record.position), translation);
      await expandPart(child, childMatrix, childTranslation, childColour, ancestors, depth + 1, output);
      continue;
    }

    const key = colourKey(record.colour, inheritedColour, record.colour === 24);
    const bucketMap = record.type === 2 || record.type === 5 ? output.lines : output.faces;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    const bucket = bucketMap.get(key);

    if (record.type === 2 || record.type === 5) {
      appendPoint(bucket, record.points[0], matrix, translation);
      appendPoint(bucket, record.points[1], matrix, translation);
    } else if (record.type === 3) {
      record.points.forEach((point) => appendPoint(bucket, point, matrix, translation));
    } else if (record.type === 4) {
      [record.points[0], record.points[1], record.points[2], record.points[0], record.points[2], record.points[3]]
        .forEach((point) => appendPoint(bucket, point, matrix, translation));
    }
  }

  ancestors.delete(document.source);
}

function parsePalette(content) {
  const parsed = new Map(fallbackColours);
  const pattern = /^\s*0\s+!COLOUR\s+\S+\s+CODE\s+(-?\d+)\s+VALUE\s+#([0-9A-F]{6})\s+EDGE\s+(#[0-9A-F]{6}|-?\d+)/i;
  content.split(/\r?\n/).forEach((line) => {
    const match = line.match(pattern);
    if (!match) return;
    parsed.set(Number(match[1]), {
      value: '#' + match[2].toUpperCase(),
      edge: match[3].startsWith('#') ? match[3].toUpperCase() : Number(match[3]),
    });
  });
  return parsed;
}

async function loadPalette() {
  try {
    const text = await fetchRawFile('LDConfig.ldr');
    palette = parsePalette(text);
  } catch (error) {
    console.warn('BrickForge is using its fallback LDraw colour palette:', error);
    palette = new Map(fallbackColours);
  }
}

function resolveHex(code, edge) {
  if (typeof code === 'string' && code.startsWith('0X2')) return '#' + code.slice(3);
  const item = palette.get(Number(code));
  if (!item) return '#839DB0';
  if (!edge) return item.value;
  if (typeof item.edge === 'string') return item.edge;
  const edgeItem = palette.get(item.edge);
  return edgeItem ? edgeItem.value : '#303840';
}

function hexForBucket(key) {
  if (key.startsWith('edge:')) return resolveHex(key.slice(5), true);
  return resolveHex(key, false);
}

function createMesh(bucketMap, isLines) {
  const group = new THREE.Group();
  let triangleCount = 0;

  bucketMap.forEach((positions, key) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (isLines) {
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(hexForBucket(key)),
        transparent: false,
      });
      group.add(new THREE.LineSegments(geometry, material));
    } else {
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hexForBucket(key)),
        roughness: 0.62,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      group.add(new THREE.Mesh(geometry, material));
      triangleCount += positions.length / 9;
    }
  });

  return { group: group, triangles: Math.round(triangleCount) };
}

function clearMeasurements() {
  output.x.textContent = '—';
  output.y.textContent = '—';
  output.z.textContent = '—';
  output.triangles.textContent = '—';
  output.files.textContent = '—';
  output.studs.textContent = '—';
  output.receivers.textContent = '—';
  output.connectionStatus.textContent = 'Checking nominal connection profile…';
  output.connectionStatus.dataset.supported = 'false';
  output.authors.textContent = '—';
  output.licences.textContent = '—';
}

function renderPartSearchResults(query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    partSelect.disabled = false;
    partSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a part to load…';
    partSelect.append(placeholder);
    for (const item of defaultPartOptions) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.text;
      partSelect.append(option);
    }
    partSelect.value = loadedPartId || '';
    return;
  }

  const matches = searchPartCatalogue(partCatalogue, query);

  partSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a part to load…';
  partSelect.append(placeholder);
  if (!matches.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No matching parts found';
    partSelect.append(option);
    partSelect.disabled = true;
    return;
  }

  partSelect.disabled = false;
  for (const part of matches) {
    const option = document.createElement('option');
    option.value = part.part_id;
    const profileLabel = connectionProfileMap.has(part.part_id)
      ? ' · nominal profile'
      : ' · geometry only';
    option.textContent = part.part_id + ' — ' + (part.name || part.description || part.part_id)
      + profileLabel;
    partSelect.append(option);
  }
  // Search results are deliberately unselected until the visitor chooses one.
  // This ensures re-selecting the currently loaded part still fires "change".
  partSelect.value = '';
}

async function loadPartCatalogue() {
  const response = await fetch('./data/ldraw/parts-index.json.gz', {
    credentials: 'same-origin',
    headers: { Accept: 'application/gzip' },
  });
  if (!response.ok) {
    throw new Error('Searchable part catalogue request failed (' + response.status + ').');
  }
  const catalogueText = await decodeCataloguePayload(await response.arrayBuffer());
  const catalogue = JSON.parse(catalogueText);
  if (catalogue.schema_version !== 1 || !Array.isArray(catalogue.parts)) {
    throw new Error('Unsupported searchable part catalogue format.');
  }
  const geometryBaseUrl = catalogue.source && catalogue.source.geometry_base_url;
  if (
    typeof geometryBaseUrl !== 'string'
    || !geometryBaseUrl.startsWith('https://raw.githubusercontent.com/kulits/ldraw-parts/')
    || !/\/[0-9a-f]{40}\/ldraw\/$/.test(geometryBaseUrl)
  ) {
    throw new Error('The searchable catalogue has no valid pinned geometry source.');
  }
  rawBaseUrl = geometryBaseUrl;
  partCatalogue = catalogue.parts.filter((part) =>
    part && typeof part.part_id === 'string'
    && typeof part.filename === 'string'
    && part.filename.startsWith('parts/')
    && !part.filename.includes('..')
  );
  if (!partCatalogue.length) throw new Error('The searchable part catalogue is empty.');
  connectionProfileMap = await getConnectionProfiles();
  partSearch.disabled = false;
  partFeatureBatchButton.disabled = false;
  partSearch.placeholder = 'Search ' + partCatalogue.length.toLocaleString()
    + ' parts by number, name or keyword';
  const coverage = document.querySelector('#part-profile-coverage');
  if (coverage) {
    coverage.textContent = connectionProfileMap.size.toLocaleString()
      + ' of ' + partCatalogue.length.toLocaleString()
      + ' indexed parts currently have nominal connection profiles.';
  }
}

async function loadSelectedPart() {
  if (!viewerReady) return;
  const sequence = ++loadSequence;
  const partId = partSelect.value;
  if (!partId) return;
  loadedPartId = null;
  if (batchScanRunning) batchScanCancelled = true;
  clearPartFeatureAnalysis();
  const colourCode = Number(colourSelect.value);
  const selectedEntry = partCatalogue.find((part) => part.part_id === partId);
  const partPath = selectedEntry ? selectedEntry.filename : 'parts/' + partId + '.dat';

  setState('FETCHING ' + partId, 'loading');
  setMessage('Fetching source files and expanding nested LDraw references…');
  clearMeasurements();

  try {
    await loadPalette();
    const [root, connectionProfiles] = await Promise.all([
      getDocument(partPath),
      getConnectionProfiles(),
    ]);
    const connectionProfile = connectionProfiles.get(partId);
    const expansion = {
      faces: new Map(),
      lines: new Map(),
      files: new Set(),
      authors: new Set(),
      licences: new Set(),
    };

    setState('EXPANDING ' + partId + ' REFERENCES', 'loading');
    setMessage('Resolving nested subparts and preparing the geometry…');
    await expandPart(
      root,
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
      [0, 0, 0],
      colourCode,
      new Set(),
      0,
      expansion,
    );

    if (sequence !== loadSequence) return;
    setState('RENDERING ' + partId, 'loading');
    setMessage('Building the 3D preview and calculating dimensions…');
    const faceModel = createMesh(expansion.faces, false);
    const lineModel = createMesh(expansion.lines, true);
    const model = new THREE.Group();
    model.add(faceModel.group);
    model.add(lineModel.group);

    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error('No renderable geometry was found in ' + root.source);
    const size = bounds.getSize(new THREE.Vector3());
    if (![size.x, size.y, size.z].every(Number.isFinite) || Math.max(size.x, size.y, size.z) <= 0) {
      throw new Error('The resolved part has invalid or zero-size geometry.');
    }
    const trianglePositions = collectTrianglePositions(expansion.faces);
    if (trianglePositions.length / 9 > 100000) {
      throw new Error('The selected part exceeds the 100,000-triangle feature analysis limit.');
    }
    if (!trianglePositions.length || trianglePositions.length % 9 !== 0) {
      throw new Error('The selected part has no complete triangle geometry for feature analysis.');
    }
    const triangleBounds = calculateTriangleBounds(trianglePositions);
    const centre = bounds.getCenter(new THREE.Vector3());
    model.position.sub(centre);

    removeModel();
    activeModel = model;
    scene.add(activeModel);
    replaceHelpers(Math.max(size.x, size.y, size.z), size.y);
    fitCamera(size);
    currentBounds = size;

    output.name.textContent = root.metadata.description;
    output.identity.textContent = 'LDraw ID ' + partId + ' · ' + root.source;
    output.x.textContent = formatMm(size.x);
    output.y.textContent = formatMm(size.y);
    output.z.textContent = formatMm(size.z);
    output.triangles.textContent = faceModel.triangles.toLocaleString();
    output.files.textContent = expansion.files.size.toLocaleString();
    output.studs.textContent = connectionProfile ? connectionProfile.features.filter((feature) => feature.kind === 'stud').length.toLocaleString() : 'Not defined';
    output.receivers.textContent = connectionProfile ? connectionProfile.features.filter((feature) => feature.kind === 'stud_receiver').length.toLocaleString() : 'Not defined';
    output.connectionStatus.textContent = connectionProfile
      ? 'Nominal connection profile available. Candidate stud-grid alignment only; physical clutch and stability are not validated.'
      : 'Geometry preview only. No nominal connection profile is defined, so the construction engine cannot currently use this part.';
    output.connectionStatus.dataset.supported = connectionProfile ? 'true' : 'false';
    output.authors.textContent = Array.from(expansion.authors).sort().join(', ') || 'Not stated in source headers';
    output.licences.textContent = Array.from(expansion.licences).sort().join(' · ') || 'Check the individual source headers';
    output.source.href = rawBaseUrl + root.source;
    output.source.textContent = 'View ' + root.source + ' ↗';

    emptyState.hidden = true;
    resetButton.disabled = false;
    loadedPartId = partId;
    activePartTrianglePositions = trianglePositions;
    activePartBoundsMin = triangleBounds.minimum;
    activePartBoundsMax = triangleBounds.maximum;
    activePartDescriptor = {
      part_id: partId,
      description: root.metadata.description,
      source_filename: root.source,
      source_geometry_base_url: rawBaseUrl,
      dimensions_mm: [size.x, size.y, size.z],
    };
    partFeatureAnalyseButton.disabled = false;
    partFeatureDownloadButton.disabled = true;
    setState('PART LOADED', 'loaded');
    setMessage(
      'Resolved ' + expansion.files.size + ' LDraw files from the public library mirror. Geometry is converted from LDU to millimetres. This preview does not validate physical connections.',
      'success',
    );
  } catch (error) {
    if (sequence !== loadSequence) return;
    console.error('BrickForge could not load the selected LDraw part:', error);
    loadedPartId = null;
    clearPartFeatureAnalysis();
    removeModel();
    removeHelpers();
    emptyState.hidden = false;
    resetButton.disabled = true;
    currentBounds = null;
    setState('PART LOAD FAILED', 'error');
    setMessage(error instanceof Error ? error.message : 'The LDraw part could not be loaded.', 'error');
  }
}

partSearch.addEventListener('input', () => {
  renderPartSearchResults(partSearch.value);
});
partSelect.addEventListener('change', () => {
  loadSelectedPart();
});
colourSelect.addEventListener('change', () => {
  loadSelectedPart();
});
partFeatureAnalyseButton.addEventListener('click', analyseSelectedPartFeatures);
partFeatureBatchButton.addEventListener('click', scanLikelyOpeningParts);
partFeatureCuratedButton.addEventListener('click', scanCuratedSpecialisedParts);
partFeatureBatchClearButton.addEventListener('click', clearBatchFeatureProfiles);
partFeatureBatchCancelButton.addEventListener('click', cancelLikelyOpeningScan);
partFeatureBatchDownloadButton.addEventListener('click', downloadPartFeatureCatalogue);
partFeatureDownloadButton.addEventListener('click', downloadPartFeatureProfile);
resetButton.addEventListener('click', () => {
  if (currentBounds) fitCamera(currentBounds);
});

async function startPartExplorer() {
  try {
    await loadPartCatalogue();
    partFeatureCuratedButton.disabled = false;
    renderPartSearchResults(partSearch.value);
    [THREE, { OrbitControls }] = await Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
    ]);
    viewerReady = initialiseViewer();
    if (viewerReady) {
      const requestedPartId = new URLSearchParams(window.location.search).get('part');
      const requestedPart = partCatalogue.find((part) => part.part_id === requestedPartId);
      if (requestedPart) {
        partSearch.value = requestedPart.part_id;
        renderPartSearchResults(requestedPart.part_id);
        partSelect.value = requestedPart.part_id;
      } else {
        partSelect.value = defaultPartOptions[0]?.value || '';
      }
      await loadSelectedPart();
    }
  } catch (error) {
    console.error('BrickForge could not start the LDraw part viewer:', error);
    setState('3D LIBRARY FAILED', 'error');
    setMessage('The 3D rendering library could not be loaded. Check your connection or content blocker, then reload this page.', 'error');
  }
}

startPartExplorer();
