// Describe & build: description → object intent (any language model) → brick model.
import {ASSET_VERSION} from './release-version.js?v=9b8d8e12b3f3';
import {INTENT_INSTRUCTIONS, buildIntentRequest, normaliseIntent} from './object-intent.js?v=9b8d8e12b3f3';
import {intentCatalogue} from './intent-engine.js?v=9b8d8e12b3f3';
import {deviceModelState, deviceProvider, endpointProvider} from './device-interpretation.js?v=9b8d8e12b3f3';
import {buildInventory, inventoryCsv} from './build-inventory.js?v=9b8d8e12b3f3';
// Kept in step with instruction-pdf.js (not imported: the booklet loads in its worker).
const MAX_BOOKLET_PARTS = 8000;
import {createDesignViewer, colours} from './design-viewer.js?v=9b8d8e12b3f3';
import {colourByCode} from './brick-colours.js?v=9b8d8e12b3f3';

const $ = id => document.getElementById(id);
const status = $('engine-status'), intentInput = $('intent-input'), description = $('description-input');
let loadData = null;
// Fetch the meshes of vocabulary parts a plan uses, once each.
async function loadPreviews(plan) {
  const used = new Set((plan.parts || []).map(p => p.part_id));
  const missing = displayCatalogue.profiles.filter(p => used.has(p.part_id) && !p.preview_triangles_mm && p.mesh_file);
  await Promise.all(missing.map(async p => { p.preview_triangles_mm = (await loadData(p.mesh_file)).triangle_positions_mm; }));
}
let catalogue = null, displayCatalogue = null, schema = null, examples = [], result = null, activeIntent = null;
let worker = null, timer = null, pdfWorker = null, interpretation = null;
let viewer = null;
try { viewer = createDesignViewer($('studio-viewport')); } catch (error) { $('viewer-empty').textContent = '3D preview unavailable: ' + error.message; }

const setStatus = (message, state = 'ready') => { status.textContent = message; status.dataset.state = state; };
function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], {type})), a = document.createElement('a');
  a.href = url; a.download = name.replace(/[^a-zA-Z0-9._-]/g, '-'); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };

function promptText(text) {
  return `${INTENT_INSTRUCTIONS}\n\nJSON schema:\n${JSON.stringify(schema)}\n\nDescription:\n${text.trim()}`;
}

function showComponents(intent) {
  const list = $('component-list');
  list.replaceChildren();
  if (!intent) return;
  for (const c of intent.components || []) {
    const count = result?.parts?.filter(p => p.component_id === c.id).length;
    const code = typeof c.colour === 'string' ? null : c.colour;
    const row = el('button', {className: 'component-row', type: 'button'});
    row.setAttribute('aria-pressed', 'false');
    const swatch = el('span', {className: 'swatch'});
    const resolved = normaliseIntent({...intent, components: [c]}).intent?.components?.[0]?.colour ?? code;
    swatch.style.background = c.mode === 'void' ? 'repeating-linear-gradient(45deg,#fff,#fff 3px,#cbd5dc 3px,#cbd5dc 6px)' : colours.get(resolved) || '#a9b8c2';
    const text = el('span', {}, el('span', {className: 'component-name', textContent: c.label || c.id}), el('small', {textContent: `${c.role || 'body'} · ${c.shape}${c.mode && c.mode !== 'solid' ? ' · ' + c.mode : ''}`}));
    row.append(swatch, text, el('span', {className: 'component-state', textContent: count ? `${count} part${count === 1 ? '' : 's'}` : ''}));
    row.addEventListener('click', () => {
      const on = row.getAttribute('aria-pressed') !== 'true';
      for (const b of list.children) b.setAttribute?.('aria-pressed', 'false');
      row.setAttribute('aria-pressed', String(on));
      viewer?.select(on ? c.id : null);
    });
    list.append(row);
  }
}

function invalidate(message = 'Intent changed. Build again to update the model.') {
  finishWorker(); stopPdf();
  result = null;
  for (const id of ['download-ldraw', 'download-csv', 'download-pdf', 'download-report']) $(id).disabled = true;
  for (const id of ['stat-parts', 'stat-steps', 'stat-size', 'stat-fidelity']) $(id).textContent = '—';
  viewer?.clear();
  if (viewer) { $('viewer-empty').hidden = false; $('viewer-empty').textContent = 'Build the intent to inspect its model.'; }
  $('course-slider').disabled = true; $('step-slider').disabled = true;
  $('report-summary').replaceChildren(el('p', {className: 'muted', textContent: 'The deviation report appears here after building.'}));
  $('component-report').replaceChildren(); $('warning-list').replaceChildren(); $('validation-list').replaceChildren();
  $('engine-report').textContent = 'No model has been built yet.';
  setStatus(message);
}

function finishWorker() {
  worker?.terminate(); worker = null; clearTimeout(timer);
  $('cancel-build').hidden = true; $('build').disabled = !catalogue;
}

function currentIntent() {
  const parsed = JSON.parse(intentInput.value);
  const size = $('build-size').value;
  if (size) parsed.build = {...(parsed.build || {}), size, target_longest_studs: undefined};
  if (parsed.build && parsed.build.target_longest_studs === undefined) delete parsed.build.target_longest_studs;
  return parsed;
}

function build() {
  let intent;
  try {
    intent = currentIntent();
    const checked = normaliseIntent(intent);
    if (!checked.valid) throw new Error(checked.errors.join(' '));
  } catch (error) { setStatus('The intent is not valid: ' + error.message, 'blocked'); $('engine-report').textContent = error.message; return; }
  invalidate('Building…');
  activeIntent = intent;
  showComponents(intent);
  $('build').disabled = true; $('cancel-build').hidden = false;
  const big = ['xlarge', 'huge'].includes(intent.build?.size) || (intent.build?.target_longest_studs || 0) > 40;
  setStatus(`Rasterising the shapes and fitting real elements…${big ? ' Large models can take a minute.' : ''}`, 'planning');
  const started = performance.now();
  worker = new Worker(new URL('./studio-worker.js?v=9b8d8e12b3f3', import.meta.url), {type: 'module'});
  worker.onmessage = ({data}) => {
    finishWorker();
    if (data.error) { setStatus('Engine error: ' + data.error, 'blocked'); $('engine-report').textContent = data.error; return; }
    result = data.result;
    const seconds = (performance.now() - started) / 1000;
    loadPreviews(result).catch(() => {}).then(() => show(result, seconds));
  };
  worker.onerror = event => { finishWorker(); setStatus('Engine error: ' + event.message, 'blocked'); };
  timer = setTimeout(() => { finishWorker(); setStatus('Stopped after 4 minutes. Try a smaller model size.', 'blocked'); }, 240000);
  worker.postMessage({intent, catalogue, options: {}});
}

function show(plan, seconds) {
  $('engine-report').textContent = JSON.stringify({...plan, ldraw: undefined, intent: undefined}, null, 2);
  if (plan.status !== 'planned') { setStatus((plan.failures || ['No model was built.']).join(' '), 'blocked'); return; }
  const report = plan.intent_report;
  const display = {...plan, parts: plan.parts.map(p => ({...p, display_course_index: p.course_index}))};
  if (viewer) {
    try { viewer.show(display, displayCatalogue); $('viewer-empty').hidden = true; }
    catch (error) { $('viewer-empty').hidden = false; $('viewer-empty').textContent = error.message; }
  }
  const layers = Math.max(...display.parts.map(p => p.display_course_index)) + 1;
  Object.assign($('course-slider'), {max: layers, value: layers, disabled: false}); $('course-value').textContent = `${layers}/${layers}`;
  const steps = plan.instructions.steps;
  Object.assign($('step-slider'), {max: steps.length, value: steps.length, disabled: !steps.length}); $('step-value').textContent = `All ${steps.length}`;
  $('step-detail').textContent = 'Use the slider to step through the building order.';
  $('stat-parts').textContent = plan.parts.length;
  $('stat-steps').textContent = steps.length;
  const d = plan.dimensions_mm;
  $('stat-size').textContent = `${Math.round(d.width / 8)} × ${Math.round(d.depth / 8)} × ${Math.round(d.height / 3.2)}`;
  $('stat-fidelity').textContent = Math.round(report.shape_fidelity.soft_iou * 100) + '%';
  for (const id of ['download-ldraw', 'download-csv', 'download-report']) $(id).disabled = false;
  const pdfOk = plan.parts.length <= MAX_BOOKLET_PARTS;
  $('download-pdf').disabled = !pdfOk;
  $('download-pdf').title = pdfOk ? '' : `The in-browser booklet supports up to ${MAX_BOOKLET_PARTS} parts. Open the LDraw file in BrickLink Studio or LeoCAD for larger models.`;
  showComponents(activeIntent);
  showReport(plan);
  const joined = report.connectivity.connected ? 'one connected model' : 'some pieces need joining by hand';
  setStatus(`Built · ${plan.parts.length} parts in ${steps.length} steps · ${joined} · ${seconds.toFixed(1)} s. Strength and stability are not verified.`, report.connectivity.connected ? 'planned' : 'blocked');
}

function showReport(plan) {
  const r = plan.intent_report, summary = $('report-summary');
  summary.replaceChildren();
  const check = (name, detail, state) => { const row = el('div', {className: 'check'}, el('strong', {textContent: name}), el('small', {textContent: detail})); row.dataset.state = state; summary.append(row); };
  const d = plan.dimensions_mm;
  check('Scale', `Longest side ${r.scale.target_longest_studs} studs · one stud is ${r.scale.real_m_per_stud} m of the real object · model ${Math.round(d.width)} × ${Math.round(d.depth)} × ${Math.round(d.height)} mm.`, 'passed');
  const fidelity = el('div', {className: 'check'}, el('strong', {textContent: `Shape match ${Math.round(r.shape_fidelity.soft_iou * 100)}%`}), el('small', {textContent: 'Overlap between the intended shapes and the stud grid before detailing.'}));
  const bar = el('div', {className: 'fidelity-bar'}, el('span')); bar.firstChild.style.width = Math.round(r.shape_fidelity.soft_iou * 100) + '%';
  fidelity.append(bar); fidelity.dataset.state = r.shape_fidelity.soft_iou >= 0.6 ? 'passed' : 'warning'; summary.append(fidelity);
  check('Connected', r.connectivity.connected ? 'Every part is held by studs to the rest of the model.' : `${r.connectivity.disconnected_instance_ids.length} parts are not joined to the main model.`, r.connectivity.connected ? 'passed' : 'failed');
  if (r.wheels.length) check('Wheels', r.wheels.map(w => `${w.component_id}: ${w.construction === 'real_wheel_assembly' ? 'real wheel' : 'brick-built'}${w.reason ? ' (' + w.reason + ')' : ''}`).join('; '), 'passed');
  if (r.slopes.length) check('Slopes', r.slopes.map(s => `${s.component_id}: ${s.construction === 'slope_elements' ? `${s.pieces} ${s.family.replace('_', ' ')} slopes` : 'stepped (' + s.reason + ')'}`).join('; '), 'passed');
  const table = el('table', {className: 'report-table'});
  table.append(el('thead', {}, el('tr', {}, el('th', {textContent: 'Component'}), el('th', {textContent: 'Result'}), el('th', {textContent: 'Cells'}))));
  const body = el('tbody');
  for (const c of r.components) {
    const pill = el('span', {className: 'status-pill', textContent: c.status.replaceAll('_', ' ')}); pill.dataset.state = c.status;
    body.append(el('tr', {}, el('td', {textContent: c.component_id}), el('td', {}, pill), el('td', {textContent: c.realised_cells ?? '—'})));
  }
  table.append(body);
  $('component-report').replaceChildren(table);
  const warnings = el('ul');
  for (const w of [...plan.warnings, ...r.unsupported.map(u => 'Not expressed by the interpreter: ' + u)]) warnings.append(el('li', {textContent: w}));
  $('warning-list').replaceChildren(warnings);
  $('validation-list').replaceChildren(...plan.validation.checks.map(c => { const row = el('div', {className: 'check'}, el('strong', {textContent: c.id.replaceAll('_', ' ')}), el('small', {textContent: c.detail})); row.dataset.state = c.status; return row; }));
}

function stopPdf() { pdfWorker?.terminate(); pdfWorker = null; $('cancel-pdf').hidden = true; $('download-pdf').disabled = !result || result.status !== 'planned' || result.parts.length > MAX_BOOKLET_PARTS; }

async function interpret() {
  const provider = $('interpretation-provider').value, text = description.value;
  if (!text.trim()) { $('provider-status').textContent = 'Describe the object first.'; return; }
  if (provider === 'copy') {
    try {
      // Some browsers never settle a clipboard request without permission; fall back after 3 s.
      await Promise.race([navigator.clipboard.writeText(promptText(text)), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
      $('provider-status').textContent = 'Prompt copied. Paste it into an assistant, then paste its JSON reply into the object intent box and build.';
    }
    catch { download('brickforge-prompt.txt', promptText(text), 'text/plain'); $('provider-status').textContent = 'Clipboard unavailable: the prompt was downloaded instead.'; }
    intentInput.value = ''; intentInput.focus();
    return;
  }
  let run;
  try { run = provider === 'device' ? deviceProvider(globalThis.LanguageModel, p => { $('provider-status').textContent = p === null ? 'Interpreting…' : `Downloading model ${p}%`; }) : endpointProvider($('interpretation-endpoint').value); }
  catch (error) { $('provider-status').textContent = error.message; return; }
  interpretation?.abort(); interpretation = new AbortController();
  $('cancel-interpretation').hidden = false; $('interpret').disabled = true;
  $('provider-status').textContent = 'Interpreting the description…';
  try {
    const intent = await run(buildIntentRequest(text, schema), {signal: interpretation.signal});
    const checked = normaliseIntent(intent);
    intentInput.value = JSON.stringify(intent, null, 2);
    $('provider-status').textContent = checked.valid ? 'Intent received. Building…' : 'The model returned an invalid intent: ' + checked.errors.join(' ');
    showComponents(intent);
    if (checked.valid) build();
  } catch (error) {
    if (error.name !== 'AbortError') $('provider-status').textContent = error.message;
  } finally { $('cancel-interpretation').hidden = true; $('interpret').disabled = false; interpretation = null; }
}

async function updateProvider() {
  const provider = $('interpretation-provider').value;
  $('gateway-address').hidden = provider !== 'gateway';
  $('interpret').textContent = provider === 'copy' ? 'Copy prompt' : 'Interpret description';
  if (provider === 'copy') $('provider-status').textContent = 'Copy the prompt, paste it into an assistant, then paste its JSON reply below.';
  if (provider === 'gateway') $('provider-status').textContent = 'Your gateway receives the description, instructions and schema, and returns the intent JSON.';
  if (provider === 'device') {
    const state = await deviceModelState();
    $('provider-status').textContent = state === 'unavailable' ? 'This browser has no on-device language model.' : `On-device model: ${state}.`;
  }
}

function loadExample(id) {
  const example = examples.find(e => e.id === id);
  if (!example) return;
  description.value = example.description;
  intentInput.value = JSON.stringify(example.intent, null, 2);
  showComponents(example.intent);
  $('build-size').value = '';
  invalidate('Example loaded. Its intent was written by a language model from the description; build to see the model.');
}

async function initialise() {
  try {
    const load = async path => { const r = await fetch('./data/' + path + '?v=' + ASSET_VERSION); if (!r.ok) throw new Error(`Could not load ${path} (${r.status}). Reload to retry.`); return r.json(); };
    const [basic, standard, specialist, vocabulary, evaluation, extra, intentSchema] = await Promise.all([
      load('connection-profiles/basic-bricks.json'), load('connection-profiles/standard-elements-v1.json'), load('specialist-profiles-v1.json'),
      load('connection-profiles/part-vocabulary-profiles-v1.json'), load('intent-eval-v1.json'), load('intent-examples-v1.json'), load('object-intent-schema-v2.json')]);
    schema = intentSchema;
    catalogue = intentCatalogue(basic, standard, specialist, vocabulary);
    loadData = load;
    const previews = await Promise.all(specialist.profiles.map(async p => ({...p, preview_triangles_mm: (await load(p.mesh_file)).triangle_positions_mm})));
    // Vocabulary parts (slopes, curves, cones, windows, brackets) load their meshes when a build uses them.
    const shown = new Set(previews.map(p => p.part_id));
    displayCatalogue = {profiles: [...basic.profiles, ...standard.profiles, ...previews, ...vocabulary.profiles.filter(p => !shown.has(p.part_id)).map(p => ({...p}))]};
    examples = [...evaluation.cases, ...extra.cases.map(e => ({...e, category: 'bigger builds'}))];
    const select = $('example-select');
    select.replaceChildren(el('option', {value: '', textContent: 'Choose an example…'}));
    const groups = new Map([['bigger builds', el('optgroup', {label: 'Bigger builds (64–128 studs)'})]]);
    for (const e of examples) { if (!groups.has(e.category)) groups.set(e.category, el('optgroup', {label: e.category[0].toUpperCase() + e.category.slice(1)})); groups.get(e.category).append(el('option', {value: e.id, textContent: e.intent.name + (e.intent.build?.size ? ` · ${e.intent.build.size}` : '')})); }
    select.append(...groups.values()); select.disabled = false;
    $('build').disabled = false;
    const params = new URLSearchParams(location.search);
    const first = params.get('example') || 'cottage';
    if (examples.some(e => e.id === first)) { select.value = first; loadExample(first); }
    setStatus('Ready. Choose an example or paste an intent, then build.');
    if (params.get('run') === '1') build();
  } catch (error) { setStatus(error.message, 'blocked'); }
}

$('example-select').addEventListener('change', event => loadExample(event.target.value));
$('build').addEventListener('click', build);
$('cancel-build').addEventListener('click', () => { finishWorker(); setStatus('Build cancelled. Your intent is unchanged.'); });
$('build-size').addEventListener('change', () => invalidate());
intentInput.addEventListener('input', () => { invalidate(); $('example-select').value = ''; try { showComponents(JSON.parse(intentInput.value)); } catch { $('component-list').replaceChildren(); } });
$('interpretation-provider').addEventListener('change', updateProvider);
$('interpret').addEventListener('click', interpret);
$('cancel-interpretation').addEventListener('click', () => interpretation?.abort());
$('download-request').addEventListener('click', () => { try { download('brickforge-interpretation-request.json', JSON.stringify(buildIntentRequest(description.value, schema), null, 2)); } catch (error) { $('provider-status').textContent = error.message; } });
$('export-intent').addEventListener('click', () => { try { const intent = JSON.parse(intentInput.value); download((intent.name || 'object').toLowerCase().replace(/\W+/g, '-') + '.intent.json', JSON.stringify(intent, null, 2)); } catch (error) { setStatus(error.message, 'blocked'); } });
$('import-intent').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 262144) throw new Error('Intent exceeds the 256 KiB import limit.'); intentInput.value = JSON.stringify(JSON.parse(await file.text()), null, 2); $('example-select').value = ''; showComponents(JSON.parse(intentInput.value)); invalidate('Intent imported. Build to see the model.'); }
  catch (error) { setStatus(error.message, 'blocked'); }
  event.target.value = '';
});
for (const [id, view] of [['view-iso', 'iso'], ['view-top', 'top'], ['view-front', 'front'], ['view-fit', 'iso']]) $(id).addEventListener('click', () => viewer?.fit(view));
$('course-slider').addEventListener('input', event => { const n = Number(event.target.value); viewer?.step(null); viewer?.course(n); $('course-value').textContent = `${n}/${event.target.max}`; });
$('step-slider').addEventListener('input', event => {
  if (!result) return;
  const count = Number(event.target.value), steps = result.instructions.steps, step = steps[count - 1];
  viewer?.course(Number($('course-slider').max)); viewer?.step(steps.slice(0, count).flatMap(s => s.parts));
  $('step-value').textContent = `${count}/${steps.length}`;
  const byId = new Map(result.parts.map(p => [p.instance_id, p])), names = new Map();
  for (const id of step.parts) { const p = byId.get(id), key = `${p.part_id} ${colourByCode.get(p.colour_code)?.name || p.colour_code}`; names.set(key, (names.get(key) || 0) + 1); }
  $('step-detail').textContent = `Step ${count}: ${[...names].map(([k, n]) => `${n}× ${k}`).join(', ')} · ${step.title}${step.support_guidance?.status === 'hold_recommended' ? ' · hold this stage while building' : ''}.`;
});
$('download-ldraw').addEventListener('click', () => result && download(result.design_id + '.ldr', result.ldraw, 'text/plain'));
$('download-csv').addEventListener('click', () => result && download(result.design_id + '.parts.csv', inventoryCsv(buildInventory(result)), 'text/csv'));
$('download-report').addEventListener('click', () => result && download(result.design_id + '.report.json', JSON.stringify({...result, ldraw: undefined}, null, 2)));
$('cancel-pdf').addEventListener('click', () => { stopPdf(); setStatus('Booklet export cancelled.', 'planned'); });
$('download-pdf').addEventListener('click', () => {
  if (!result || pdfWorker) return;
  const plan = result;
  $('download-pdf').disabled = true; $('cancel-pdf').hidden = false;
  setStatus('Preparing the illustrated instruction booklet…', 'exporting');
  const job = new Worker(new URL('./instruction-pdf-worker.js?v=9b8d8e12b3f3', import.meta.url), {type: 'module'});
  pdfWorker = job;
  job.onmessage = ({data}) => {
    if (job !== pdfWorker) return;
    if (data.page) { setStatus(`Rendering booklet · page ${data.page} of ${data.total}`, 'exporting'); return; }
    stopPdf();
    if (data.error) { setStatus(data.error, 'export-error'); return; }
    download(plan.design_id + '.instructions.pdf', data.bytes, 'application/pdf');
    setStatus('Instruction booklet downloaded.', 'planned');
  };
  job.onerror = event => { if (job !== pdfWorker) return; stopPdf(); setStatus('Booklet export failed. ' + event.message, 'export-error'); };
  const used = new Set(plan.parts.map(p => p.part_id));
  const profiles = displayCatalogue.profiles.filter(p => used.has(p.part_id));
  const {status: state, design_id, parts, instructions, bom, dimensions_mm, component_reports} = plan;
  job.postMessage({plan: {status: state, design_id, parts, instructions, bom, dimensions_mm, component_reports}, profiles,
    spec: {name: plan.name, components: plan.intent.components.map(c => ({id: c.id, label: c.label}))}});
});
initialise();
updateProvider();
