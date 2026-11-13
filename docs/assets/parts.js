const RAW_BASE = 'https://cdn.jsdelivr.net/gh/kulits/ldraw-parts@c70360d1c588be894997b2168c61909bc8058c4d/ldraw/';
const LDU_TO_MM = 0.4;
const MAX_REFERENCE_DEPTH = 64;

const viewport = document.querySelector('#parts-viewport');
const emptyState = document.querySelector('#parts-empty');
const stateLabel = document.querySelector('#parts-state');
const message = document.querySelector('#parts-message');
const partSelect = document.querySelector('#part-select');
const colourSelect = document.querySelector('#part-colour');
const resetButton = document.querySelector('#parts-reset');

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

function setMessage(text, kind) {
  message.textContent = text;
  message.dataset.kind = kind || 'info';
}

function setState(text, state) {
  stateLabel.textContent = text;
  stateLabel.dataset.state = state || 'ready';
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
  const request = fetch(RAW_BASE + path, {
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

function referenceCandidates(filename, parentPath) {
  const name = filename.trim().replace(/\\/g, '/').toLowerCase();
  if (!name || name.startsWith('/') || name.split('/').some((part) => part === '..')) {
    throw new Error('Unsafe LDraw reference path: ' + filename);
  }
  if (name.startsWith('parts/') || name.startsWith('p/')) return [name];
  if (name.startsWith('s/')) return ['parts/' + name];
  if (name.startsWith('48/') || name.startsWith('8/')) return ['p/' + name];
  if (name.includes('/')) return ['parts/' + name, 'p/' + name];
  if (parentPath.startsWith('p/')) return ['p/' + name];
  return ['parts/' + name, 'p/' + name];
}

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
    connectionProfilesPromise = fetch('./data/connection-profiles/basic-bricks.json', {
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
  output.authors.textContent = '—';
  output.licences.textContent = '—';
}

async function loadSelectedPart() {
  if (!viewerReady) return;
  const sequence = ++loadSequence;
  const partId = partSelect.value;
  const colourCode = Number(colourSelect.value);

  setState('FETCHING ' + partId, 'loading');
  setMessage('Fetching source files and expanding nested LDraw references…');
  clearMeasurements();

  try {
    await loadPalette();
    const [root, connectionProfiles] = await Promise.all([
      getDocument('parts/' + partId + '.dat'),
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
    output.authors.textContent = Array.from(expansion.authors).sort().join(', ') || 'Not stated in source headers';
    output.licences.textContent = Array.from(expansion.licences).sort().join(' · ') || 'Check the individual source headers';
    output.source.href = RAW_BASE + root.source;
    output.source.textContent = 'View ' + root.source + ' ↗';

    emptyState.hidden = true;
    resetButton.disabled = false;
    setState('PART LOADED', 'loaded');
    setMessage(
      'Resolved ' + expansion.files.size + ' LDraw files from the public library mirror. Geometry is converted from LDU to millimetres. This preview does not validate physical connections.',
      'success',
    );
  } catch (error) {
    if (sequence !== loadSequence) return;
    console.error('BrickForge could not load the selected LDraw part:', error);
    removeModel();
    removeHelpers();
    emptyState.hidden = false;
    resetButton.disabled = true;
    currentBounds = null;
    setState('PART LOAD FAILED', 'error');
    setMessage(error instanceof Error ? error.message : 'The LDraw part could not be loaded.', 'error');
  }
}

partSelect.addEventListener('change', () => {
  loadSelectedPart();
});
colourSelect.addEventListener('change', () => {
  loadSelectedPart();
});
resetButton.addEventListener('click', () => {
  if (currentBounds) fitCamera(currentBounds);
});

async function startPartExplorer() {
  try {
    [THREE, { OrbitControls }] = await Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
    ]);
    viewerReady = initialiseViewer();
    if (viewerReady) {
      await loadSelectedPart();
    }
  } catch (error) {
    console.error('BrickForge could not start the LDraw part viewer:', error);
    setState('3D LIBRARY FAILED', 'error');
    setMessage('The 3D rendering library could not be loaded. Check your connection or content blocker, then reload this page.', 'error');
  }
}

startPartExplorer();
