# E2E tests (Playwright) — TICKETERA frontend

End-to-end tests for the `platea/` Next.js app, written with `@playwright/test`.

## Prerequisites

1. **Install deps** (once, after pulling these changes):

   ```bash
   cd platea
   npm install
   npx playwright install   # downloads the browser binaries (Chromium, etc.)
   ```

2. **Bring the app up FIRST.** Playwright does NOT start the server itself — it
   expects the frontend already running on `http://localhost:3000`. Use the
   project's `dev-up` script (frontend + the backend it depends on):

   ```bash
   dev-up        # however the project documents it
   ```

   Confirm http://localhost:3000 loads in a browser before running tests.

   > If you prefer Playwright to manage the server, uncomment the `webServer`
   > block in `platea/playwright.config.ts`.

## Run the tests

```bash
cd platea
npm run test:e2e            # headless, all projects (desktop + mobile)
npm run test:e2e:ui        # interactive UI mode (great for debugging)
npm run test:e2e:report    # open the last HTML report
```

Target a non-default host/port:

```bash
E2E_BASE_URL=http://localhost:3001 npm run test:e2e
```

Run a single project or file:

```bash
npx playwright test --project=chromium-desktop
npx playwright test e2e/smoke.spec.ts
```

Artifacts (screenshots/video/trace) for failures land in `playwright-report/`
and `test-results/`. Screenshots are captured `only-on-failure`.

## What's covered today

- `smoke.spec.ts` — **no login required**. Verifies the two public surfaces
  render their key elements and don't throw a fatal runtime error:
  - `/login` (empresa "Panel de empresas"): heading, email/password fields,
    submit button, login/registro tabs.
  - `/` (public landing): navbar brand + `#main-content` landmark.

  Fatal = uncaught page exception (`pageerror`). Plain `console.error` lines are
  collected and printed for triage but don't fail the run (Next dev is noisy).

## ⚠️ Authenticated flows are NOT covered yet (POS, dashboard, etc.)

The entire **dashboard** — including **POS Entradas** (`/dashboard/entradas`)
and **POS Barra** (`/dashboard/consumibles/...`) — sits behind login. Auth is
NextAuth with **four separate user types and login flows**
(`empresa`, `empleado` with RBAC roles, `comprador`, `super_admin`). The POS is
operated by `empresa`/`empleado` users (roles like `vendedor`, `barra`).

To test those flows we need a **dedicated test login + seed data** that does NOT
mutate production. None of that exists yet, and no credentials are hardcoded
here on purpose. What's needed before writing authenticated E2E:

1. **A seeded test tenant + test users** in a non-prod DB (e.g. an `empresa`
   admin and an `empleado` with `vendedor`/`barra` roles), created by a seed
   script — never against the prod Supabase DB.
2. **Test credentials supplied via env vars**, e.g. `E2E_EMPRESA_EMAIL` /
   `E2E_EMPRESA_PASSWORD` (and equivalents for an `empleado`). Do NOT commit
   credentials; read them from the environment / a local `.env` ignored by git.
3. **A Playwright auth fixture** that logs in once and reuses
   [storage state](https://playwright.dev/docs/auth) (`storageState`) so each
   authenticated test starts already signed in. Likely as a separate project
   (e.g. `authenticated-desktop`) depending on a `global.setup.ts`.
4. **Read-only assertions by default.** For the POS, prefer asserting render +
   states (loading / empty / disabled / error) over completing real sales.
   Any test that issues tickets or sells consumables MUST run against the test
   DB only — selling mutates stock (`entrada_categorias.stock_disponible`,
   `barra_stock.stock_actual`) and writes `entradas` / `consumibles_ventas`.

Until 1–3 exist, keep authenticated specs out of the default run.
