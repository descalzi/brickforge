export async function decodeCataloguePayload(payload) {
  const bytes = new Uint8Array(payload);
  if (bytes[0] === 0x1F && bytes[1] === 0x8B) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This browser does not support compressed catalogue loading.');
    }
    const decompressed = new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(decompressed).text();
  }
  // Some static hosts may transparently decode .gz responses.
  return new TextDecoder().decode(payload);
}

export function searchPartCatalogue(parts, query, limit = 100) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return parts.filter((part) => {
    const searchable = [
      part.part_id,
      part.name,
      part.description,
      part.category,
      ...(part.keywords || []),
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  }).slice(0, limit);
}


export function ldrawReferenceCandidates(filename, parentPath) {
  const name = filename.trim().replace(/\\/g, '/').toLowerCase();
  if (!name || name.startsWith('/') || name.split('/').some((part) => part === '..')) {
    throw new Error('Unsafe LDraw reference path: ' + filename);
  }
  if (name.startsWith('parts/') || name.startsWith('p/')) return [name];
  if (name.startsWith('s/')) return ['parts/' + name];
  if (name.startsWith('48/') || name.startsWith('8/')) return ['p/' + name];
  if (name.includes('/')) return ['parts/' + name, 'p/' + name];
  if (parentPath.startsWith('p/')) return ['p/' + name];
  // Bare references inside subparts conventionally name primitives.
  // Resolve them in p/ first to avoid a predictable 404 in parts/.
  if (parentPath.startsWith('parts/s/')) return ['p/' + name, 'parts/' + name];
  return ['parts/' + name, 'p/' + name];
}
