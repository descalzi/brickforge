# Product: BrickForge

## Platform

Browser first. The hosted site is static; the visitor's browser runs the construction engine using local processing.

## Stack

Public site: static HTML, CSS and JavaScript in `/docs`, published with GitHub Pages (and portable to Cloudflare Pages). Construction engine: browser-native JavaScript modules. Three.js provides the 3D preview. Published JSON profiles provide the initial part connection data. Python, Trimesh and NumPy remain available for reference implementations, offline tooling and regression checks. The source repository is public; never commit secrets, credentials, or private user project data.

The end-user product runs on the visitor's computer. It does not require a construction server, Python installation, account or model upload. The static host serves application files and versioned data only.

## Users and scene

Primary user: a builder or designer who has an object in mind and wants a physically buildable construction made from genuine L-brick elements.

Physical scene: a desk with a computer for describing a model, inspecting a 3D preview, reviewing the parts inventory and following build instructions. Theme: light by default, with a carefully designed dark alternative if the application later needs it.

## What it does and why it's different

BrickForge aims to convert natural-language descriptions, reference images and 3D geometry into models made from real L-brick elements. It will validate physical connections and construction constraints, then derive the 3D model, bill of materials and step-by-step instructions from one canonical assembly. Its scope is any shape, not a fixed set of object categories. AI interprets intent; deterministic geometry, part and constraint systems perform and validate construction.

## Surfaces and modes

| Surface | Mode | Primary action |
|---|---|---|
| `/` (project page) | Persuade | Understand the project and follow its progress |
| `/builder.html` | Operate | Generate, inspect and export a constrained rectangular block |
| `/engineering` (planned) | Read | Understand the geometry, parts and validation approach |
| `/app` (future) | Operate | Refine arbitrary models and connect mesh input to construction |

## Real assets and facts

- Logo / brand assets: original wordmark and geometric mark authored for this project.
- Real proof: the repository contains the public mesh inspector, STL/OBJ mesh inspection, LDraw metadata and geometry parsers, and a recursive LDraw sub-file resolver. A browser-native rectangular block engine is now online, with local 3D preview, nominal connection and body-envelope checks, and LDraw/JSON downloads. Arbitrary mesh-to-model construction is not implemented yet.
- Part geometry source under evaluation: the LDraw.org Parts Library. Parts are authored by contributors and have per-author licensing and attribution requirements; retain headers and audit licences before redistribution.
- Connection metadata: not yet selected as a production source. BrickLink Studio uses separate connection files, but their reuse terms must be checked. Initial metadata may be authored in-house for a small, tested set of parts.
- Must not claim: that automatic L-brick construction, physical stability guarantees, instruction generation or purchasing are already implemented.

## Terminology

Use generic project terminology throughout user-facing pages, documentation, scripts and UI copy: **L-brick**, **brick**, **plate**, **element**, **block**, and **construction**. Do not use the name of the well-known third-party brick brand in project-authored copy. Keep original third-party source headers and licence notices unchanged.

## Brand commitments

- Product name: BrickForge.
- Creative direction: engineered precision with an approachable builder's spirit.
- Primary visual language: Infrastructure style, Blueprint & Safety Orange palette.
- Show real mechanisms and authored technical visuals rather than generic feature-card layouts.
- Distinguish implemented work from planned capabilities.

## Constraints

- Responsive, mobile-first, accessible semantic HTML.
- WCAG 2.2 AA contrast targets.
- Keyboard-operable controls, visible focus and reduced-motion support.
- Do not bundle large third-party part libraries into Git history.
- Preserve attribution and applicable licences for all third-party data and assets.

## Open decisions

- Approved source and format for part-connection metadata.
- Initial part subset and colour catalogue.
- Whether the eventual browser editor uses Three.js or another renderer.
- Which deployment and storage services should be used for the future application.