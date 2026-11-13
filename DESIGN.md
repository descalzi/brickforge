---
name: BrickForge
description: Geometry becomes a buildable brick construction.
colors:
  bg: "#F2F4F6"
  surface: "#FFFFFF"
  surface-2: "#E8EDF1"
  border: "#D2D9E0"
  border-strong: "#5E6A75"
  fg: "#0C1218"
  fg-muted: "#4F5D6B"
  accent: "#C73E0A"
  on-accent: "#FFFFFF"
  ok: "#13795B"
  warn: "#9A6200"
  crit: "#C22B35"
typography:
  display:
    fontFamily: "Archivo, Arial, sans-serif"
    fontSize: "clamp(3rem, 6vw + 1rem, 6rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  body:
    fontFamily: "Archivo, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
rounded:
  small: "3px"
  medium: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "32px"
  xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.small}"
    padding: "14px 20px"
---

# Design System: BrickForge

## Overview

**Creative North Star: The Construction Drawing.**

Source style: DESIGN-LIBRARY.md §10.3 Infrastructure, palette I1 Blueprint & Safety Orange (light-led). BrickForge should feel like a precise engineering instrument, not a generic AI toy. Its visual language comes from technical drawings, measured grids, real part geometry and the tactile clarity of brick assemblies.

**Signature move:** a shape-to-stud transition: a target mesh, its decomposition into candidate placements, and the corresponding brick assembly shown as one continuous technical illustration.

**Key characteristics:** engineered precision; warm, purposeful safety-orange signals; clear technical diagrams; restrained surfaces; approachable language.

## Colors

Use the Blueprint & Safety Orange palette from the supplied Design Library. Paper-like blue-grey is the canvas, white is the working surface, ink is the text, and international orange is reserved for action, selection and critical construction signals. Semantic colours are never used as decoration.

## Typography

Archivo is the display and UI family; use 400–700 weights. IBM Plex Mono is reserved for measurements, file formats, part identifiers and code. Body copy is 16–17 px minimum with generous line-height. Sentence case throughout.

## Layout

Use a responsive 12-column grid on wide screens, with a content width around 1280 px and 16 px mobile gutters. Use a 4 px spacing base. Let whitespace and alignment create groups; use borders only where a real structural boundary is useful.

## Elevation & Depth

Flat technical surfaces with subtle tonal separation. Shadows are reserved for overlays and menus. Use a faint measurement grid as a construction reference, not as wallpaper.

## Shapes

Use crisp 3–6 px radii for controls only. Diagram geometry should remain geometric. Use consistent 1 px rules and stronger contrast for control boundaries.

## Components

Navigation must read as navigation. Buttons must name their action and have clear hover, active, disabled and focus-visible states. Inputs require visible labels. Technical illustrations must be authored SVG with labelled parts and meaningful alternative text. Every visual state must also be understandable without colour.

## Do's and Don'ts

- Do show the model-making mechanism in the first viewport.
- Do distinguish demonstrated functionality from the roadmap.
- Do use accurate units, dimensions and part identifiers.
- Don't use generic icon-card feature grids, glowing edges, gradient text or fake terminal decoration.
- Don't use emoji as icons.
- Don't imply buildability or strength has been proven before the relevant validation exists.
