let THREE;
let OrbitControls;
let STLLoader;
let OBJLoader;

import { BRICK_GRID_PITCH_MM, PLATE_GRID_PITCH_MM, GridSpec, TargetGrid } from "./target-grid.js?v=featuregrid7";
import { matchFeaturePatterns, matchTargetFeatures } from "./feature-matcher.js?v=featurematch9";
import { constructionPreviewTransform } from "./construction-preview.js";
import { refineSurfaceFitPose, scoreSurfaceFit } from "./surface-fit.js?v=surfacefit6";
import { transformPartPreviewPositions } from "./part-preview.js?v=featurepreview1";
import { matchNominalConnectionInterfaces } from "./specialised-part-matcher.js?v=specialised1";
import { estimateBomCost, validatePriceCatalogue } from "./cost-estimator.js?v=costing1";
import { orientationMatrixToYUp } from "./mesh-orientation.js?v=upaxis1";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MILLIMETRES_PER_UNIT = { mm: 1, cm: 10, m: 1000, in: 25.4 };

const viewport = document.querySelector('#viewport');
const emptyState = document.querySelector('#viewport-empty');
const stateLabel = document.querySelector('#viewport-state');
const activityPanel = document.querySelector('#preview-activity');
const activityTitle = document.querySelector('#preview-activity-title');
const activityDetail = document.querySelector('#preview-activity-detail');
const activitySteps = [...document.querySelectorAll('[data-activity-step]')];
const message = document.querySelector('#inspector-message');
const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const unitsSelect = document.querySelector('#source-units');
const upAxisSelect = document.querySelector('#up-axis');
const courseHeightSelect = document.querySelector('#course-height');
const wireframeButton = document.querySelector('#wireframe-toggle');
const resetButton = document.querySelector('#reset-view');
const voxeliseButton = document.querySelector('#voxelise-button');
const voxeliseStatus = document.querySelector('#voxelise-status');
const voxeliseSummary = document.querySelector('#voxelise-summary');
const voxelCellCount = document.querySelector('#voxel-cell-count');
const voxelGridSize = document.querySelector('#voxel-grid-size');
const voxelFeatureStatus = document.querySelector('#voxel-feature-status');
const voxelFeatureList = document.querySelector('#voxel-feature-list');
const featureOverlayToggle = document.querySelector('#feature-overlay-toggle');
const featureProfileInput = document.querySelector('#feature-profile-input');
const featureMatchStatus = document.querySelector('#feature-match-status');
const featureMatchList = document.querySelector('#feature-match-list');
const featureInterfaceList = document.querySelector('#feature-interface-list');
const featurePatternStatus = document.querySelector('#feature-pattern-status');
const featurePatternList = document.querySelector('#feature-pattern-list');
const candidatePreviewToggle = document.querySelector('#candidate-preview-toggle');
const voxelCourseList = document.querySelector('#voxel-course-list');
const voxelOverlayToggle = document.querySelector('#voxel-overlay-toggle');
const buildConstructionButton = document.querySelector('#build-construction');
const constructionStatus = document.querySelector('#construction-status');
const constructionSummary = document.querySelector('#construction-summary');
const constructionPartCount = document.querySelector('#construction-part-count');
const constructionDetails = document.querySelector('#construction-details');
const constructionAlternatives = document.querySelector('#construction-alternatives');
const constructionOptimizationProfile = document.querySelector('#construction-optimization-profile');
const constructionCourseList = document.querySelector('#construction-course-list');
const constructionPreviewToggle = document.querySelector('#construction-preview-toggle');
const constructionDownloadLDraw = document.querySelector('#construction-download-ldraw');
const constructionDownloadGraph = document.querySelector('#construction-download-graph');
const constructionDownloadBom = document.querySelector('#construction-download-bom');
const constructionDownloadValidation = document.querySelector('#construction-download-validation');
const constructionPriceInput = document.querySelector('#construction-price-input');
const constructionCostStatus = document.querySelector('#construction-cost-status');
const constructionCostList = document.querySelector('#construction-cost-list');

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
let constructionWorker = null;
let activeConstruction;
let activeConstructionAlternatives = [];
let activePriceCatalogue = null;
let activeTargetGrid;
let activeObliqueFeatures = [];
let activeVoxelGroup;
let activeFeatureGroup;
let activeConstructionGroup;
let activeCandidateGroup;
let candidatePreviewVisible = true;
let voxelOverlayVisible = true;
let featureOverlayVisible = true;
let importedPartFeatureProfiles = [];
let constructionPreviewVisible = true;
const ghostedMaterialStates = new Map();

function setMessage(text, kind = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
}

function setActivity(stage, detail, state = 'working', step = -1) {
  if (!activityPanel) return;
  activityPanel.hidden = false;
  activityPanel.dataset.state = state;
  activityTitle.textContent = stage;
  activityDetail.textContent = detail;
  activitySteps.forEach((item, index) => {
    item.dataset.status = index < step ? 'complete' : index === step ? 'active' : 'pending';
  });
}

function clearActivity() {
  if (!activityPanel) return;
  activityPanel.hidden = true;
  activityPanel.dataset.state = 'idle';
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



function removeCandidatePreview() {
  if (activeCandidateGroup && scene) {
    scene.remove(activeCandidateGroup);
    activeCandidateGroup.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
  }
  activeCandidateGroup = null;
  if (candidatePreviewToggle) {
    candidatePreviewToggle.disabled = true;
    candidatePreviewToggle.textContent = 'Candidate overlay unavailable';
  }
}

function renderCandidatePreview(profile, pattern) {
  if (!scene || !pattern?.placement_resolved || !profile?.preview_geometry_included
      || !Array.isArray(profile.mesh_positions_mm) || profile.mesh_positions_mm.length % 9 !== 0) {
    setMessage('This profile does not contain preview geometry or the opening pattern has no reliable 3D placement.', 'warning');
    return;
  }
  removeCandidatePreview();
  const positions = transformPartPreviewPositions(
    profile.mesh_positions_mm,
    pattern.rotation_matrix_3x3,
    pattern.translation_mm,
    currentModelCenter,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({
    color: 0xD85F2B,
    wireframe: true,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 40;
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'Candidate part geometric overlay';
  group.add(mesh);
  scene.add(group);
  activeCandidateGroup = group;
  candidatePreviewVisible = true;
  candidatePreviewToggle.disabled = false;
  candidatePreviewToggle.textContent = 'Hide candidate part overlay';
  setMessage(
    'Showing ' + profile.part_id + ' aligned from its opening pattern. This is a geometric overlay, not a verified surface fit or buildability result.',
    'info',
  );
}

function toggleCandidatePreview() {
  if (!activeCandidateGroup) return;
  candidatePreviewVisible = !candidatePreviewVisible;
  activeCandidateGroup.visible = candidatePreviewVisible;
  candidatePreviewToggle.textContent = candidatePreviewVisible
    ? 'Hide candidate part overlay'
    : 'Show candidate part overlay';
}

function removeFeatureOverlay() {
  if (!activeFeatureGroup) return;
  scene.remove(activeFeatureGroup);
  activeFeatureGroup.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });
  activeFeatureGroup = null;
  if (featureOverlayToggle) {
    featureOverlayToggle.disabled = true;
    featureOverlayToggle.textContent = 'Show opening markers';
  }
}

function renderFeatureOverlay(grid) {
  removeFeatureOverlay();
  if (!grid.features.length) return;
  const group = new THREE.Group();
  group.name = 'Detected mesh opening markers';
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xE66B2E,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
  });
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xE66B2E,
    transparent: true,
    opacity: 0.98,
    depthTest: false,
  });

  for (const feature of grid.features) {
    const centre = feature.center_mm.map((value, axis) => value - currentModelCenter[axis]);
    if (feature.shape === 'round opening') {
      const radius = Math.max(feature.equivalent_diameter_mm * 0.5, 0.5);
      const geometry = new THREE.TorusGeometry(radius, Math.max(0.35, radius * 0.035), 8, 48);
      const marker = new THREE.Mesh(geometry, ringMaterial.clone());
      marker.position.set(...centre);
      if (feature.axis === 'x') marker.rotation.y = Math.PI / 2;
      else if (feature.axis === 'y') marker.rotation.x = Math.PI / 2;
      marker.renderOrder = 20;
      marker.userData.featureId = feature.id;
      group.add(marker);
    } else {
      const minimum = feature.bounds_mm[0];
      const maximum = feature.bounds_mm[1];
      const otherAxes = [0, 1, 2].filter((axis) => axis !== feature.axis_index);
      const corners = [
        [minimum[otherAxes[0]], minimum[otherAxes[1]]],
        [maximum[otherAxes[0]], minimum[otherAxes[1]]],
        [maximum[otherAxes[0]], maximum[otherAxes[1]]],
        [minimum[otherAxes[0]], maximum[otherAxes[1]]],
      ];
      const points = corners.map((corner) => {
        const point = [0, 0, 0];
        point[feature.axis_index] = feature.center_mm[feature.axis_index];
        point[otherAxes[0]] = corner[0];
        point[otherAxes[1]] = corner[1];
        return new THREE.Vector3(...point.map((value, axis) => value - currentModelCenter[axis]));
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const marker = new THREE.LineLoop(geometry, lineMaterial.clone());
      marker.renderOrder = 20;
      marker.userData.featureId = feature.id;
      group.add(marker);
    }
  }

  ringMaterial.dispose();
  lineMaterial.dispose();
  activeFeatureGroup = group;
  featureOverlayVisible = true;
  scene.add(group);
  if (featureOverlayToggle) {
    featureOverlayToggle.disabled = false;
    featureOverlayToggle.textContent = 'Hide opening markers';
  }
}

function setSourceMeshGhosted(ghosted) {
  for (const mesh of activeMeshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      if (ghosted) {
        if (!ghostedMaterialStates.has(material)) {
          ghostedMaterialStates.set(material, {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          });
        }
        material.transparent = true;
        material.opacity = 0.22;
        material.depthWrite = false;
      } else {
        const original = ghostedMaterialStates.get(material);
        if (original) {
          material.opacity = original.opacity;
          material.transparent = original.transparent;
          material.depthWrite = original.depthWrite;
          ghostedMaterialStates.delete(material);
        }
      }
      material.needsUpdate = true;
    }
  }
}

function removeConstructionPreview() {
  if (activeConstructionGroup && scene) {
    scene.remove(activeConstructionGroup);
    activeConstructionGroup.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
      else object.material?.dispose?.();
    });
  }
  activeConstructionGroup = null;
  setSourceMeshGhosted(false);
  constructionPreviewToggle.disabled = true;
  constructionPreviewToggle.textContent = 'Show generated construction';
}

function renderConstructionPreview(result) {
  removeConstructionPreview();
  if (!activeTargetGrid || !result?.parts?.length || !result.profile_dimensions) {
    throw new Error('The generated assembly is missing preview dimensions or its target grid.');
  }

  const allCells = [];
  const [, courseCount] = activeTargetGrid.spec.dimensions;
  for (let layer = 0; layer < courseCount; layer += 1) {
    for (const [x, z] of activeTargetGrid.layer_footprint(layer)) allCells.push([x, z]);
  }
  if (!allCells.length) throw new Error('The target grid contains no occupied cells.');
  const targetCellBounds = {
    minX: Math.min(...allCells.map(([x]) => x)),
    maxX: Math.max(...allCells.map(([x]) => x)),
    minZ: Math.min(...allCells.map(([, z]) => z)),
    maxZ: Math.max(...allCells.map(([, z]) => z)),
  };
  const palette = new Map([
    [4, 0xC91A09],
    [1, 0x0055BF],
    [14, 0xF2CD37],
    [2, 0x237841],
    [15, 0xFFFFFF],
    [0, 0x05131D],
  ]);
  const materials = new Map();
  const geometries = new Map();
  const group = new THREE.Group();
  group.name = 'Generated construction preview';

  for (const part of result.parts) {
    const dimensions = result.profile_dimensions[part.part_id];
    if (!dimensions) throw new Error('Missing preview dimensions for part ' + part.part_id + '.');
    const transform = constructionPreviewTransform(
      part, dimensions, activeTargetGrid.spec, targetCellBounds, currentModelCenter,
    );
    const geometryKey = part.part_id;
    if (!geometries.has(geometryKey)) {
      geometries.set(geometryKey, new THREE.BoxGeometry(...transform.size_mm));
    }
    const colourCode = part.colour_code;
    if (!materials.has(colourCode)) {
      materials.set(colourCode, new THREE.MeshStandardMaterial({
        color: palette.get(colourCode) ?? 0xA0A0A0,
        roughness: 0.68,
        metalness: 0,
      }));
    }
    const mesh = new THREE.Mesh(geometries.get(geometryKey), materials.get(colourCode));
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.position.set(...transform.position_mm);
    mesh.rotation.y = transform.rotation_y_rad;
    mesh.userData.partId = part.part_id;
    group.add(mesh);
  }

  activeConstructionGroup = group;
  scene.add(group);
  constructionPreviewVisible = true;
  setSourceMeshGhosted(true);
  constructionPreviewToggle.disabled = false;
  constructionPreviewToggle.textContent = 'Hide generated construction';
  group.visible = true;
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
  activeConstructionAlternatives = [];
  constructionAlternatives.replaceChildren();
  buildConstructionButton.disabled = true;
  constructionStatus.textContent = 'Voxelise a mesh first.';
  constructionStatus.dataset.state = 'idle';
  constructionSummary.hidden = true;
  constructionDownloadLDraw.disabled = true;
  constructionDownloadGraph.disabled = true;
  constructionDownloadBom.disabled = true;
  constructionDownloadValidation.disabled = true;
  removeVoxelOverlay();
  removeFeatureOverlay();
  removeCandidatePreview();
  removeConstructionPreview();
  activeTargetGrid = null;
  activeObliqueFeatures = [];
  if (voxelFeatureStatus) { voxelFeatureStatus.hidden = true; voxelFeatureStatus.textContent = ''; }
  if (voxelFeatureList) voxelFeatureList.replaceChildren();
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



function validPreviewGeometry(profile) {
  if ([1, 2].includes(profile?.schema_version)) return true;
  if (typeof profile?.preview_geometry_included !== 'boolean'
      || !Number.isInteger(profile.mesh_triangle_count)
      || profile.mesh_triangle_count < 0 || profile.mesh_triangle_count > 4000) return false;
  if (!profile.preview_geometry_included) {
    return profile.mesh_triangle_count === 0 && profile.mesh_positions_mm === undefined;
  }
  return profile.mesh_triangle_count > 0
    && Array.isArray(profile.mesh_positions_mm)
    && profile.mesh_positions_mm.length === profile.mesh_triangle_count * 9
    && profile.mesh_positions_mm.length <= 36000
    && profile.mesh_positions_mm.every(Number.isFinite);
}

function validImportedFeatureProfile(profile) {
  return profile && typeof profile === 'object'
    && [1, 2, 3].includes(profile.schema_version)
    && validPreviewGeometry(profile)
    && typeof profile.part_id === 'string' && profile.part_id.length > 0
    && typeof profile.description === 'string'
    && typeof profile.source_filename === 'string'
    && Array.isArray(profile.dimensions_mm) && profile.dimensions_mm.length === 3
    && profile.dimensions_mm.every(Number.isFinite)
    && Array.isArray(profile.features)
    && profile.features.every((feature) => feature
      && typeof feature.id === 'string'
      && ['round opening', 'elongated slot/opening', 'irregular opening'].includes(feature.shape)
      && (['x', 'y', 'z'].includes(feature.axis)
        || (feature.axis === 'oblique' && Array.isArray(feature.axis_vector_world)
          && feature.axis_vector_world.length === 3 && feature.axis_vector_world.every(Number.isFinite)))
      && Number.isFinite(feature.width_mm) && feature.width_mm > 0
      && Number.isFinite(feature.length_mm) && feature.length_mm > 0
      && Number.isFinite(feature.circularity)
      && Number.isFinite(feature.aspect_ratio)
      && ((feature.minimum_width_mm === undefined && feature.maximum_width_mm === undefined)
        || (Number.isFinite(feature.minimum_width_mm) && feature.minimum_width_mm > 0
          && Number.isFinite(feature.maximum_width_mm) && feature.maximum_width_mm >= feature.minimum_width_mm))
      && ((feature.minimum_length_mm === undefined && feature.maximum_length_mm === undefined)
        || (Number.isFinite(feature.minimum_length_mm) && feature.minimum_length_mm > 0
          && Number.isFinite(feature.maximum_length_mm) && feature.maximum_length_mm >= feature.minimum_length_mm))
      && Number.isInteger(feature.sample_support) && feature.sample_support >= 2
      && (feature.shape !== 'round opening'
        || (feature.minimum_equivalent_diameter_mm === undefined && feature.maximum_equivalent_diameter_mm === undefined)
        || (Number.isFinite(feature.minimum_equivalent_diameter_mm)
          && Number.isFinite(feature.maximum_equivalent_diameter_mm)
          && feature.minimum_equivalent_diameter_mm > 0
          && feature.maximum_equivalent_diameter_mm >= feature.minimum_equivalent_diameter_mm)));
}


function collectSurfaceTrianglePositions() {
  const triangleCount = activeMeshes.reduce((sum, mesh) => {
    const geometry = mesh.geometry;
    return sum + (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  }, 0);
  if (!triangleCount || triangleCount > 100000) {
    throw new Error("Surface scoring requires between 1 and 100,000 target triangles.");
  }
  const positions = new Float32Array(triangleCount * 9);
  const point = new THREE.Vector3();
  let offset = 0;
  for (const mesh of activeMeshes) {
    mesh.updateMatrixWorld(true);
    const geometry = mesh.geometry;
    const attribute = geometry.attributes.position;
    const indices = geometry.index;
    const indexAt = (index) => indices ? indices.getX(index) : index;
    const indexCount = indices ? indices.count : attribute.count;
    for (let index = 0; index < indexCount; index += 3) {
      for (let corner = 0; corner < 3; corner += 1) {
        point.fromBufferAttribute(attribute, indexAt(index + corner)).applyMatrix4(mesh.matrixWorld);
        positions[offset++] = point.x;
        positions[offset++] = point.y;
        positions[offset++] = point.z;
      }
    }
  }
  return positions;
}

function scoreCandidateSurface(profile, pattern, statusNode) {
  if (!pattern?.placement_resolved || !profile?.preview_geometry_included
      || !Array.isArray(profile.mesh_positions_mm)) {
    statusNode.textContent = "Surface scoring needs a resolved placement and measured part triangle geometry.";
    return;
  }
  statusNode.textContent = "Measuring candidate surface against the source mesh…";
  try {
    const candidatePositions = transformPartPreviewPositions(
      profile.mesh_positions_mm,
      pattern.rotation_matrix_3x3,
      pattern.translation_mm,
      currentModelCenter,
    );
    const targetPositions = collectSurfaceTrianglePositions();
    const report = scoreSurfaceFit(candidatePositions, targetPositions);
    statusNode.textContent = "Candidate-to-target alignment: " + report.status.replaceAll("_", " ")
      + " · " + Math.round(report.candidate_to_target.within_tolerance_fraction * 100) + "% of candidate samples within "
      + report.tolerance_mm.toFixed(1) + " mm"
      + " · mean " + report.candidate_to_target.mean_distance_mm.toFixed(2) + " mm"
      + " · 95th percentile " + report.candidate_to_target.percentile_95_distance_mm.toFixed(2) + " mm"
      + " · candidate score " + Math.round(report.score * 100) + "/100"
      + " · whole-target reverse coverage " + Math.round(report.target_to_candidate.within_tolerance_fraction * 100)
      + "% (context only; one part is not expected to cover the whole object). Not a fit or buildability certificate.";
    statusNode.dataset.state = report.status;
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : "Surface scoring failed.";
    statusNode.dataset.state = "error";
  }
}

function refineCandidateSurfacePlacement(profile, pattern, statusNode) {
  if (!pattern?.placement_resolved || !profile?.preview_geometry_included
      || !Array.isArray(profile.mesh_positions_mm)) {
    statusNode.textContent = "Surface refinement needs a resolved placement and measured part triangle geometry.";
    return;
  }
  if (!Array.isArray(pattern.opening_match_translation_mm)) {
    pattern.opening_match_translation_mm = [...pattern.translation_mm];
  }
  if (!Array.isArray(pattern.opening_match_translation_mm)) pattern.opening_match_translation_mm = [...pattern.translation_mm];
  if (!Array.isArray(pattern.opening_match_rotation_matrix)) pattern.opening_match_rotation_matrix = pattern.rotation_matrix_3x3.map((row) => [...row]);
  statusNode.textContent = "Testing bounded translation and rotation adjustments against the source mesh…";
  try {
    const candidatePositions = transformPartPreviewPositions(
      profile.mesh_positions_mm,
      pattern.rotation_matrix_3x3,
      pattern.translation_mm,
      currentModelCenter,
    );
    const report = refineSurfaceFitPose(candidatePositions, collectSurfaceTrianglePositions(), {
      radiusMm: 1,
      rotationDegrees: 3,
    });
    if (!report.improved) {
      statusNode.textContent = "No better surface alignment was found within ±1 mm. The opening-derived placement was retained.";
      statusNode.dataset.state = "unchanged";
      return;
    }
    const originalRotation = pattern.rotation_matrix_3x3.map((row) => [...row]);
    const multiply = (left, right) => left.map((row) => right[0].map((_, column) =>
      row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
    const apply = (matrix, point) => matrix.map((row) =>
      row.reduce((sum, value, index) => sum + value * point[index], 0));
    const localCentre = [0, 0, 0];
    const meshPositions = profile.mesh_positions_mm;
    const vertexCount = meshPositions.length / 3;
    for (let index = 0; index < meshPositions.length; index += 3) {
      localCentre[0] += meshPositions[index] / vertexCount;
      localCentre[1] += meshPositions[index + 1] / vertexCount;
      localCentre[2] += meshPositions[index + 2] / vertexCount;
    }
    const worldCentre = apply(originalRotation, localCentre)
      .map((value, axis) => value + pattern.translation_mm[axis]);
    const refinedRotation = multiply(report.rotation_delta_matrix_3x3, originalRotation);
    const refinedCentre = apply(refinedRotation, localCentre);
    pattern.rotation_matrix_3x3 = refinedRotation;
    pattern.translation_mm = worldCentre.map((value, axis) =>
      value - refinedCentre[axis] + report.translation_offset_mm[axis]);
    pattern.surface_refinement_offset_mm = [...report.translation_offset_mm];
    pattern.surface_refinement_rotation_matrix_3x3 = report.rotation_delta_matrix_3x3;
    renderCandidatePreview(profile, pattern);
    statusNode.textContent = "Surface pose improved · translation offset "
      + report.translation_offset_mm.map((value) => value.toFixed(1)).join(", ")
      + " mm · local rotation " + Math.round(3) + "° max · mean distance "
      + report.baseline.mean_distance_mm.toFixed(2) + " → "
      + report.best.mean_distance_mm.toFixed(2) + " mm. Opening alignment may change; reset restores the original pose.";
    statusNode.dataset.state = "refined";
  } catch (error) {
    statusNode.textContent = error instanceof Error ? error.message : "Surface placement refinement failed.";
    statusNode.dataset.state = "error";
  }
}

function renderFeaturePatterns() {
  if (!featurePatternStatus || !featurePatternList) return;
  featurePatternList.replaceChildren();
  const targetFeatures = activeTargetGrid ? [...activeTargetGrid.features, ...activeObliqueFeatures] : [];
  if (!activeTargetGrid || targetFeatures.length < 2 || targetFeatures.length > 10) {
    featurePatternStatus.textContent = 'Whole-pattern matching needs between 2 and 10 detected target openings.';
    return;
  }
  if (!importedPartFeatureProfiles.length) {
    featurePatternStatus.textContent = 'Import part feature profiles to compare complete opening layouts.';
    return;
  }
  const patterns = matchFeaturePatterns(targetFeatures, importedPartFeatureProfiles, {
    limit: 5,
    maxSearchStates: 5000,
    targetBoundsMm: activeTargetGrid.source_bounds_mm,
  });
  if (!patterns.length) {
    featurePatternStatus.textContent = 'No complete one-to-one opening layout matched within the current spacing and size tolerances. Individual candidates above may still be useful.';
    return;
  }
  featurePatternStatus.textContent = patterns.length + ' complete spatial pattern candidate(s). Pairwise spacing is compared independently of translation and rotation, and a rigid transform is estimated where feature centres are non-collinear; the AABB containment check is only a coarse bound and physical connections are not yet verified.';
  patterns.forEach((pattern) => {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    const detail = document.createElement('span');
    const assignment = document.createElement('small');
    const placement = document.createElement('small');
    const envelope = pattern.part_dimensions_mm
      ? ' · envelope ' + pattern.part_dimensions_mm.map((value) => value.toFixed(1)).join(' × ') + ' mm'
      : '';
    heading.textContent = pattern.part_id + ' · ' + pattern.description;
    const envelopeCheck = pattern.envelope_contained === true
      ? ' · part AABB within target AABB'
      : pattern.envelope_contained === false
        ? ' · part AABB extends outside target bounds by ' + pattern.envelope_outside_mm.toFixed(1) + ' mm'
        : ' · part envelope not assessed';
    detail.textContent = Math.round(pattern.score * 100) + '% pattern score · '
      + pattern.matched_feature_count + '/' + pattern.target_feature_count
      + ' target openings assigned · ' + Math.round(pattern.profile_coverage * 100)
      + '% of profile openings used · spacing RMS ' + pattern.pattern_error_mm.toFixed(2) + ' mm'
      + envelope + envelopeCheck;
    assignment.textContent = pattern.assignments.map((entry) =>
      entry.target_feature_id + ' → ' + entry.candidate_feature_id + ' (local ' + entry.local_axis.toUpperCase() + ')'
    ).join(' · ');
    placement.textContent = pattern.placement_resolved
      ? 'Rigid placement estimate · residual ' + pattern.rms_residual_mm.toFixed(3)
        + ' mm · axis alignment ' + pattern.axis_alignment_rms_deg.toFixed(2)
        + '° · translation ' + pattern.translation_mm.map((value) => value.toFixed(1)).join(', ') + ' mm'
      : 'Opening layout matched, but the rigid placement is not reliable: feature centres may be collinear, spacing residual may be too high, or opening axes may not align.';
    const profile = importedPartFeatureProfiles.find((candidate) => candidate.part_id === pattern.part_id);
    if (Array.isArray(pattern.translation_mm) && !Array.isArray(pattern.opening_match_translation_mm)) {
      pattern.opening_match_translation_mm = [...pattern.translation_mm];
    }
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'feature-preview-button';
    const canPreview = Boolean(pattern.placement_resolved && profile?.preview_geometry_included
      && Array.isArray(profile.mesh_positions_mm));
    preview.disabled = !canPreview;
    preview.textContent = canPreview ? 'Preview in 3D' : '3D preview unavailable';
    if (canPreview) preview.addEventListener('click', () => renderCandidatePreview(profile, pattern));
    const surfaceFit = document.createElement('button');
    surfaceFit.type = 'button';
    surfaceFit.className = 'feature-preview-button';
    surfaceFit.disabled = !canPreview;
    surfaceFit.textContent = canPreview ? 'Score surface alignment' : 'Surface scoring unavailable';
    const surfaceFitResult = document.createElement('small');
    surfaceFitResult.textContent = canPreview
      ? 'Compare measured part triangles with the source mesh surface.'
      : 'A resolved placement and lightweight part geometry are required.';
    if (canPreview) surfaceFit.addEventListener('click', () =>
      scoreCandidateSurface(profile, pattern, surfaceFitResult));
    const refine = document.createElement('button');
    refine.type = 'button';
    refine.className = 'feature-preview-button';
    refine.disabled = !canPreview;
    refine.textContent = 'Refine pose ±1 mm / 3°';
    if (canPreview) refine.addEventListener('click', () =>
      refineCandidateSurfacePlacement(profile, pattern, surfaceFitResult));
    const resetRefinement = document.createElement('button');
    resetRefinement.type = 'button';
    resetRefinement.className = 'feature-preview-button';
    resetRefinement.disabled = !Array.isArray(pattern.surface_refinement_offset_mm)
      && !Array.isArray(pattern.surface_refinement_rotation_matrix_3x3);
    resetRefinement.textContent = 'Reset opening alignment';
    resetRefinement.addEventListener('click', () => {
      pattern.translation_mm = [...pattern.opening_match_translation_mm];
      if (Array.isArray(pattern.opening_match_rotation_matrix)) {
        pattern.rotation_matrix_3x3 = pattern.opening_match_rotation_matrix.map((row) => [...row]);
      }
      delete pattern.surface_refinement_offset_mm;
      delete pattern.surface_refinement_rotation_matrix_3x3;
      renderCandidatePreview(profile, pattern);
      surfaceFitResult.textContent = 'Restored the original opening-pattern placement.';
      surfaceFitResult.dataset.state = 'unchanged';
      resetRefinement.disabled = true;
    });
    const inspect = document.createElement('a');
    inspect.href = './parts.html?part=' + encodeURIComponent(pattern.part_id);
    inspect.target = '_blank';
    inspect.rel = 'noopener noreferrer';
    inspect.textContent = 'Open part in Part Explorer';
    item.append(heading, detail, assignment, placement, preview, surfaceFit, refine, resetRefinement, surfaceFitResult, inspect);
    featurePatternList.append(item);
  });
}

function renderFeatureMatches() {
  if (!featureMatchStatus || !featureMatchList) return;
  featureMatchList.replaceChildren();
  const targetFeatures = activeTargetGrid ? [...activeTargetGrid.features, ...activeObliqueFeatures] : [];
  if (!activeTargetGrid || !targetFeatures.length) {
    featureMatchStatus.textContent = importedPartFeatureProfiles.length
      ? importedPartFeatureProfiles.length + ' part profile(s) loaded. Voxelise a target mesh with detected openings to compare them.'
      : 'Export measured part profiles from the Part Explorer, then import them here to compare against target openings.';
    renderFeaturePatterns();
    return;
  }
  if (!importedPartFeatureProfiles.length) {
    featureMatchStatus.textContent = 'No part profiles imported yet. Use the Part Explorer to analyse a candidate part and download its feature profile.';
    renderFeaturePatterns();
    return;
  }
  const comparisons = matchTargetFeatures(targetFeatures, importedPartFeatureProfiles);
  let totalMatches = 0;
  comparisons.forEach((comparison, index) => {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    const matches = document.createElement('div');
    heading.textContent = 'Target feature ' + (index + 1)
      + (targetFeatures[index].axis === 'oblique' ? ' · oblique section' : '');
    if (!comparison.matches.length) {
      const none = document.createElement('span');
      none.textContent = 'No measured profile within the current dimensional tolerances.';
      matches.append(none);
    } else {
      comparison.matches.forEach((match) => {
        totalMatches += 1;
        const entry = document.createElement('p');
        const score = Math.round(match.score * 100);
        const envelope = match.part_dimensions_mm
          ? ' · part envelope ' + match.part_dimensions_mm.map((value) => value.toFixed(1)).join(' × ') + ' mm'
          : '';
        entry.textContent = match.part_id + ' · ' + match.description
          + ' · ' + score + '% geometric similarity'
          + ' · size difference ' + match.size_error_mm.toFixed(2) + ' mm'
          + ' · local opening axis ' + match.local_axis.toUpperCase()
          + envelope
          + ' · ' + match.confidence + ' confidence';
        const inspect = document.createElement('a');
        inspect.href = './parts.html?part=' + encodeURIComponent(match.part_id);
        inspect.target = '_blank';
        inspect.rel = 'noopener noreferrer';
        inspect.textContent = 'Inspect part geometry';
        entry.append(' ', inspect);
        matches.append(entry);
      });
    }
    item.append(heading, matches);
    featureMatchList.append(item);
  });
  featureMatchStatus.textContent = totalMatches
    ? totalMatches + ' geometric candidate match(es) found across ' + importedPartFeatureProfiles.length
      + ' imported part profile(s), including ' + activeObliqueFeatures.length
      + ' oblique target section candidate(s). These are not verified fits or buildability results.'
    : 'No compatible opening profiles found in the imported set. The target features remain unresolved.';
  if (featureInterfaceList) {
    featureInterfaceList.replaceChildren();
    const interfaceMatches = matchNominalConnectionInterfaces(targetFeatures, importedPartFeatureProfiles);
    interfaceMatches.forEach((match) => {
      const item = document.createElement('li');
      item.textContent = match.part_id + ' · ' + match.interface_type
        + ' · target Ø ' + match.target_diameter_mm.toFixed(2) + ' mm'
        + ' / nominal Ø ' + match.nominal_diameter_mm.toFixed(2) + ' mm'
        + ' · source ' + match.source_file
        + ' · ' + match.note;
      featureInterfaceList.append(item);
    });
    if (!interfaceMatches.length) {
      const item = document.createElement('li');
      item.textContent = 'No source-verified nominal interface dimensions match the measured round openings in the imported profiles.';
      featureInterfaceList.append(item);
    }
  }
  renderFeaturePatterns();
}

async function importPartFeatureProfiles(files) {
  const validProfiles = [];
  const errors = [];
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      errors.push(file.name + ' exceeds the 5 MB profile limit');
      continue;
    }
    try {
      const parsed = JSON.parse(await file.text());
      const profiles = parsed && [1, 2].includes(parsed.schema_version) && Array.isArray(parsed.profiles)
        ? parsed.profiles
        : [parsed];
      if (!profiles.length) {
        errors.push(file.name + ' contains no part feature profiles');
        continue;
      }
      const invalid = profiles.filter((profile) => !validImportedFeatureProfile(profile));
      if (invalid.length) {
        errors.push(file.name + ' contains ' + invalid.length + ' unsupported profile(s)');
        continue;
      }
      validProfiles.push(...profiles);
    } catch {
      errors.push(file.name + ' is not valid JSON');
    }
  }
  const merged = new Map(importedPartFeatureProfiles.map((profile) => [profile.part_id, profile]));
  for (const profile of validProfiles) merged.set(profile.part_id, profile);
  importedPartFeatureProfiles = [...merged.values()].slice(0, 100);
  removeCandidatePreview();
  renderFeatureMatches();
  if (errors.length) {
    featureMatchStatus.textContent += ' Import issues: ' + errors.join('; ') + '.';
  }
}

function displayVoxelSummary(grid, triangleCount) {
  const summary = grid.summary();
  voxelCellCount.textContent = summary.occupied_cell_count.toLocaleString() + ' occupied cells';
  voxelGridSize.textContent = summary.dimensions.join(' × ') + ' cells · '
    + 'pitch ' + grid.spec.pitch_mm.map((value) => value.toFixed(1)).join(' × ') + ' mm · '
    + triangleCount.toLocaleString() + ' triangles · '
    + summary.boundary_cell_count.toLocaleString() + ' boundary cells';
  voxelCourseList.replaceChildren();
  for (let y = 0; y < summary.dimensions[1]; y += 1) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const count = document.createElement('strong');
    const courseLabel = Math.abs(grid.spec.pitch_mm[1] - PLATE_GRID_PITCH_MM[1]) < 1e-6
      ? 'Plate course ' : 'Brick course ';
    label.textContent = courseLabel + (y + 1);
    count.textContent = grid.layer_footprint(y).length.toLocaleString() + ' cells';
    item.append(label, count);
    voxelCourseList.append(item);
  }
  if (voxelFeatureStatus) {
    const topology = grid.topology;
    const features = summary.features || [];
    const hasHandles = topology?.handle_count > 0;
    const keepouts = summary.feature_keepouts || [];
    const preserved = keepouts.filter((item) => item.preserved).length;
    const allRepresented = features.length > 0 && preserved === features.length
      && features.length === (topology?.handle_count || 0);
    const hasUnmatchedFeatures = (hasHandles || features.length > 0) && !allRepresented;
    voxelFeatureStatus.hidden = !(hasHandles || features.length > 0);
    voxelFeatureStatus.dataset.state = hasHandles || features.length ? 'warning' : 'complete';
    voxelFeatureStatus.textContent = hasHandles
      ? topology.handle_count.toLocaleString() + ' topological tunnel(s) detected; '
        + features.length.toLocaleString() + ' cross-section feature(s) localised; '
        + preserved.toLocaleString() + ' mapped to conservative grid-cell clearance tunnels. '
        + (allRepresented
          ? 'The represented openings may be larger than the source holes; inspect the voxel and construction previews.'
          : 'Construction remains blocked until every tunnel is localised and mapped.')
      : features.length.toLocaleString() + ' cross-section feature(s) detected. '
        + (allRepresented ? 'Conservative grid-cell clearances are applied.' : 'Construction remains blocked until the openings can be represented.');
    if (voxelFeatureList) {
      voxelFeatureList.replaceChildren();
      features.forEach((feature, index) => {
        const item = document.createElement('li');
        const heading = document.createElement('strong');
        const detail = document.createElement('span');
        const position = document.createElement('small');
        heading.textContent = 'Feature ' + (index + 1) + ' · ' + feature.shape;
        const size = feature.shape === 'round opening'
          ? 'Ø ' + feature.minimum_equivalent_diameter_mm.toFixed(1) + '–'
            + feature.maximum_equivalent_diameter_mm.toFixed(1) + ' mm across sections'
          : feature.minimum_width_mm.toFixed(1) + '–' + feature.maximum_width_mm.toFixed(1)
            + ' × ' + feature.minimum_length_mm.toFixed(1) + '–'
            + feature.maximum_length_mm.toFixed(1) + ' mm';
        detail.textContent = size + ' · axis ' + feature.axis.toUpperCase()
          + ' · ' + feature.sample_support + ' slices';
        const keepout = keepouts.find((entry) => entry.feature_id === feature.id);
        const preservation = keepout?.preserved
          ? ' · clearance cells ' + keepout.cell_count
            + (keepout.local_axial_bounds_mm
              ? ' · mapped ' + keepout.local_axial_bounds_mm.map((value) => value.toFixed(1)).join('–') + ' mm'
              : '')
          : ' · not preserved' + (keepout?.reason ? ': ' + keepout.reason : '');
        const axialBounds = feature.bounds_mm.map((point) => point[feature.axis_index]);
        position.textContent = 'Centre ' + feature.center_mm.map((value) => value.toFixed(1)).join(', ')
          + ' mm · local ' + feature.axis.toUpperCase() + ' extent '
          + axialBounds.map((value) => value.toFixed(1)).join('–') + ' mm' + preservation;
        item.append(heading, detail, position);
        voxelFeatureList.append(item);
      });
    }
  }
  renderFeatureMatches();
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
    setActivity('Mesh preparation failed', voxeliseStatus.textContent, 'error', -1);
    return;
  }
  resetVoxelisation();
  voxeliseButton.disabled = true;
  voxeliseStatus.textContent = 'Preparing triangle acceleration structure…';
  setActivity('Preparing geometry', 'Building a triangle acceleration structure for the mesh…', 'working', 3);
  voxeliseStatus.dataset.state = 'working';
  setMessage('Voxelising locally. The 3D viewer remains interactive while the worker processes the mesh.');
  try {
    voxelWorker = new Worker(new URL('./mesh-voxelizer-worker.js?v=featurekeepout5', import.meta.url), { type: 'module' });
  } catch (error) {
    voxeliseButton.disabled = false;
    voxeliseStatus.textContent = error instanceof Error ? error.message : 'Could not start the voxelisation worker.';
    voxeliseStatus.dataset.state = 'error';
    setActivity('Voxelisation worker failed', voxeliseStatus.textContent, 'error', -1);
    setActivity('Could not start voxeliser', voxeliseStatus.textContent, 'error', -1);
    setMessage(voxeliseStatus.textContent, 'error');
    return;
  }
  const worker = voxelWorker;
  worker.addEventListener('message', (event) => {
    if (worker !== voxelWorker) return;
    const data = event.data;
    if (data.type === 'progress') {
      if (data.phase === 'features') {
        voxeliseStatus.textContent = 'Locating sub-grid openings…';
        setActivity('Measuring mesh openings', 'Taking orthogonal cross-sections and measuring enclosed contours…', 'working', 4);
        return;
      }
      const percent = Math.round((data.completed / data.total) * 100);
      voxeliseStatus.textContent = 'Classifying grid columns… ' + percent + '%';
      setActivity('Voxelising mesh', 'Classifying grid columns… ' + percent + '%', 'working', 4);
      return;
    }
    worker.terminate();
    voxelWorker = null;
    voxeliseButton.disabled = false;
    if (data.type === 'error') {
      voxeliseStatus.textContent = data.message;
      voxeliseStatus.dataset.state = 'error';
      setActivity('Voxelisation failed', data.message, 'error', -1);
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
      activeObliqueFeatures = result.oblique_features || [];
      activeTargetGrid = new TargetGrid({
        spec,
        classification: result.classification,
        surface_coverage: result.surface_coverage,
        source_units: result.source_units,
        source_bounds_mm: result.source_bounds_mm,
        warnings: result.warnings,
        topology: result.topology,
        features: result.features || [],
        feature_keepouts: result.feature_keepouts || [],
      });
      voxelOverlayVisible = true;
      renderVoxelOverlay(activeTargetGrid);
      renderFeatureOverlay(activeTargetGrid);
      displayVoxelSummary(activeTargetGrid, result.triangle_count);
      const preservedFeatureCount = activeTargetGrid.feature_keepouts.filter((item) => item.preserved).length;
      const keepoutsComplete = activeTargetGrid.features.length > 0
        && preservedFeatureCount === activeTargetGrid.features.length
        && activeTargetGrid.features.length === (activeTargetGrid.topology?.handle_count || 0);
      const hasUnmatchedFeatures = (activeTargetGrid.topology?.handle_count > 0 || activeTargetGrid.features.length > 0)
        && !keepoutsComplete;
      buildConstructionButton.disabled = hasUnmatchedFeatures;
      if (hasUnmatchedFeatures) {
        constructionStatus.textContent = 'Construction blocked: ' + preservedFeatureCount + '/'
          + activeTargetGrid.features.length + ' detected openings have a conservative grid-cell clearance representation, but '
          + (activeTargetGrid.topology?.handle_count || activeTargetGrid.features.length)
          + ' topological tunnel(s) were detected. Unmapped openings must be resolved before construction.';
        constructionStatus.dataset.state = 'warning';
      } else if (keepoutsComplete) {
        constructionStatus.textContent = 'All detected openings have conservative grid-cell clearance tunnels. These can be larger than the source holes; inspect the target grid and generated construction carefully.';
        constructionStatus.dataset.state = 'ready';
      }
      const meshWarnings = result.warnings || [];
      voxeliseStatus.textContent = 'Voxelisation complete. ' + result.ray_triangle_tests.toLocaleString()
        + ' scanline tests and ' + result.cell_triangle_tests.toLocaleString()
        + ' cell-surface intersection tests were completed.'
        + (meshWarnings.length ? ' Review: ' + meshWarnings.join(' ') : '');
      voxeliseStatus.dataset.state = meshWarnings.length ? 'warning' : 'complete';
      clearActivity();
      setMessage(hasUnmatchedFeatures
        ? 'Target grid generated, but one or more detected openings could not be represented safely.'
        : keepoutsComplete
          ? 'Target grid generated with conservative clearance tunnels for all detected openings. These may be larger than the source features; inspect the preview before construction.'
          : 'Target grid generated in your browser. Orange cells intersect the mesh surface; blue cells are interior.',
      hasUnmatchedFeatures ? 'warning' : 'success');
    } catch (error) {
      voxeliseStatus.textContent = error instanceof Error ? error.message : 'Could not display the target grid.';
      voxeliseStatus.dataset.state = 'error';
      setActivity('Could not display target grid', voxeliseStatus.textContent, 'error', -1);
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
    pitchMm: courseHeightSelect.value === "plate" ? [...PLATE_GRID_PITCH_MM] : [...BRICK_GRID_PITCH_MM],
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
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderConstructionCostEstimates() {
  if (!constructionCostStatus || !constructionCostList) return;
  constructionCostList.replaceChildren();
  if (!activePriceCatalogue) {
    constructionCostStatus.textContent = "Import a dated, source-attributed price catalogue to compare actual part costs.";
    return;
  }
  const alternatives = activeConstructionAlternatives.length
    ? activeConstructionAlternatives : activeConstruction ? [activeConstruction] : [];
  if (!alternatives.length) {
    constructionCostStatus.textContent = "Price catalogue loaded. Generate a connected construction to estimate its BOM.";
    return;
  }
  const estimates = alternatives.map((alternative, index) => ({
    alternative,
    index,
    estimate: estimateBomCost(alternative.bom, activePriceCatalogue),
  }));
  estimates.forEach(({ alternative, index, estimate }) => {
    const item = document.createElement("li");
    const total = estimate.estimated_total === null
      ? "known subtotal " + activePriceCatalogue.currency + " " + estimate.known_subtotal.toFixed(2)
      : "estimated total " + activePriceCatalogue.currency + " " + estimate.estimated_total.toFixed(2);
    item.textContent = "Option " + (index + 1) + " · " + total
      + " · " + Math.round(estimate.coverage_fraction * 100) + "% of parts priced"
      + (estimate.missing.length
        ? " · missing prices: " + estimate.missing.map((entry) => entry.part_id + " × " + entry.quantity).join(", ")
        : " · complete BOM price coverage");
    constructionCostList.append(item);
  });
  constructionCostStatus.textContent = "Source: " + activePriceCatalogue.source
    + " · " + activePriceCatalogue.currency + " · prices dated " + activePriceCatalogue.as_of
    + ". Shipping, taxes, stock availability and seller basket effects are excluded.";
}

async function loadConstructionPriceCatalogue(file) {
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("Price catalogue exceeds the 2 MB import limit.");
    const catalogue = JSON.parse(await file.text());
    if (!validatePriceCatalogue(catalogue)) {
      throw new Error("Price file needs schema_version 1, a three-letter currency, source, as_of date and source-attributed part prices.");
    }
    activePriceCatalogue = catalogue;
    renderConstructionCostEstimates();
  } catch (error) {
    activePriceCatalogue = null;
    constructionCostStatus.textContent = error instanceof Error ? error.message : "Price catalogue could not be loaded.";
    constructionCostStatus.dataset.state = "error";
  }
}

function displayConstruction(result) {
  if (Array.isArray(result.alternatives)) activeConstructionAlternatives = result.alternatives;
  activeConstruction = result;
  constructionAlternatives.replaceChildren();
  if (activeConstructionAlternatives.length > 1) {
    const heading = document.createElement('strong');
    heading.textContent = 'Connected construction alternatives';
    constructionAlternatives.append(heading);
    activeConstructionAlternatives.forEach((alternative, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'tool-button';
      option.setAttribute('aria-pressed', String(alternative.model_name === result.model_name));
      option.textContent = 'Option ' + (index + 1) + ' · ' + alternative.parts.length + ' parts · '
        + alternative.optimization_metrics.unique_part_types + ' part types · '
        + Math.round(alternative.optimization_score * 100) + '/100 · '
        + alternative.course_part_counts.join(' / ') + ' per course';
      if (alternative.model_name === result.model_name) option.disabled = true;
      option.addEventListener('click', () => displayConstruction(alternative));
      constructionAlternatives.append(option);
    });
  }
  renderConstructionPreview(result);
  renderConstructionCostEstimates();
  constructionPartCount.textContent = result.parts.length.toLocaleString() + ' parts';
  const boundedSearch = result.search.budget_reached || result.search.candidate_search_limited;
  constructionDetails.textContent = result.connections.length.toLocaleString() + ' candidate connections · '
    + result.total_mating_pairs.toLocaleString() + ' nominal mating pairs'
    + ' · ' + result.optimization_profile + ' objective ' + Math.round(result.optimization_score * 100) + '/100'
    + (boundedSearch ? ' · bounded search; not guaranteed minimum' : '');
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
  constructionDownloadValidation.disabled = !result.validation_report;
  const preservedOpeningCount = activeTargetGrid.feature_keepouts.filter((item) => item.preserved).length;
  constructionStatus.textContent = 'Connected construction generated.'
    + (preservedOpeningCount
      ? ' ' + preservedOpeningCount + ' opening(s) are represented by conservative grid-cell clearances, which may be larger than the source holes.'
      : '')
    + (result.search?.candidate_search_limited
      ? ' The course-layout search used bounded interlocking samples, so this is not guaranteed to be the minimum-part solution.'
      : '')
    + ' Review the target and assembly previews and the stated nominal limitations before treating it as buildable.';
  constructionStatus.dataset.state = 'complete';
  setMessage('The variable-course assembly passed nominal body-overlap and connection-graph checks against the preserved target-grid occupancy.', 'success');
}

function runLayeredConstruction() {
  if (!activeTargetGrid || constructionWorker) return;
  const preservedFeatureCount = activeTargetGrid.feature_keepouts.filter((item) => item.preserved).length;
  const keepoutsComplete = activeTargetGrid.features.length > 0
    && preservedFeatureCount === activeTargetGrid.features.length
    && activeTargetGrid.features.length === (activeTargetGrid.topology?.handle_count || 0);
  if ((activeTargetGrid.topology?.handle_count > 0 || activeTargetGrid.features.length > 0) && !keepoutsComplete) {
    const count = activeTargetGrid.topology?.handle_count || activeTargetGrid.features.length;
    constructionStatus.textContent = 'Construction blocked: ' + count
      + ' topological tunnel/opening feature(s) are not all represented in the target grid. Resolve any unsupported or unlocalised openings before generating a construction.';
    constructionStatus.dataset.state = 'warning';
    setActivity('Unmatched geometry features', constructionStatus.textContent, 'error', -1);
    setMessage(constructionStatus.textContent, 'warning');
    return;
  }
  const pitch = activeTargetGrid.spec.pitch_mm;
  const isBrickPitch = pitch.every((value, index) =>
    Math.abs(value - BRICK_GRID_PITCH_MM[index]) <= 1e-6);
  const isPlatePitch = pitch.every((value, index) =>
    Math.abs(value - PLATE_GRID_PITCH_MM[index]) <= 1e-6);
  if (!isBrickPitch && !isPlatePitch) {
    constructionStatus.textContent = 'Construction supports the 8 × 9.6 × 8 mm brick grid or the 8 × 3.2 × 8 mm plate grid.';
    constructionStatus.dataset.state = 'error';
    setActivity('Unsupported grid spacing', constructionStatus.textContent, 'error', -1);
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
    setActivity('Cannot build empty course', constructionStatus.textContent, 'error', -1);
    return;
  }

  buildConstructionButton.disabled = true;
  constructionStatus.textContent = 'Preparing per-course footprints…';
  setActivity('Preparing construction', 'Extracting the occupied footprint from each course…', 'working', 5);
  constructionStatus.dataset.state = 'working';
  constructionSummary.hidden = true;
  setMessage('Searching for a connected arrangement across all occupied courses. The viewer remains interactive.');
  try {
    constructionWorker = new Worker(
      new URL('./layered-construction-worker.js?v=objectives2', import.meta.url),
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
      setActivity('Finding connected layout', data.message, 'working', 6);
      return;
    }
    worker.terminate();
    constructionWorker = null;
    buildConstructionButton.disabled = false;
    if (data.type === 'error') {
      constructionStatus.textContent = data.message;
      constructionStatus.dataset.state = 'error';
      setActivity('Construction search failed', data.message, 'error', -1);
      setMessage(data.message, 'error');
      return;
    }
    try {
      displayConstruction(data.result);
      clearActivity();
    } catch (error) {
      constructionStatus.textContent = error instanceof Error
        ? error.message : 'Could not display the generated construction.';
      constructionStatus.dataset.state = 'error';
      setActivity('Preview failed', constructionStatus.textContent, 'error', -1);
    }
  });
  worker.addEventListener('error', (event) => {
    if (worker !== constructionWorker) return;
    worker.terminate();
    constructionWorker = null;
    buildConstructionButton.disabled = false;
    constructionStatus.textContent = event.message || 'The construction worker failed.';
    constructionStatus.dataset.state = 'error';
    setActivity('Construction worker failed', constructionStatus.textContent, 'error', -1);
    setMessage(constructionStatus.textContent, 'error');
  });
  const courseType = Math.abs(activeTargetGrid.spec.pitch_mm[1] - PLATE_GRID_PITCH_MM[1]) < 1e-6
    ? "plate" : "brick";
  worker.postMessage({ layerFootprints, config: { maxParts: 200, courseType, optimizationProfile: constructionOptimizationProfile.value } });
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
  output.hint.textContent = `${fileName} · interpreted as ${sourceUnit} · source ${upAxisSelect.value.toUpperCase()}-up aligned to construction Y-up`;
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
  const orientation = orientationMatrixToYUp(upAxisSelect.value || "y");
  object.rotation.setFromRotationMatrix(new THREE.Matrix4().set(
    orientation[0][0], orientation[0][1], orientation[0][2], 0,
    orientation[1][0], orientation[1][1], orientation[1][2], 0,
    orientation[2][0], orientation[2][1], orientation[2][2], 0,
    0, 0, 0, 1,
  ));
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
  clearActivity();
  setMessage(
    `Mesh loaded locally. Source units interpreted as ${sourceUnit}; measurements are shown in millimetres. No L-brick buildability check has been run.`,
    'success',
  );
}

async function parseFile(file) {
  setActivity('Reading file', 'Opening the selected ' + file.name.split('.').pop().toUpperCase() + ' file locally…', 'working', 0);
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
    setActivity('Parsing STL geometry', 'Reading triangle data and preparing the surface mesh…', 'working', 1);
    const buffer = await file.arrayBuffer();
    const geometry = new STLLoader().parse(buffer);
    object = buildModelFromGeometry(geometry);
  } else if (extension === 'obj') {
    setActivity('Parsing OBJ geometry', 'Reading vertices, faces and object groups…', 'working', 1);
    const sourceText = await file.text();
    object = new OBJLoader().parse(sourceText);
  } else {
    throw new Error('Unsupported file type. Please choose an STL or OBJ file.');
  }

  setActivity('Preparing 3D preview', 'Checking geometry, calculating dimensions and positioning the model…', 'working', 2);
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
  setActivity('Reading file', 'Opening ' + file.name + ' in your browser…', 'working', 0);
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
    setActivity('Could not load mesh', error instanceof Error ? error.message : 'The file could not be read.', 'error', -1);
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

upAxisSelect.addEventListener('change', () => {
  if (currentFile) handleFile(currentFile);
});

courseHeightSelect.addEventListener('change', () => {
  if (!currentFile) return;
  resetVoxelisation();
  setMessage('Course height changed. Voxelise the mesh again to use the selected grid.', 'info');
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

featureProfileInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  featureProfileInput.value = '';
  if (files.length) await importPartFeatureProfiles(files);
});
voxeliseButton.addEventListener('click', runVoxelisation);
buildConstructionButton.addEventListener('click', runLayeredConstruction);
candidatePreviewToggle.addEventListener('click', toggleCandidatePreview);
constructionPreviewToggle.addEventListener('click', () => {
  if (!activeConstructionGroup) return;
  constructionPreviewVisible = !constructionPreviewVisible;
  activeConstructionGroup.visible = constructionPreviewVisible;
  setSourceMeshGhosted(constructionPreviewVisible);
  constructionPreviewToggle.textContent = constructionPreviewVisible
    ? 'Hide generated construction' : 'Show generated construction';
});
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
constructionPriceInput.addEventListener('change', () => loadConstructionPriceCatalogue(constructionPriceInput.files?.[0]));
constructionDownloadValidation.addEventListener('click', () => {
  if (activeConstruction?.validation_report) downloadConstructionFile(
    activeConstruction.model_name + '.validation.json',
    JSON.stringify(activeConstruction.validation_report, null, 2),
    'application/json;charset=utf-8',
  );
});
featureOverlayToggle.addEventListener('click', () => {
  if (!activeFeatureGroup) return;
  featureOverlayVisible = !featureOverlayVisible;
  activeFeatureGroup.visible = featureOverlayVisible;
  featureOverlayToggle.textContent = featureOverlayVisible ? 'Hide opening markers' : 'Show opening markers';
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
