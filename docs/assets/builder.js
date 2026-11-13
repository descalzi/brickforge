import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { buildFootprintBlock, buildRectangularBlock } from "./construction-engine.js";

const viewport = document.querySelector("#builder-viewport");
const emptyState = document.querySelector("#builder-empty");
const stateLabel = document.querySelector("#builder-state");
const message = document.querySelector("#builder-message");
const buildButton = document.querySelector("#build-block");
const footprintInput = document.querySelector("#footprint-grid");
const footprintButton = document.querySelector("#build-footprint");
const resetButton = document.querySelector("#builder-reset");

const inputs = {
  width: document.querySelector("#block-width"),
  depth: document.querySelector("#block-depth"),
  height: document.querySelector("#block-height"),
  lowerColour: document.querySelector("#lower-colour"),
  upperColour: document.querySelector("#upper-colour"),
};

const outputs = {
  parts: document.querySelector("#result-parts"),
  edges: document.querySelector("#result-edges"),
  pairs: document.querySelector("#result-pairs"),
  size: document.querySelector("#result-size"),
};

const downloadButtons = {
  ldraw: document.querySelector("#download-ldraw"),
  graph: document.querySelector("#download-graph"),
  bom: document.querySelector("#download-bom"),
};

const colourPalette = new Map([
  [0, 0x1B2A34],
  [1, 0x1E5AA8],
  [2, 0x00852B],
  [4, 0xB40000],
  [7, 0x8A928D],
  [14, 0xF2CD37],
  [15, 0xFFFFFF],
]);

let catalogue;
let currentResult;
let renderer;
let scene;
let camera;
let controls;
let currentModel;
let currentGrid;
let currentAxes;
let frameHandle = 0;
let viewerAvailable = false;

function setMessage(text, kind = "info") {
  message.textContent = text;
  message.dataset.kind = kind;
}

function setState(text, state = "ready") {
  stateLabel.textContent = text;
  stateLabel.dataset.state = state;
}

function formatMillimetres(value) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + " mm";
}

function initialiseViewer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xF8FAFB, 1);
  viewport.prepend(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xF8FAFB);
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100000);
  camera.up.set(0, 1, 0);

  scene.add(new THREE.HemisphereLight(0xFFFFFF, 0x62798B, 2.0));
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
  window.addEventListener("resize", resizeViewer);
  viewerAvailable = true;
  resetButton.disabled = false;
  emptyState.hidden = true;
  animate();
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
  frameHandle = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function disposeObject(object) {
  if (!object) return;
  object.traverse((child) => {
    if (!child.isMesh && !child.isLineSegments) return;
    if (child.geometry) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material && material.dispose());
  });
  scene.remove(object);
}

function clearModel() {
  disposeObject(currentModel);
  disposeObject(currentGrid);
  disposeObject(currentAxes);
  currentModel = null;
  currentGrid = null;
  currentAxes = null;
}

function colourFor(code) {
  return colourPalette.get(Number(code)) ?? 0x8399A8;
}

function featuresHiddenByConnections(result, profileByPart) {
  const hidden = new Map();
  const partByInstance = new Map(result.parts.map((part) => [
    part.instance_id,
    part,
  ]));

  function hideStud(instanceId, featureId) {
    const part = partByInstance.get(instanceId);
    if (!part) return;
    const profile = profileByPart.get(String(part.part_id));
    if (!profile) return;
    const feature = profile.features.find((item) => item.feature_id === featureId);
    if (!feature || feature.kind !== "stud") return;
    if (!hidden.has(instanceId)) hidden.set(instanceId, new Set());
    hidden.get(instanceId).add(featureId);
  }

  for (const edge of result.connections) {
    for (const pair of edge.mating_pairs) {
      hideStud(edge.instance_a, pair.feature_a);
      hideStud(edge.instance_b, pair.feature_b);
    }
  }
  return hidden;
}

function createPartObject(part, profile, hiddenStuds) {
  const group = new THREE.Group();
  const pitchMm = profile.stud_pitch_ldu * 0.4;
  const heightMm = profile.body_height_ldu * 0.4;
  const widthMm = profile.footprint_studs_x * pitchMm;
  const depthMm = profile.footprint_studs_z * pitchMm;
  const material = new THREE.MeshStandardMaterial({
    color: colourFor(part.colour_code),
    roughness: 0.52,
    metalness: 0,
  });

  const bodyGeometry = new THREE.BoxGeometry(widthMm, heightMm, depthMm);
  const body = new THREE.Mesh(bodyGeometry, material);
  body.position.y = -heightMm / 2;
  group.add(body);

  const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry);
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x26333C,
    transparent: true,
    opacity: 0.34,
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.position.copy(body.position);
  group.add(edges);

  const studHeightMm = profile.stud_projection_ldu * 0.4;
  const studRadiusMm = profile.stud_pitch_ldu * 0.12;
  const studGeometry = new THREE.CylinderGeometry(
    studRadiusMm,
    studRadiusMm,
    studHeightMm,
    20,
  );
  const studMaterial = new THREE.MeshStandardMaterial({
    color: colourFor(part.colour_code),
    roughness: 0.48,
    metalness: 0,
  });

  for (const feature of profile.features) {
    if (feature.kind !== "stud" || hiddenStuds.has(feature.feature_id)) continue;
    const stud = new THREE.Mesh(studGeometry, studMaterial);
    stud.position.set(
      feature.position_ldu[0] * 0.4,
      studHeightMm / 2,
      -feature.position_ldu[2] * 0.4,
    );
    group.add(stud);
  }

  const signs = [1, -1, -1];
  const rotation = part.matrix.map((value, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return value * signs[row] * signs[column];
  });
  const translation = part.translation_ldu;
  const matrix = new THREE.Matrix4().set(
    rotation[0], rotation[1], rotation[2], translation[0] * 0.4,
    rotation[3], rotation[4], rotation[5], -translation[1] * 0.4,
    rotation[6], rotation[7], rotation[8], -translation[2] * 0.4,
    0, 0, 0, 1,
  );
  group.matrixAutoUpdate = false;
  group.matrix.copy(matrix);
  group.matrixWorldNeedsUpdate = true;
  return group;
}

function fitCamera(bounds) {
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const maximum = Math.max(size.x, size.y, size.z, 1);
  const distance = maximum * 2.65;

  camera.near = Math.max(0.01, maximum / 10000);
  camera.far = maximum * 100;
  camera.position.set(
    centre.x + distance * 1.15,
    centre.y + distance * 0.92,
    centre.z + distance * 1.35,
  );
  camera.updateProjectionMatrix();
  controls.target.copy(centre);
  controls.minDistance = Math.max(maximum * 0.08, 0.1);
  controls.maxDistance = maximum * 30;
  controls.update();
}

function renderAssembly(result) {
  clearModel();
  const profileByPart = new Map(catalogue.profiles.map((profile) => [
    String(profile.part_id),
    profile,
  ]));
  const hiddenStuds = featuresHiddenByConnections(result, profileByPart);
  const model = new THREE.Group();
  for (const part of result.parts) {
    const profile = profileByPart.get(String(part.part_id));
    if (!profile) {
      throw new Error("No preview profile is available for part " + part.part_id + ".");
    }
    model.add(createPartObject(
      part,
      profile,
      hiddenStuds.get(part.instance_id) || new Set(),
    ));
  }
  scene.add(model);
  currentModel = model;

  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) throw new Error("The generated model has no visible geometry.");
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  currentGrid = new THREE.GridHelper(
    Math.max(Math.max(size.x, size.z) * 2.4, 20),
    24,
    0x9DADB9,
    0xD7E0E6,
  );
  currentGrid.position.y = bounds.min.y - 0.25;
  scene.add(currentGrid);

  currentAxes = new THREE.AxesHelper(Math.max(Math.max(size.x, size.y, size.z) * 0.24, 5));
  currentAxes.position.copy(centre);
  scene.add(currentAxes);
  fitCamera(bounds);
}

function updateResults(result) {
  outputs.parts.textContent = String(result.parts.length);
  outputs.edges.textContent = String(result.connections.length);
  outputs.pairs.textContent = String(result.total_mating_pairs);
  outputs.size.textContent = [
    formatMillimetres(result.dimensions_mm.width),
    formatMillimetres(result.dimensions_mm.depth),
    formatMillimetres(result.dimensions_mm.height),
  ].join(" × ");
}

function setDownloadsEnabled(enabled) {
  Object.values(downloadButtons).forEach((button) => {
    button.disabled = !enabled;
  });
}

function parseFootprintGrid(value) {
  const rows = value.trim().split(/\\r?\\n/).map((row) => row.trim());
  if (!rows.length || !rows[0].length) {
    throw new Error("Enter a footprint grid using # for occupied studs and . for empty cells.");
  }
  const rowWidth = rows[0].length;
  if (rows.some((row) => row.length !== rowWidth)) {
    throw new Error("Every footprint grid row must have the same number of characters.");
  }
  const cells = [];
  for (let z = 0; z < rows.length; z += 1) {
    for (let x = 0; x < rowWidth; x += 1) {
      const character = rows[z][x];
      if (character !== "#" && character !== ".") {
        throw new Error("Footprint grids may contain only # and . characters.");
      }
      if (character === "#") cells.push([x, z]);
    }
  }
  if (!cells.length) {
    throw new Error("The footprint grid must contain at least one occupied stud (#).");
  }
  return cells;
}

function generateFootprint() {
  if (!inputs.height.reportValidity()) return;
  buildButton.disabled = true;
  footprintButton.disabled = true;
  setState("GENERATING FOOTPRINT", "loading");
  setMessage("Searching for connected course tilings and checking the assembly on this device…");
  try {
    const cells = parseFootprintGrid(footprintInput.value);
    const result = buildFootprintBlock(cells, Number(inputs.height.value), catalogue, {
      colourCodes: [
        Number(inputs.lowerColour.value),
        Number(inputs.upperColour.value),
      ],
    });
    renderAssembly(result);
    currentResult = result;
    updateResults(result);
    setDownloadsEnabled(true);
    setState("VALIDATED / " + result.parts.length + " PARTS", "ready");
    setMessage(
      "Generated locally. " + result.connections.length + " connected interfaces and "
      + result.total_mating_pairs + " nominal feature pairs passed the geometric checks.",
      "success",
    );
  } catch (error) {
    currentResult = null;
    clearModel();
    setDownloadsEnabled(false);
    outputs.parts.textContent = "—";
    outputs.edges.textContent = "—";
    outputs.pairs.textContent = "—";
    outputs.size.textContent = "—";
    setState("FOOTPRINT NOT VALID", "error");
    setMessage(error instanceof Error ? error.message : "The footprint could not be generated.", "error");
  } finally {
    buildButton.disabled = !catalogue;
    footprintButton.disabled = !catalogue;
  }
}

function generateBlock() {
  const width = Number(inputs.width.value);
  const depth = Number(inputs.depth.value);
  const height = Number(inputs.height.value);

  if (![inputs.width, inputs.depth, inputs.height].every((input) => input.reportValidity())) {
    return;
  }

  buildButton.disabled = true;
  footprintButton.disabled = true;
  setState("GENERATING", "loading");
  setMessage("Placing parts and checking their nominal interfaces on this device…");
  try {
    const result = buildRectangularBlock(width, depth, height, catalogue, {
      partId: "3001",
      colourCodes: [
        Number(inputs.lowerColour.value),
        Number(inputs.upperColour.value),
      ],
    });
    renderAssembly(result);
    currentResult = result;
    updateResults(result);
    setDownloadsEnabled(true);
    setState("VALIDATED / " + result.parts.length + " PARTS", "ready");
    setMessage(
      "Generated locally. " + result.connections.length + " connected interfaces and "
      + result.total_mating_pairs + " nominal feature pairs passed the geometric checks.",
      "success",
    );
  } catch (error) {
    currentResult = null;
    clearModel();
    setDownloadsEnabled(false);
    outputs.parts.textContent = "—";
    outputs.edges.textContent = "—";
    outputs.pairs.textContent = "—";
    outputs.size.textContent = "—";
    setState("BUILD NOT VALID", "error");
    setMessage(error instanceof Error ? error.message : "The block could not be generated.", "error");
  } finally {
    buildButton.disabled = !catalogue;
    footprintButton.disabled = !catalogue;
  }
}

function downloadFile(filename, content, mediaType) {
  const blob = new Blob([content], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadLDraw() {
  if (!currentResult) return;
  downloadFile(
    currentResult.model_name + ".ldr",
    currentResult.ldraw,
    "text/plain;charset=utf-8",
  );
}

function downloadGraph() {
  if (!currentResult) return;
  downloadFile(
    currentResult.model_name + ".assembly.json",
    JSON.stringify(currentResult.assembly_graph, null, 2) + "\n",
    "application/json;charset=utf-8",
  );
}

function downloadBom() {
  if (!currentResult) return;
  downloadFile(
    currentResult.model_name + ".bom.json",
    JSON.stringify(currentResult.bom, null, 2) + "\n",
    "application/json;charset=utf-8",
  );
}

async function loadCatalogue() {
  const response = await fetch("./data/connection-profiles/basic-bricks.json", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Connection profile catalogue request failed (" + response.status + ").");
  }
  const payload = await response.json();
  if (payload.schema_version !== 1 || !Array.isArray(payload.profiles)) {
    throw new Error("The connection profile catalogue has an unsupported format.");
  }
  return payload;
}

buildButton.addEventListener("click", generateBlock);
footprintButton.addEventListener("click", generateFootprint);
resetButton.addEventListener("click", () => {
  if (currentResult && renderer) {
    fitCamera(new THREE.Box3().setFromObject(currentModel));
  }
});
downloadButtons.ldraw.addEventListener("click", downloadLDraw);
downloadButtons.graph.addEventListener("click", downloadGraph);
downloadButtons.bom.addEventListener("click", downloadBom);

try {
  initialiseViewer();
  catalogue = await loadCatalogue();
  buildButton.disabled = false;
  footprintButton.disabled = false;
  setMessage("Connection profiles loaded. Generate a block to begin.", "success");
  generateBlock();
} catch (error) {
  console.error("BrickForge browser construction engine failed:", error);
  setState("ENGINE UNAVAILABLE", "error");
  setMessage(
    error instanceof Error
      ? error.message + " Check your connection and reload this page."
      : "The construction engine could not initialise.",
    "error",
  );
  buildButton.disabled = true;
  footprintButton.disabled = true;
  setDownloadsEnabled(false);
}
