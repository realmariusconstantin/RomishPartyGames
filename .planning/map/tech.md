# Technology Stack

**Analysis Date:** 2026-03-06

---

## Languages

- **TypeScript 5.x** — all source files (`.ts`, `.tsx`); strict mode enabled, ES2017 target
- **JavaScript** — interop allowed via `allowJs: true` in tsconfig

## Runtime

- **Node.js v22.20.0**
- **Package manager:** npm (`package-lock.json` present, no yarn/pnpm lockfile)

## Frameworks

- **Next.js 16.1.6** — full-stack React framework; App Router (inferred from `app/` directory); Turbopack experimental config in `next.config.ts`
- **React 19.2.3** / **react-dom 19.2.3** — UI rendering
- **Express 5.2.1** — custom HTTP server wrapping Next.js; entry point `server.ts`

## Real-Time Layer

- **Socket.IO 4.8.3** (`socket.io` server + `socket.io-client`) — WebSocket-based real-time communication; server mounted alongside Express/Next.js in `server.ts`; typed via `ClientToServerEvents` / `ServerToClientEvents` interfaces in `lib/types.ts`

## Styling

- **Tailwind CSS 4** — utility-first CSS
- **PostCSS** — via `@tailwindcss/postcss` plugin (`postcss.config.mjs`)

## UI Libraries

- **lucide-react 0.563.0** — icon set
- **sonner 2.0.7** — toast notifications

## Build & Dev Tooling

| Tool | Version | Purpose |
|------|---------|---------|
| `next build` | 16.1.6 | Production build (Turbopack) |
| `tsx` | 4.21.0 | Runs/watches `server.ts` in dev (`tsx watch server.ts`) |
| `ts-node` | 10.9.2 | TypeScript execution (available, tsx preferred) |
| `cross-env` | 10.1.0 | Cross-platform env var injection (`NODE_ENV=production`) |
| `nodemon` | 3.1.11 | Listed as devDependency; not used in current scripts |

**Dev command:** `npm run dev` → `tsx watch server.ts` (starts custom Express+Socket.IO+Next.js server)
**Production command:** `npm start` → `cross-env NODE_ENV=production tsx server.ts`

## Test Runners

### Unit / Component Tests — Vitest 4.0.18
- Config: `vitest.config.ts`
- Environment: `jsdom` (via `jsdom 28.0.0`)
- Setup file: `vitest.setup.ts`
- Scope: `lib/**/*.test.ts`, `hooks/**/*.test.ts`, `context/**/*.test.ts`
- React support: `@vitejs/plugin-react 5.1.4`
- Testing Library: `@testing-library/react 16.3.2`, `@testing-library/user-event 14.6.1`, `@testing-library/jest-dom 6.9.1`
- Path alias: `@/` → project root

### E2E Tests — Playwright 1.58.2
- Config: `playwright.config.ts`
- Test dir: `e2e/`
- Browser: Chromium only (Desktop Chrome)
- Base URL: `http://localhost:3000`
- Parallelism: disabled (`fullyParallel: false`, `workers: 1`)
- CI: 2 retries; dev: 0 retries; reuses existing server in dev
- Reports: HTML (`playwright-report/`)

**Run commands:**
```bash
npm run test:unit    # vitest run
npm run test:e2e     # playwright test
npm run test         # both in sequence
npm run test:ui      # vitest --ui (interactive)
```

## Linting

- **ESLint 9** (`eslint.config.mjs`)
- Extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Ignores: `.next/`, `out/`, `build/`, `next-env.d.ts`

## TypeScript Configuration

- Target: `ES2017`; module: `esnext`; moduleResolution: `bundler`
- `strict: true`, `noEmit: true`, `isolatedModules: true`
- Path alias: `@/*` → `./*` (root)
- Next.js TypeScript plugin enabled

## Infrastructure / Deployment

- **Vercel** — `.vercel` directory is gitignored, indicating Vercel deployment target
- No Dockerfile, docker-compose, or CI pipeline files detected in the workspace
- Environment variables: `.env*` files gitignored (secrets not committed)
- Production server: custom Node.js process (not serverless-compatible out of box due to Socket.IO); likely requires Vercel with custom server or alternative Node host

## Notable Patterns

- Custom server (`server.ts`) is required because Socket.IO needs a persistent WebSocket server — this means standard Vercel serverless deployment **will not work** without a workaround (e.g., Vercel with Edge/separate WS service)
- `tsx` used instead of `ts-node` for faster startup in dev/prod
- Turbopack enabled experimentally for Next.js builds
