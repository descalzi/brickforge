# Publishing the project page

The project site and browser application live in `/docs`; they require no application server or build step. JavaScript modules and static JSON data are served directly by the Pages host.

## Enable GitHub Pages

1. Open the repository: https://github.com/descalzi/brickforge
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select branch **main** and folder **/docs**.
5. Save. GitHub will publish the page after its Pages deployment completes.

The expected project URL is:

`https://descalzi.github.io/brickforge/`

The first deployment may take a short while. Confirm the URL in the Pages settings before sharing it.

## Important: repository visibility and site visibility

GitHub Pages websites are publicly available on the internet, even when their source repository is private. GitHub's plan rules also apply: Pages is available from public repositories on GitHub Free; publishing from a private repository requires GitHub Pro, Team or Enterprise.

This is intentional for the project page: it can be public while the code repository remains private, provided the account plan supports private-repository Pages. Do not place secrets, credentials, private test meshes or unreleased proprietary data in `/docs`.

## Updating the site

Every commit to `main` that changes files in `/docs` is automatically published after Pages is enabled. The Block builder runs the constrained placement and validation engine in the visitor's browser; the host serves static assets only. It does not require an API, database, account or model upload. Keep large inputs and generated model data on the client unless a future measured requirement justifies remote processing. Do not present conceptual illustrations as generated output.


## Browser processing boundary

The browser builder fetches the published connection-profile catalogue from
`/data/connection-profiles/basic-bricks.json`. Geometry placement, nominal
connection matching, conservative body-envelope checks, graph connectivity,
3D preview creation and download serialisation happen in the visitor's
browser. There is no construction endpoint to configure or deploy.

Three.js and OrbitControls are currently imported from the jsDelivr CDN. The
application therefore needs internet access for the initial page load and
module downloads; the project does not yet bundle these dependencies locally.
