// Shared LDraw colour palette for the intent contract, viewers and PDF booklets.
// Names are what an interpreter writes; codes are LDraw colour numbers.
// Hex values approximate LDConfig colours for on-screen previews only.
export const BRICK_COLOURS = Object.freeze([
  {code: 0, name: 'black', hex: '#1b2a34'},
  {code: 15, name: 'white', hex: '#f4f4f4'},
  {code: 4, name: 'red', hex: '#b40000'},
  {code: 320, name: 'dark red', hex: '#720012'},
  {code: 1, name: 'blue', hex: '#1e5aa8'},
  {code: 272, name: 'dark blue', hex: '#19325a'},
  {code: 73, name: 'medium blue', hex: '#7396c8'},
  {code: 321, name: 'dark azure', hex: '#469bc3'},
  {code: 322, name: 'medium azure', hex: '#68c3e2'},
  {code: 379, name: 'sand blue', hex: '#70819a'},
  {code: 14, name: 'yellow', hex: '#f2cd37'},
  {code: 226, name: 'bright light yellow', hex: '#fff03a'},
  {code: 191, name: 'bright light orange', hex: '#f8bb3d'},
  {code: 25, name: 'orange', hex: '#d66b24'},
  {code: 484, name: 'dark orange', hex: '#91501c'},
  {code: 2, name: 'green', hex: '#00852b'},
  {code: 10, name: 'bright green', hex: '#58ab41'},
  {code: 27, name: 'lime', hex: '#a5ca18'},
  {code: 288, name: 'dark green', hex: '#184632'},
  {code: 378, name: 'sand green', hex: '#708e7c'},
  {code: 19, name: 'tan', hex: '#e4cd9e'},
  {code: 28, name: 'dark tan', hex: '#958a73'},
  {code: 70, name: 'reddish brown', hex: '#5f3109'},
  {code: 78, name: 'light nougat', hex: '#f6d7b3'},
  {code: 84, name: 'medium nougat', hex: '#aa7d55'},
  {code: 71, name: 'light grey', hex: '#a0a5a9'},
  {code: 72, name: 'dark grey', hex: '#6c6e68'},
  {code: 7, name: 'old light grey', hex: '#8a928d'},
  {code: 29, name: 'pink', hex: '#e4adc8'},
  {code: 26, name: 'magenta', hex: '#923978'},
  {code: 85, name: 'purple', hex: '#5f2683'},
  {code: 179, name: 'silver', hex: '#898788'},
  {code: 297, name: 'gold', hex: '#aa7f2e'},
  {code: 47, name: 'trans clear', hex: '#e8f2f6', transparent: true},
  {code: 43, name: 'trans light blue', hex: '#aee9ef', transparent: true},
  {code: 33, name: 'trans blue', hex: '#2a5bd0', transparent: true},
  {code: 36, name: 'trans red', hex: '#c91a09', transparent: true},
  {code: 57, name: 'trans orange', hex: '#f08f1c', transparent: true},
  {code: 46, name: 'trans yellow', hex: '#f5cd2f', transparent: true},
  {code: 34, name: 'trans green', hex: '#237841', transparent: true},
  {code: 40, name: 'trans black', hex: '#635f52', transparent: true},
]);

const SYNONYMS = new Map([
  ['grey', 71], ['gray', 71], ['light gray', 71], ['light bluish grey', 71], ['medium stone grey', 71],
  ['dark gray', 72], ['dark bluish grey', 72], ['dark stone grey', 72],
  ['brown', 70], ['dark brown', 70], ['beige', 19], ['sand', 19], ['cream', 19],
  ['navy', 272], ['sky blue', 322], ['light blue', 73], ['teal', 321],
  ['dark pink', 26], ['violet', 85], ['skin', 78], ['flesh', 78],
  ['glass', 47], ['clear', 47], ['transparent', 47], ['trans-clear', 47], ['trans clear blue', 43],
  ['metal', 179], ['metallic silver', 179], ['steel', 179], ['olive', 378],
  ['ivory', 19], ['bone', 19], ['off white', 15], ['eggshell', 19], ['khaki', 28], ['stone', 71], ['concrete', 71], ['slate', 72], ['charcoal', 72],
  ['maroon', 320], ['burgundy', 320], ['crimson', 4], ['scarlet', 4], ['brick', 320], ['rust', 484], ['copper', 484], ['bronze', 297], ['brass', 297],
  ['salmon', 29], ['coral', 25], ['peach', 78], ['rose', 29], ['lavender', 85], ['lilac', 85], ['mauve', 26], ['plum', 85],
  ['turquoise', 322], ['cyan', 322], ['aqua', 322], ['azure', 321], ['royal blue', 1], ['cobalt', 1], ['midnight blue', 272],
  ['forest green', 288], ['emerald', 2], ['mint', 378], ['sage', 378], ['moss', 378], ['chartreuse', 27], ['lime green', 27],
  ['mustard', 191], ['amber', 191], ['gold yellow', 191], ['lemon', 226], ['chocolate', 70], ['wood', 70], ['wooden', 70], ['caramel', 84],
  ['sand', 19], ['straw', 19], ['honey', 191], ['tawny', 84], ['ginger', 25], ['ash', 71], ['smoke', 72], ['silver grey', 71],
]);
const KEYWORDS = [['pink', 29], ['purple', 85], ['violet', 85], ['blue', 1], ['green', 2], ['red', 4], ['orange', 25], ['yellow', 14], ['brown', 70],
  ['grey', 71], ['gray', 71], ['white', 15], ['black', 0], ['tan', 19], ['beige', 19], ['cream', 19], ['ivory', 19], ['gold', 297], ['silver', 179]];

export const colourByCode = new Map(BRICK_COLOURS.map(c => [c.code, c]));
export const colourHex = new Map(BRICK_COLOURS.map(c => [c.code, c.hex]));

/** Resolve a name, synonym or LDraw code. Returns null when unknown. */
export function resolveColour(value) {
  if (Number.isInteger(value)) return colourByCode.has(value) ? value : null;
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const named = BRICK_COLOURS.find(c => c.name === key);
  if (named) return named.code;
  if (SYNONYMS.has(key)) return SYNONYMS.get(key);
  const trans = key.startsWith('transparent ') ? 'trans ' + key.slice(12) : null;
  if (trans) return BRICK_COLOURS.find(c => c.name === trans)?.code ?? null;
  return null;
}

/** Nearest palette colour for a name outside the palette ("dusty pink" → pink). */
export function closestColour(value) {
  const exact = resolveColour(value);
  if (exact !== null || typeof value !== 'string') return exact;
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const glass = /\b(trans|transparent|glass|clear|translucent)\b/.test(key);
  if (glass) return /blue/.test(key) ? 43 : /red/.test(key) ? 36 : /yellow|amber/.test(key) ? 46 : /green/.test(key) ? 34 : /orange/.test(key) ? 57 : 47;
  const words = key.split(' ');
  for (let n = words.length - 1; n >= 0; n--) { const tail = words.slice(n).join(' '); const hit = resolveColour(tail); if (hit !== null) return /\b(dark|deep)\b/.test(key) && hit === 71 ? 72 : hit; }
  for (const [word, code] of KEYWORDS) if (key.includes(word)) return /\b(dark|deep)\b/.test(key) && code === 71 ? 72 : code;
  return null;
}

export const isTransparent = code => Boolean(colourByCode.get(code)?.transparent);
