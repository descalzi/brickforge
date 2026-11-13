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

  return parts
    .map((part, index) => {
      const partId = String(part.part_id || '').toLocaleLowerCase();
      // The first LDraw header line is the human-readable part description.
      const displayName = String(part.description || '').toLocaleLowerCase();
      const filename = String(part.filename || part.name || '').toLocaleLowerCase();
      const category = String(part.category || '').toLocaleLowerCase();
      const keywords = (part.keywords || []).map((keyword) => String(keyword).toLocaleLowerCase());
      let score = 0;

      for (const term of terms) {
        const matches = [
          partId.includes(term),
          displayName.includes(term),
          filename.includes(term),
          category.includes(term),
          keywords.some((keyword) => keyword.includes(term)),
        ];
        if (!matches.some(Boolean)) return null;

        if (partId === term) score += 1000;
        else if (partId.startsWith(term)) score += 600;
        else if (partId.includes(term)) score += 350;

        if (displayName === term) score += 700;
        else if (displayName.startsWith(term)) score += 500;
        else if (displayName.includes(term)) score += 350;

        if (filename.includes(term)) score += 100;
        if (category.includes(term)) score += 120;
        if (keywords.some((keyword) => keyword.includes(term))) score += 80;
      }

      return { part, index, score };
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.part);
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
  if (parentPath.startsWith('parts/s/')) return ['p/' + name];
  return ['parts/' + name, 'p/' + name];
}
