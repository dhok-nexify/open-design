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

The React builds were copied from the workspace's own `react@18.3.1` / `react-dom@18.3.1`
installations, so the bytes match the versions the web app already runs.

## Still to vendor (D32, pending)

These are referenced by the prompts and preview builders and are not checked in yet:

| URL | Upstream |
|---|---|
| `/vendor/@babel/standalone@7.29.0/babel.min.js` | https://unpkg.com/@babel/standalone@7.29.0/babel.min.js |
| `/vendor/framer-motion@11.11.13/dist/framer-motion.js` | https://unpkg.com/framer-motion@11.11.13/dist/framer-motion.js |
| `/vendor/tailwindcss@3.4.17/tailwind-play.js` | https://cdn.tailwindcss.com/3.4.17 |
| `/vendor/fonts/...` | Google Fonts core whitelist (DESIGN §13.3) |

Fetch each with a 120-second timeout, copy the package LICENSE beside it, then add a
`VENDOR_ASSETS` entry with the file's byte length and lower-case SHA-256
(`Get-FileHash -Algorithm SHA256`, `sha256sum`, or `shasum -a 256`). `vendor-routes.test.ts`
fails when the manifest and the files on disk disagree.

## Why an allowlist instead of `express.static`

`express.static` would make the whole folder — and anything a future contributor drops into it —
reachable, and would serve a tampered checkout silently. The manifest keeps the URL surface to
exactly what the prompts reference, and the hash turns a bad checkout into a visible 503.
