# Getting Started

## Requirements

- Node.js 22.14+ or 24
- pnpm 10.10.0
- A browser wallet with EIP-6963 support if you want to connect (MetaMask, Rabby, Coinbase Wallet and others)

No API key, database or server secret is needed.

## Install and run

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The dev server listens on http://localhost:5586 and on your LAN address. It serves the same `/api/terminal` and `/api/privacy` handlers that Vercel runs, and the circuit files from the installed SDK.

| Route | Page |
| --- | --- |
| `/` | Home, the flight through the gate |
| `/terminal` | Coin terminal; `/terminal/<contract>` opens one coin |
| `/privacy` | Private pool workspace |
| `/vault` | Local file vault |
| `/docs` | Product docs and risks |

Only build scripts for `esbuild` are allowed (`pnpm.onlyBuiltDependencies`). The privacy SDK runs in a browser worker with IndexedDB, so its optional native storage modules are not compiled.

## Checks

```sh
pnpm test     # node:test unit tests
pnpm build    # vite build into dist/
pnpm check    # Playwright browser checks against the running dev server
```

| Script | What it covers |
| --- | --- |
| `pnpm test` | Route calldata and V4 pool ids, privacy amount, recipient, approval, deposit and relay guards, pinned SDK artifact hashes, vault round trips and tamper detection |
| `pnpm check` | Five widths (1920, 1366, 768, 390, 320) on every route: layout overflow, fonts, the wordmark particles, the coin tape, the terminal with a stand-in wallet (connect, balance, Uniswap V3 and V4 buys with the exact calldata checked, nothing broadcast), the vault round trip, reduced motion and WebGL loss |
| `node scripts/privacy-check.mjs` | Privacy workspace flow with a mock wallet and worker; no funds |
| `node --import tsx scripts/privacy-proof-check.mjs` | A real proof from a fresh unfunded identity, cancelled before any wallet or relay submission |
| `node scripts/probe-routes.mjs` | Read-only probe of the buy routes for a handful of coins |
| `node scripts/shots.mjs` | Screenshots of every flight stop |

Set `BASE_URL` to run the browser checks against a deployment instead of localhost.

The browser checks use Playwright's Chromium. Install it with `pnpm exec playwright install chromium`; if a different build is already in the Playwright folder it is used, and `CHROME_PATH` overrides both.

## Deploy

The repository deploys to Vercel as is:

- Build command `pnpm build`, output `dist`
- `api/*.js` become functions with a 60 second limit
- Every other path rewrites to `index.html`
- Security headers: `nosniff`, strict referrer policy, no camera, microphone or location, no framing

See `vercel.json`. No environment variables are required.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "The terminal is cooling down" | The per-minute request budget for this instance is spent; wait a minute |
| A coin shows "No route" | No Uniswap or Pons pool against ETH or USDG was found for that contract |
| "A contract on the buy route changed" | A pinned code hash no longer matches; buys stay paused until the change is reviewed and the hash updated in `server/terminal.js` |
| The privacy workspace offers no action | `/api/privacy` could not verify the provider configuration or the pool contracts |
| Different private balance after unlock | A different wallet or signing method produced a different signature; use the original one |
