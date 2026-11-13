# Parts data sources and licensing notes

**Research checked:** 13 November 2026

## 1. LDraw.org Parts Library — primary geometry candidate

The official LDraw.org Library is the first geometry source to integrate. Its October 2026 update page reports 17,230 unique shapes or patterned parts. The complete archive is available at:

- Library: https://library.ldraw.org/
- Latest updates: https://library.ldraw.org/updates
- Complete archive: https://library.ldraw.org/library/updates/complete.zip
- Documentation: https://library.ldraw.org/documentation

The library is made by community contributors. The Parts Library Policies state that contributors choose CC BY 4.0 or CC0 for their parts; older entries may have earlier licence notices. Therefore:

- Preserve original part headers and attribution.
- Keep licence/readme files alongside any local library copy.
- Inspect the `!LICENSE` metadata and source file headers rather than assuming one licence applies to every part.
- Keep downloaded parts outside Git history; only application code and small, specifically licensed test fixtures should live in this repository.
- Do not use third-party CAD/3D sources to create or submit replacement LDraw parts. LDraw.org's source policy explicitly restricts the sources from which community parts may be authored.

## 2. Verbatim LDraw regression fixture

A small, unchanged test fixture is kept at
`tests/fixtures/ldraw/brick-3001/`. It contains the 3001 (2 × 4 brick) root
part, its nested sub-part and the referenced primitive files required to resolve
that part. The original file headers, contributor names, per-file CC BY 4.0
notices, `CAreadme.txt` and `CAlicense4.txt` are preserved. The source file
headers identify James Jessiman as the author of most files and Niels Karsdorp
for `box3u2p.dat`.

This is a focused resolver regression fixture, not a complete LDraw release
snapshot. It is included so CI can exercise recursive library expansion without
downloading the full archive on every push. The complete-library validation is
still a separate milestone.

## 3. Browser preview and public mirror

The public [Part explorer](https://descalzi.github.io/brickforge/parts.html) currently previews eleven standard bricks (3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010 and 3622) and two plates (3020 and 3021). At runtime it fetches the individual text files and the colour configuration from the public GitHub mirror at:

- Mirror repository: https://github.com/erik-larsen/ldraw
- Individual part files: https://raw.githubusercontent.com/erik-larsen/ldraw/main/parts/3001.dat
- Colour table: https://raw.githubusercontent.com/erik-larsen/ldraw/main/LDConfig.ldr
- Mirror licence notes: https://raw.githubusercontent.com/erik-larsen/ldraw/main/CAreadme.txt

The mirror's README describes its contents as a copy of the LDraw Parts Library archive, including `parts/`, `p/` and `LDConfig.ldr`. It is a convenience source for this browser proof of concept, not the authoritative or version-pinned library source. Its contents may lag the official LDraw release page. The reproducible local-library workflow remains `scripts/fetch_ldraw_library.py` against the official LDraw `complete.zip` URL above.

The viewer collects `AUTHOR` and `!LICENSE` notices from the files it expands and exposes the original root file. The source file's own notice governs; the viewer must not assume that one licence applies to every dependency. Before using a different part or redistributing part data, inspect all participating headers and the applicable agreement.

## 4. Connection metadata — open question

LDraw part files provide geometry and model references, but geometry alone is not a complete physical connection model.

BrickLink Studio's official FAQ says Studio parts have separate `.conn` connection-information files (and that its installation contains a connectivity directory). Studio also provides snapping, connectivity checks and stability checks.

That is valuable evidence about the data we need, but it does **not** establish that Studio's connection files may be redistributed or incorporated into BrickForge. Do not copy Studio data into this repository until its licence and terms have been independently confirmed.

Initial plan:
1. Define a BrickForge-owned, documented connection schema.
2. Author connection metadata for a small set of ordinary parts.
3. Write compatibility and placement tests for each connection type.
4. Keep source/provenance and licence fields on every imported or authored record.
5. Revisit compatible external connection datasets only after licence review.

## 3. Suggested first part family

Begin with a deliberately small, useful set:
- Standard bricks and plates.
- Common tiles.
- A small number of slopes.

Expand to Technic, clips, bars, hinges, flex parts and other specialised connection families only after the basic connection model is reliable.

## 5. Legal and product wording

BrickForge is an independent project. LDraw is a community CAD standard and a trademark of the Estate of James Jessiman.

This document is engineering research, not legal advice. Review the applicable licence for each data source and part before distributing derivative assets or enabling user downloads.

## References

- LDraw Library: https://library.ldraw.org/
- LDraw Parts Library Policies and FAQ: https://library.ldraw.org/documentation/policies-and-procedures/parts-library-policies-and-faq
- LDraw legal information: https://ldraw.org/docs-main/licenses/legal-info.html
- BrickLink Studio FAQ: https://www.bricklink.com/v3/announcement/ldd_faq.page
- BrickLink Studio connectivity help: https://studiohelp.bricklink.com/hc/en-us/articles/5412087360919-Snap
