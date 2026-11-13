# Publishing the project page

The static project site lives in `/docs`; it requires no framework or build step.

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

Every commit to `main` that changes files in `/docs` is automatically published after Pages is enabled. Keep the page static until an actual interactive builder exists; do not present conceptual illustrations as generated output.
