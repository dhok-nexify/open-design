# Vendored offline assets (`/vendor/*`)

Generated artifacts and previews must not reach an external CDN (DESIGN §13.3). Every asset those
surfaces may reference is checked into this folder and listed in
`apps/daemon/src/vendor/manifest.ts`; the daemon serves it at `/vendor/<package>/<file>` with
`Cache-Control: immutable` and a SHA-256 integrity check. A path that is not in the manifest is
never read from disk.

## What ships

| URL | Source | License |
|---|---|---|
| `/vendor/react@18.3.1/umd/react.development.js` | react@18.3.1 (npm) | MIT (`react@18.3.1/LICENSE`) |
| `/vendor/react-dom@18.3.1/umd/react-dom.development.js` | react-dom@18.3.1 (npm) | MIT (`react-dom@18.3.1/LICENSE`) |
| `/vendor/@babel/standalone@7.29.0/babel.min.js` | unpkg @babel/standalone@7.29.0 | MIT (`@babel/standalone@7.29.0/LICENSE`) |
| `/vendor/framer-motion@11.11.13/dist/framer-motion.js` | unpkg framer-motion@11.11.13 | MIT (`framer-motion@11.11.13/LICENSE.md`) |
| `/vendor/tailwindcss@3.4.17/play-cdn.js` | cdn.tailwindcss.com/3.4.17 | MIT (`tailwindcss@3.4.17/LICENSE`) |
| `/vendor/fonts@1.0.0/fonts.css` | local() font map (no webfont bytes) | — |
| `/vendor/gsap@3.14.2/dist/gsap.min.js` | gsap@3.14.2 (npm) | GSAP standard license |
| `/vendor/chart.js@{4.4.0,4.4.3,4.4.7}/dist/chart.umd.min.js` | chart.js (npm) | MIT |
| `/vendor/highlight.js@11.10.0/...` | highlight.js@11.10.0 (npm) | BSD-3-Clause |
| `/vendor/lucide@1.68.0/dist/umd/lucide.min.js` | lucide@1.68.0 (npm) | ISC |

The React builds were copied from the workspace's own `react@18.3.1` / `react-dom@18.3.1`
installations, so the bytes match the versions the web app already runs. Babel and framer-motion
were downloaded from the pinned unpkg URLs. The framer-motion license text was taken from the
workspace's `framer-motion@12.40.0` package because the v11 tarball publishes `LICENSE.md`
rather than `LICENSE`; the MIT text and copyright holder are the same.

`fonts.css` deliberately uses `local()` sources only: it maps every whitelist family to a
host-installed face and cannot start a network request. To upgrade to pinned webfonts, add a
`url('/vendor/fonts@1.0.0/<file>.woff2')` source ahead of the `local()` list and register the
file in the manifest.

The bundled skills and design templates reference these URLs directly; `rewriteSkillAssetUrls`
also rewrites any residual CDN URL when `OD_EDITION=nextore`, as defence in depth. Add new assets
only by checking the bytes in, adding a `VENDOR_ASSETS` entry (byte length + lower-case SHA-256),
and adding the path to the `scripts/guard.ts` vendor allowlist. `vendor-routes.test.ts` fails when
the manifest and the files on disk disagree.

## Why an allowlist instead of `express.static`

`express.static` would make the whole folder — and anything a future contributor drops into it —
reachable, and would serve a tampered checkout silently. The manifest keeps the URL surface to
exactly what the prompts reference, and the hash turns a bad checkout into a visible 503.
