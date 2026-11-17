import {inflateSync} from 'node:zlib';

// Read only page content. Inflating every RGB diagram just to find a step label
// can retain hundreds of megabytes between consecutive browser downloads.
export function pdfContentStreams(bytes) {
  const buffer = Buffer.from(bytes);
  const source = buffer.toString('latin1');
  const pages = [...source.matchAll(/\/Contents (\d+) 0 R/g)];
  const objects = new Map([...source.matchAll(/^(\d+) 0 obj\n/gm)]
    .map(match => [match[1], match.index + match[0].length]));
  return pages.map(page => {
    const offset = objects.get(page[1]);
    if (offset === undefined) throw new Error('Missing PDF page content');
    const start = source.indexOf('\nstream\n', offset);
    const header = source.slice(offset, start);
    const length = Number(header.match(/\/Length (\d+)/)[1]);
    const raw = buffer.subarray(start + 8, start + 8 + length);
    return (header.includes('/FlateDecode') ? inflateSync(raw) : raw).toString('latin1');
  });
}
