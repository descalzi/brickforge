import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

import {
  decodeCataloguePayload,
  searchPartCatalogue,
} from '../docs/assets/catalogue-utils.js';

test('decodes a gzip-compressed catalogue payload', async () => {
  const source = JSON.stringify({ schema_version: 1, parts: [{ part_id: '3001' }] });
  const decoded = await decodeCataloguePayload(gzipSync(source));
  assert.equal(decoded, source);
});

test('accepts a transparently decompressed catalogue payload', async () => {
  const source = JSON.stringify({ schema_version: 1, parts: [] });
  const decoded = await decodeCataloguePayload(Buffer.from(source));
  assert.equal(decoded, source);
});

test('searches part IDs, descriptions, categories and keywords', () => {
  const parts = [
    { part_id: '3001', description: 'Brick 2 x 4', category: 'Brick' },
    { part_id: '3020', description: 'Plate 2 x 4', category: 'Plate', keywords: ['building'] },
    { part_id: '3622', description: 'Brick 1 x 3', category: 'Brick' },
  ];
  assert.deepEqual(
    searchPartCatalogue(parts, 'brick 2 x 4').map((part) => part.part_id),
    ['3001'],
  );
  assert.deepEqual(
    searchPartCatalogue(parts, 'building').map((part) => part.part_id),
    ['3020'],
  );
  assert.deepEqual(
    searchPartCatalogue(parts, '3622').map((part) => part.part_id),
    ['3622'],
  );
});

test('limits search results and returns no results for an empty query', () => {
  const parts = Array.from({ length: 10 }, (_, index) => ({
    part_id: String(index),
    description: 'Brick part',
  }));
  assert.equal(searchPartCatalogue(parts, 'brick', 3).length, 3);
  assert.deepEqual(searchPartCatalogue(parts, '   '), []);
});
