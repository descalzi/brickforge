# Product: BrickForge

## Platform

Web first, with a Python geometry and construction engine behind it.

## Stack

Core engine: Python 3.11+, Trimesh and NumPy. Public project page: static HTML, CSS and vanilla JavaScript in `/docs`, published with GitHub Pages. The source repository is also public; never commit secrets, credentials, or private user project data.

The end-user product is browser-first. Python package installation and command-line entry points are developer tools for local validation; they are not a requirement or expected step for website users. The eventual web app must expose construction and export through the browser UI, backed by a hosted service or browser-compatible implementation.

## Users and scene

Primary user: a builder or designer who has an object in mind and wants a physically buildable construction made from genuine L-brick elements.

Physical scene: a desk with a computer for describing a model, inspecting a 3D preview, reviewing the parts inventory and following build instructions. Theme: light by default, with a carefully designed dark alternative if the application later needs it.

## What it does and why it's different

BrickForge aims to convert natural-language descriptions, reference images and 3D geometry into models made from real L-brick elements. It will validate physical connections and construction constraints, then derive the 3D model, bill of materials and step-by-step instructions from one canonical assembly. Its scope is any shape, not a fixed set of object categories. AI interprets intent; deterministic geometry, part and constraint systems perform and validate construction.

## Surfaces and modes

| Surface | Mode | Primary action |
|---|---|---|
| `/` (project page) | Persuade | Understand the project and follow its progress |
| `/engineering` (planned) | Read | Understand the geometry, parts and validation approach |
| `/app` (future) | Operate | Generate, inspect and refine a model |

## Real assets and facts

- Logo / brand assets: original wordmark and geometric mark authored for this project.
- Real proof: the repository contains the project specification, public mesh inspector, STL/OBJ mesh inspection, LDraw metadata and geometry parsers, and a recursive LDraw sub-file resolver with transform and inherited-colour handling. The construction engine is not implemented yet.
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
- - Preserve attribution and applicable licences for all third-party data and assets.

## Open decisions

- Approved source and format for part-connection metadata.
- Initial part subset and colour catalogue.
- Whether the eventual browser editor uses Three.js or another renderer.
- Which deployment and storage services should be used for the future application.