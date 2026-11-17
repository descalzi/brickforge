# Structured-brief engine benchmark

29 planned assemblies, 2 correctly refused negative controls, 4 original challenge gaps; 0 expectation regressions across 35 cases.

These are canonical studies and held-out parameter variants of supported families. They do not establish performance on unseen natural-language descriptions or physical buildability. Known gaps remain in the denominator and are not counted as successful construction.

| Brief | Scope | Outcome | Parts | Unassessed nominal approaches |
| --- | --- | --- | ---: | ---: |
| interlocked-structural-body | canonical_studio | planned | 4 | 0 |
| two-opening-wall | canonical_studio | planned | 8 | 0 |
| table | canonical_studio | planned | 12 | 0 |
| stepped-platform | canonical_studio | planned | 5 | 0 |
| open-courtyard | canonical_studio | planned | 15 | 0 |
| windowed-pavilion | canonical_studio | planned | 17 | 0 |
| sloped-canopy | canonical_studio | planned | 5 | 0 |
| small-road-car | canonical_studio | planned | 17 | 0 |
| tapered-aircraft | canonical_studio | planned | 4 | 0 |
| rounded-mushroom | canonical_studio | planned | 3 | 0 |
| doorway-wall | canonical_studio | planned | 16 | 0 |
| approximate-road-car | canonical_studio | planned | 17 | 0 |
| aligned-table | canonical_studio | planned | 12 | 0 |
| composed-pitched-roof | canonical_studio | planned | 7 | 0 |
| composed-roof-tunnel | canonical_studio | planned | 6 | 0 |
| stepped-rounded-body | canonical_studio | planned | 48 | 0 |
| joint-sized-platform | canonical_studio | planned | 2 | 0 |
| joint-height-platform | canonical_studio | planned | 5 | 0 |
| side-mounted-panel | canonical_studio | planned | 4 | 0 |
| shallow-canopy | canonical_studio | planned | 4 | 0 |
| curved-canopy | canonical_studio | planned | 3 | 0 |
| composed-curved-plinth | canonical_studio | planned | 2 | 0 |
| integrated-axle-car | canonical_studio | planned | 14 | 0 |
| benchmark-roof-depth24 | parametric_architecture | planned | 11 | 0 |
| benchmark-tunnel-depth24 | parametric_architecture | planned | 10 | 0 |
| benchmark-roof-depth8 | parametric_architecture | planned | 6 | 0 |
| benchmark-curve-width48 | parametric_curved_surface | planned | 4 | 0 |
| benchmark-side-panel-offset | parametric_side_joint | planned | 4 | 0 |
| benchmark-rounded32 | parametric_organic_approximation | planned | 22 | 0 |
| benchmark-wrong-panel-facing | negative_side_joint | blocked | 0 | — |
| benchmark-curve-forbidden | negative_feature_contract | blocked | 0 | — |
| challenge-car | original_challenge | Known gap: blocked | 0 | — |
| challenge-house | original_challenge | Known gap: blocked | 0 | — |
| challenge-aircraft | original_challenge | Known gap: blocked | 0 | — |
| challenge-organic-form | original_challenge | Known gap: blocked | 0 | — |

Full refusal reasons are retained in [the machine-readable report](data/design-benchmark-results-v1.json). Original challenge specifications are unchanged. Nominal sweep checks exclude studs, cavities, deformation and hand access. Physical clutch, insertion and stability remain unassessed.

Reproduce with `node scripts/benchmark_design_engine.mjs --check`; refresh reviewed coverage with `--write`. A newly passing original challenge must be explicitly promoted and reviewed.
