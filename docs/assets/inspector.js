let THREE;
let OrbitControls;
let STLLoader;
let OBJLoader;

import { GridSpec, TargetGrid } from "./target-grid.js";

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
const voxeliseButton = document.querySelector('#voxelise-button');
const voxeliseStatus = document.querySelector('#voxelise-status');
const voxeliseSummary = document.querySelector('#voxelise-summary');
const voxelCellCount = document.querySelector('#voxel-cell-count');
const voxelGridSize = document.querySelector('#voxel-grid-size');
const voxelCourseList = document.querySelector('#voxel-course-list');
const voxelOverlayToggle = document.querySelector('#voxel-overlay-toggle');
const buildConstructionButton = document.querySelector('#build-construction');
const constructionStatus = document.querySelector('#construction-status');
const constructionSummary = document.querySelector('#construction-summary');
const constructionPartCount = document.querySelector('#construction-part-count');
const constructionDetails = document.querySelector('#construction-details');
const constructionCourseList = document.querySelector('#construction-course-list');
const constructionDownloadLDraw = document.querySelector('#construction-download-ldraw');
const constructionDownloadGraph = document.querySelector('#construction-download-graph');
const constructionDownloadBom = document.querySelector('#construction-download-bom');

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
let currentModelCenter = [0, 0, 0];
let wireframeEnabled = false;
let viewerReady = false;
let viewerLoading = true;
let pendingFile;
let voxelWorker;
let activeTargetGrid;
let activeVoxelGroup;
let voxelOverlayVisible = true;

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

function removeVoxelOverlay() {
  if (!activeVoxelGroup) return;
  scene.remove(activeVoxelGroup);
  activeVoxelGroup.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
  activeVoxelGroup = null;
}

function resetVoxelisation() {
  if (voxelWorker) {
    voxelWorker.terminate();
    voxelWorker = null;
  }
  if (constructionWorker) {
    constructionWorker.terminate();
    constructionWorker = null;
  }
  activeConstruction = null;
  buildConstructionButton.disabled = true;
  constructionStatus.textContent = 'Voxelise a mesh first.';
  constructionStatus.dataset.state = 'idle';
  constructionSummary.hidden = true;
  constructionDownloadLDraw.disabled = true;
  constructionDownloadGraph.disabled = true;
  constructionDownloadBom.disabled = true;
  removeVoxelOverlay();
  activeTargetGrid = null;
  voxeliseButton.disabled = !activeModel;
  voxeliseStatus.textContent = activeModel
    ? 'Ready to voxelise this mesh.'
    : 'Load a mesh to enable voxelisation.';
  voxeliseStatus.dataset.state = 'idle';
  voxeliseSummary.hidden = true;
  voxelOverlayToggle.disabled = true;
}

function collectVoxelMesh() {
  const sourceUnit = unitsSelect.value || 'mm';
  const unitFactor = MILLIMETRES_PER_UNIT[sourceUnit];
  const totalVertices = activeMeshes.reduce(
    (sum, mesh) => sum + mesh.geometry.attributes.position.count, 0,
  );
  const totalTriangles = activeMeshes.reduce((sum, mesh) => {
    const geometry = mesh.geometry;
    return sum + (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  }, 0);
  if (totalTriangles > 100000) {
    throw new Error('This mesh exceeds the browser voxeliser limit of 100,000 triangles. Use a lower-detail export.');
  }
  const vertices = new Float64Array(totalVertices * 3);
  const indices = new Uint32Array(totalTriangles * 3);
  let vertexOffset = 0;
  let indexOffset = 0;
  const point = new THREE.Vector3();
  activeMeshes.forEach((mesh) => {
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      const offset = (vertexOffset + index) * 3;
      vertices[offset] = (point.x + currentModelCenter[0]) / unitFactor;
      vertices[offset + 1] = (point.y + currentModelCenter[1]) / unitFactor;
      vertices[offset + 2] = (point.z + currentModelCenter[2]) / unitFactor;
    }
    if (mesh.geometry.index) {
      const sourceIndices = mesh.geometry.index;
      for (let index = 0; index < sourceIndices.count; index += 1) {
        indices[indexOffset++] = vertexOffset + sourceIndices.getX(index);
      }
    } else {
      for (let index = 0; index < position.count; index += 1) {
        indices[indexOffset++] = vertexOffset + index;
      }
    }
    vertexOffset += position.count;
  });
  return { vertices, indices, sourceUnit };
}

function renderVoxelOverlay(grid) {
  removeVoxelOverlay();
  const [width, height, depth] = grid.spec.dimensions;
  let interiorCount = 0;
  let boundaryCount = 0;
  for (const value of grid.classification) {
    if (value === 1) interiorCount += 1;
    else if (value === 2) boundaryCount += 1;
  }
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const makeInstances = (count, colour, opacity) => {
    if (!count) return null;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity, depthWrite: false,
      }),
      count,
    );
    mesh.frustumCulled = false;
    return mesh;
  };
  const interior = makeInstances(interiorCount, 0x3D789B, 0.22);
  const boundary = makeInstances(boundaryCount, 0xD66A32, 0.42);
  let interiorIndex = 0;
  let boundaryIndex = 0;
  for (let y = 0; y < height; y += 1) {
    for (let z = 0; z < depth; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = grid.classification[grid.spec.flat_index(x, y, z)];
        const target = value === 1 ? interior : value === 2 ? boundary : null;
        if (!target) continue;
        const index = value === 1 ? interiorIndex++ : boundaryIndex++;
        dummy.position.set(
          grid.spec.origin_mm[0] + (x + 0.5) * grid.spec.pitch_mm[0] - currentModelCenter[0],
          grid.spec.origin_mm[1] + (y + 0.5) * grid.spec.pitch_mm[1] - currentModelCenter[1],
          grid.spec.origin_mm[2] + (z + 0.5) * grid.spec.pitch_mm[2] - currentModelCenter[2],
        );
        dummy.scale.set(
          grid.spec.pitch_mm[0] * 0.96,
          grid.spec.pitch_mm[1] * 0.96,
          grid.spec.pitch_mm[2] * 0.96,
        );
        dummy.updateMatrix();
        target.setMatrixAt(index, dummy.matrix);
      }
    }
  }
  if (interior) {
    interior.instanceMatrix.needsUpdate = true;
    group.add(interior);
  }
  if (boundary) {
    boundary.instanceMatrix.needsUpdate = true;
    group.add(boundary);
  }
  scene.add(group);
  activeVoxelGroup = group;
  activeVoxelGroup.visible = voxelOverlayVisible;
}

function displayVoxelSummary(grid, triangleCount) {
  const summary = grid.summary();
  voxelCellCount.textContent = summary.occupied_cell_count.toLocaleString() + ' occupied cells';
  voxelGridSize.textContent = summary.dimensions.join(' × ') + ' cells · '
    + triangleCount.toLocaleString() + ' triangles · '
    + summary.boundary_cell_count.toLocaleString() + ' boundary cells';
  voxelCourseList.replaceChildren();
  for (let y = 0; y < summary.dimensions[1]; y += 1) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const count = document.createElement('strong');
    label.textContent = 'Course ' + (y + 1);
    count.textContent = grid.layer_footprint(y).length.toLocaleString() + ' cells';
    item.append(label, count);
    voxelCourseList.append(item);
  }
  voxeliseSummary.hidden = false;
  voxelOverlayToggle.disabled = false;
  voxelOverlayToggle.textContent = 'Hide voxel overlay';
}

function runVoxelisation() {
  if (!activeModel || voxelWorker) return;
  let meshInput;
  try {
    meshInput = collectVoxelMesh();
  } catch (error) {
    voxeliseStatus.textContent = error instanceof Error ? error.message : 'Mesh preparation failed.';
    voxeliseStatus.dataset.state = 'error';
    return;
  }
  resetVoxelisation();
  voxeliseButton.disabled = true;
  voxeliseStatus.textContent = 'Preparing triangle acceleration structure…';
  voxeliseStatus.dataset.state = 'working';
  setMessage('Voxelising locally. The 3D viewer remains interactive while the worker processes the mesh.');
  try {
    voxelWorker = new Worker(new URL('./mesh-voxelizer-worker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    voxeliseButton.disabled = false;
    voxeliseStatus.textContent = error instanceof Error ? error.message : 'Could not start the voxelisation worker.';
    voxeliseStatus.dataset.state = 'error';
    setMessage(voxeliseStatus.textContent, 'error');
    return;
  }
  const worker = voxelWorker;
  worker.addEventListener('message', (event) => {
    if (worker !== voxelWorker) return;
    const data = event.data;
    if (data.type === 'progress') {
      const percent = Math.round((data.completed / data.total) * 100);
      voxeliseStatus.textContent = 'Classifying grid columns… ' + percent + '%';
      return;
    }
    worker.terminate();
    voxelWorker = null;
    voxeliseButton.disabled = false;
    if (data.type === 'error') {
      voxeliseStatus.textContent = data.message;
      voxeliseStatus.dataset.state = 'error';
      setMessage(data.message, 'error');
      return;
    }
    try {
      const result = data.result;
      const spec = new GridSpec({
        dimensions: result.dimensions,
        origin_mm: result.origin_mm,
        pitch_mm: result.pitch_mm,
      });
      activeTargetGrid = new TargetGrid({
        spec,
        classification: result.classification,
        surface_coverage: result.surface_coverage,
        source_units: result.source_units,
        source_bounds_mm: result.source_bounds_mm,
        warnings: result.warnings,
      });
      voxelOverlayVisible = true;
      renderVoxelOverlay(activeTargetGrid);
      displayVoxelSummary(activeTargetGrid, result.triangle_count);
      buildConstructionButton.disabled = false;
      voxeliseStatus.textContent = 'Voxelisation complete. ' + result.ray_triangle_tests.toLocaleString()
        + ' scanline tests and ' + result.cell_triangle_tests.toLocaleString()
        + ' cell-surface intersection tests were completed.';
      voxeliseStatus.dataset.state = 'complete';
      setMessage('Target grid generated in your browser. Orange cells intersect the mesh surface; blue cells are interior.', 'success');
    } catch (error) {
      voxeliseStatus.textContent = error instanceof Error ? error.message : 'Could not display the target grid.';
      voxeliseStatus.dataset.state = 'error';
      setMessage(voxeliseStatus.textContent, 'error');
    }
  });
  worker.addEventListener('error', (event) => {
    if (worker !== voxelWorker) return;
    worker.terminate();
    voxelWorker = null;
    voxeliseButton.disabled = false;
    voxeliseStatus.textContent = event.message || 'The voxelisation worker failed.';
    voxeliseStatus.dataset.state = 'error';
    setMessage(voxeliseStatus.textContent, 'error');
  });
  worker.postMessage({
    vertices: meshInput.vertices,
    indices: meshInput.indices,
    units: meshInput.sourceUnit,
    maxCells: 100000,
  }, [meshInput.vertices.buffer, meshInput.indices.buffer]);
}


function downloadConstructionFile(filename, contents, mediaType) {
  const blob = new Blob([contents], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function displayConstruction(result) {
  activeConstruction = result;
  constructionPartCount.textContent = result.parts.length.toLocaleString() + ' parts';
  constructionDetails.textContent = result.connections.length.toLocaleString() + ' candidate connections · '
    + result.total_mating_pairs.toLocaleString() + ' nominal mating pairs';
  constructionCourseList.replaceChildren();
  result.course_part_counts.forEach((count, index) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const value = document.createElement('strong');
    label.textContent = 'Course ' + (index + 1);
    value.textContent = count.toLocaleString() + ' parts';
    item.append(label, value);
    constructionCourseList.append(item);
  });
  constructionSummary.hidden = false;
  constructionDownloadLDraw.disabled = false;
  constructionDownloadGraph.disabled = false;
  constructionDownloadBom.disabled = false;
  constructionStatus.textContent = 'Connected construction generated. Review the stated nominal limitations before treating it as buildable.';
  constructionStatus.dataset.state = 'complete';
  setMessage('The variable-course assembly passed nominal body-overlap and connection-graph checks.', 'success');
}

function runLayeredConstruction() {
  if (!activeTargetGrid || constructionWorker) return;
  const pitch = activeTargetGrid.spec.pitch_mm;
  const expectedPitch = [8, 9.6, 8];
  if (pitch.some((value, index) => Math.abs(value - expectedPitch[index]) > 1e-6)) {
    constructionStatus.textContent = 'Construction currently requires the standard 8 × 9.6 × 8 mm brick grid.';
    constructionStatus.dataset.state = 'error';
    return;
  }
  const [, courseCount] = activeTargetGrid.spec.dimensions;
  const layerFootprints = Array.from(
    { length: courseCount },
    (_, layer) => activeTargetGrid.layer_footprint(layer),
  );
  if (layerFootprints.some((footprint) => footprint.length === 0)) {
    constructionStatus.textContent = 'At least one course is empty. A continuous stack cannot bridge an empty course.';
    constructionStatus.dataset.state = 'error';
    return;
  }

  buildConstructionButton.disabled = true;
  constructionStatus.textContent = 'Preparing per-course footprints…';
  constructionStatus.dataset.state = 'working';
  constructionSummary.hidden = true;
  setMessage('Searching for a connected arrangement across all occupied courses. The viewer remains interactive.');
  try {
    constructionWorker = new Worker(
      new URL('./layered-construction-worker.js', import.meta.url),
      { type: 'module' },
    );
  } catch (error) {
    buildConstructionButton.disabled = false;
    constructionStatus.textContent = error instanceof Error
      ? error.message : 'Could not start the construction worker.';
    constructionStatus.dataset.state = 'error';
    return;
  }

  const worker = constructionWorker;
  worker.addEventListener('message', (event) => {
    if (worker !== constructionWorker) return;
    const data = event.data;
    if (data.type === 'progress') {
      constructionStatus.textContent = data.message;
      return;
    }
    worker.terminate();
    constructionWorker = null;
    buildConstructionButton.disabled = false;
    if (data.type === 'error') {
      constructionStatus.textContent = data.message;
      constructionStatus.dataset.state = 'error';
      setMessage(data.message, 'error');
      return;
    }
    try {
      displayConstruction(data.result);
    } catch (error) {
      constructionStatus.textContent = error instanceof Error
        ? error.message : 'Could not display the generated construction.';
      constructionStatus.dataset.state = 'error';
    }
  });
  worker.addEventListener('error', (event) => {
    if (worker !== constructionWorker) return;
    worker.terminate();
    constructionWorker = null;
    buildConstructionButton.disabled = false;
    constructionStatus.textContent = event.message || 'The construction worker failed.';
    constructionStatus.dataset.state = 'error';
    setMessage(constructionStatus.textContent, 'error');
  });
  worker.postMessage({ layerFootprints, config: { maxParts: 200 } });
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
  currentModelCenter = [center.x, center.y, center.z];
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

  resetVoxelisation();
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
  voxeliseButton.disabled = false;
  voxeliseStatus.textContent = 'Ready to voxelise this closed mesh.';
  setState('MESH LOADED', 'loaded');
  setMessage(
    `Mesh loaded locally. Source units interpreted as ${sourceUnit}; measurements are shown in millimetres. No L-brick buildability check has been run.`,
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
    resetVoxelisation();
    removeActiveModel();
    emptyState.hidden = false;
    wireframeButton.disabled = true;
    resetButton.disabled = true;
    voxeliseButton.disabled = true;
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

voxeliseButton.addEventListener('click', runVoxelisation);
buildConstructionButton.addEventListener('click', runLayeredConstruction);
constructionDownloadLDraw.addEventListener('click', () => {
  if (activeConstruction) downloadConstructionFile(
    activeConstruction.model_name + '.ldr', activeConstruction.ldraw, 'text/plain;charset=utf-8',
  );
});
constructionDownloadGraph.addEventListener('click', () => {
  if (activeConstruction) downloadConstructionFile(
    activeConstruction.model_name + '.assembly.json',
    JSON.stringify(activeConstruction.assembly_graph, null, 2),
    'application/json;charset=utf-8',
  );
});
constructionDownloadBom.addEventListener('click', () => {
  if (activeConstruction) downloadConstructionFile(
    activeConstruction.model_name + '.bom.json',
    JSON.stringify(activeConstruction.bom, null, 2),
    'application/json;charset=utf-8',
  );
});
voxelOverlayToggle.addEventListener('click', () => {
  if (!activeVoxelGroup) return;
  voxelOverlayVisible = !voxelOverlayVisible;
  activeVoxelGroup.visible = voxelOverlayVisible;
  voxelOverlayToggle.textContent = voxelOverlayVisible ? 'Hide voxel overlay' : 'Show voxel overlay';
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
