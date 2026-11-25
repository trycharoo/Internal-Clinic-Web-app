# Testing and delivery

The test suite covers the current browser demo, PostgreSQL integrity, the local development stack, and the built frontend artifact. Read the [SRS](SRS.md) for intended requirements and the distinction between implemented and planned behavior.

## Required testing policy

The root [AGENTS.md](../AGENTS.md) applies across the repository. Every new feature or behavior change must include meaningful unit tests, and every bug fix must include a regression test that fails without the fix. Cover relevant boundaries, invalid inputs, failures, and state transitions; add component/integration, browser, or PostgreSQL tests when the affected behavior requires them. Do not skip or weaken tests, assertions, coverage thresholds, or CI checks to make a change pass.

This document is the source of check commands and prerequisites. Documentation-only changes need documentation/diff checks, not runtime tests or placeholder test cases. Report unavailable checks as unverified, with the missing prerequisite.

## Run the checks

Use Node.js 22.22.2 or later in the Node 22 line, Node.js 24.15 or later in the Node 24 line, or Node.js 26+ with `pnpm` 12+, matching [`package.json`](../package.json) and [`apps/frontend/package.json`](../apps/frontend/package.json). Contributors using [`mise`](https://mise.jdx.dev/) can run `mise install` at the repository root (and inside `apps/doc-parser`) to match the CI-pinned Node.js, `pnpm`, `actionlint`, and Python 3.13 toolchain automatically. Docker tests require a running Docker engine and Docker Compose v2.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:coverage
pnpm --filter @clinic/frontend exec playwright install chromium
pnpm test:e2e
sh scripts/test-stack.sh
sh scripts/test-image.sh
pnpm test:api
actionlint -color
sh -n scripts/test-stack.sh scripts/test-image.sh apps/doc-parser/install-debian.sh
python3 -m pip install -r apps/doc-parser/requirements-dev.txt
python3 -m pytest apps/doc-parser/test_app.py
```

On Linux, install Chromium's operating-system dependencies with `pnpm --filter @clinic/frontend exec playwright install --with-deps chromium` when needed. The browser suite builds the application and starts a production preview on port 4173; that port must be available. It fails if another process is already serving the configured port.

For a shorter feedback loop from the repository root:

```sh
pnpm test:frontend
pnpm --filter @clinic/frontend test:watch
pnpm test:e2e -- --project=chromium
```

The image test accepts an optional image tag, for example `sh scripts/test-image.sh clinic-frontend:review`. It builds from the monorepo root using [`apps/frontend/Dockerfile`](../apps/frontend/Dockerfile) and serves a static frontend container, checking the delivered index/assets. The stack script uses a separate Compose project and disposable volumes, initializes PostgreSQL, runs SQL regression assertions, and checks the Redis/frontend services. Neither script should run against a real patient database.

## What each level verifies

| Level | Files | Evidence |
| --- | --- | --- |
| Unit | [`apps/frontend/src/clinic.test.ts`](../apps/frontend/src/clinic.test.ts), [`apps/frontend/src/demoLogin.test.ts`](../apps/frontend/src/demoLogin.test.ts), [`apps/frontend/src/workflow.test.ts`](../apps/frontend/src/workflow.test.ts) | Pure date, booking, stored-data, and queue rules, plus public demo-credential matching, email normalization, exact passwords, and role-mismatch rejection. `workflow.test.ts` covers walk-in registration and email validation, check-in validation and identity matching, ticket and chart numbering, queue states and row actions, encounter and prescription construction, appointment validation and calendar days, allergy reconciliation and the doctor's keep/remove review, intake status and closing times, check-in text limits, online booking availability (booked, passed, and not-open slots without names) and its rules (window, one booking per day, overlap, past times), storage validation for online-booking days, directory filtering, and parser response validation. |
| Component / integration | [`apps/frontend/src/login.test.tsx`](../apps/frontend/src/login.test.tsx), [`apps/frontend/src/chart.test.tsx`](../apps/frontend/src/chart.test.tsx), [`apps/frontend/src/booking.test.tsx`](../apps/frontend/src/booking.test.tsx), [`apps/frontend/src/queue.test.tsx`](../apps/frontend/src/queue.test.tsx) | User interactions with the actual React app split by domain: demo-credential matching and mismatch feedback, `/login` and role-view routing, in-memory-session boundaries, role-specific UI isolation, local hero-cover validation/replacement/reset, walk-in registration, patient directory search/filters/pagination/keyboard navigation, chart isolation, document upload limits/HTML-error handling/review, staff scheduling & calendar navigation, queue behavior, staff-confirmed allergy status, unknown sex selection, encounter note preservation, prescriptions, and browser storage. Setting or extending a closing time, ending or reopening the day, expired reception states, check-in reason and symptoms, and online booking (including date-clear guards) are covered too. Browser APIs can be mocked here. |
| Browser | [`apps/frontend/e2e/clinic-day.spec.ts`](../apps/frontend/e2e/clinic-day.spec.ts), [`apps/frontend/e2e/mobile.spec.ts`](../apps/frontend/e2e/mobile.spec.ts) | Desktop Chromium clinic-day journeys with synthetic patients and staff sign-ins (walk-in validation, SRS 1–10, allergy-removal review, document review/reload, QR rotation, lunch pause, wide desktop hero layout, and cover preview) plus focused mobile Chromium (`Pixel 7`) tests for responsive sign-in, mobile navigation drawer/chart, QR check-in, and online booking without horizontal overflow. [`apps/frontend/e2e/queue-lanes.spec.ts`](../apps/frontend/e2e/queue-lanes.spec.ts) covers priority/regular lanes, [`apps/frontend/e2e/manual-queue-entry.spec.ts`](../apps/frontend/e2e/manual-queue-entry.spec.ts) covers manual urgent/priority queue entry, [`apps/frontend/e2e/online-booking.spec.ts`](../apps/frontend/e2e/online-booking.spec.ts) covers online booking availability and limits, and [`apps/frontend/e2e/intake-session.spec.ts`](../apps/frontend/e2e/intake-session.spec.ts) covers clock-based intake expiry, ending/reopening the day, and check-in text handoff. Shared helpers are in [`apps/frontend/e2e/support.ts`](../apps/frontend/e2e/support.ts). |
| Database | [`apps/api/db/tests/regression.sql`](../apps/api/db/tests/regression.sql) | Real PostgreSQL 16 constraints, foreign keys, slot exclusions, timestamp consistency, and completed-visit/prescription aggregation. Test fixtures and helpers are rolled back. |
| Development stack | [`scripts/test-stack.sh`](../scripts/test-stack.sh) | Compose configuration, service startup, fresh database initialization/regressions, Redis, API health, and frontend + `/api` proxy HTTP responses. |
| Delivery artifact | [`scripts/test-image.sh`](../scripts/test-image.sh) | Production frontend image builds and serves its index and bundled assets. |
| Parser API | [`apps/doc-parser/test_app.py`](../apps/doc-parser/test_app.py) | Health (including unavailable Tesseract), API-key rejection, extension/upload-size errors, path-traversal filename sanitization, digital multi-page PDF extraction, encrypted/empty PDF rejection, decoded-image and PDF raster limits, image/scanned-page OCR, temp-file cleanup, and a real Tesseract/Poppler smoke check when installed (required in CI). |
| API proxy | [`apps/api/server.test.mjs`](../apps/api/server.test.mjs) | Secret-header forwarding, multipart response handling, 404 method/route rejection, upstream error status passthrough, unavailable-service errors, missing configuration, upload limits, and recovery after cancelled uploads. |

Vitest reports coverage for application sources through `pnpm test:coverage`. Coverage reports are evidence of exercised code, not proof that every requirement or branch is correct. TypeScript checks are part of the frontend build. The browser suite freezes time for repeatable dates and exercises both desktop and narrow-screen navigation; the application itself still uses the user's local date.

CI enforces an initial coverage floor of 75% lines, 70% branches, 65% statements, and 60% functions across the application, plus 90% for the extracted date, booking, validation, and storage helpers in `clinic.ts` and the clinical-workflow rules in `workflow.ts`. These thresholds prevent coverage from silently declining; they do not substitute for behavioral assertions.

Useful local reports are `apps/frontend/coverage/index.html` and `apps/frontend/playwright-report/index.html`. Browser failures retain traces and screenshots under `.context/test-results/`. These outputs are ignored by Git. Run `pnpm --filter @clinic/frontend exec playwright show-report` from the repository root to inspect the browser report.

## CI and continuous delivery

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pull requests and main-branch pushes:

| Job | Required checks / output |
| --- | --- |
| `workflow` | Validate GitHub Actions with actionlint and check shell script syntax. |
| `api` | Test multipart proxy forwarding, configuration/errors, upload limits, and cancelled uploads. |
| `parser` | Test the document-parser API, extraction, resource limits, and cleanup. |
| `frontend` | Install from the pnpm lockfile, run typecheck and unit/component coverage, and execute the desktop/mobile browser suite against a production build. Preserve reports for review. |
| `stack` | Run the isolated Compose stack smoke test and PostgreSQL regressions. |
| `container` | Build and smoke-test the frontend image, then save that tested image as a workflow artifact. |
| `deliver` | Only on a main-branch push and only after all check jobs succeed: download the already-tested image and publish it to GHCR with the commit SHA and `main` tags. |

Pull requests do not publish images. Delivery uses the workflow's GitHub token with package-write permission; repository/organization package policies must permit it. No server credentials or live deployment target are configured. Publishing a frontend image is continuous delivery of the demo, not deployment of a functioning API and EHR.

Repository maintainers should configure branch protection to require the test jobs before merge. Workflow files define checks and job dependencies; they do not configure repository branch protection themselves.

## Review, resolve, and iterate

1. Read the failing assertion and relevant implementation together. Reproduce the smallest meaningful failing case before changing code.
2. Fix the underlying behavior and add a regression assertion that fails without the fix. Keep patient identity and historical content in view when reviewing clinical-chart changes.
3. Rerun the affected suite, then the broader checks affected by the change. A schema change needs fresh PostgreSQL initialization and database regressions; a frontend change needs unit/component, build, and browser checks; image or Compose changes need their respective smoke script.
4. Review the resulting diff for new problems, incorrect assumptions, and accidentally weakened assertions. If that review exposes another issue, fix it and rerun the relevant checks again.
5. Finish only when required checks pass. Record a genuinely unavailable external check as unverified, rather than calling it passed or suppressing it.

Use behavioral assertions and negative cases: a rejected booking must leave existing appointments intact; a note save must retain its historical text; a patient switch must never reuse another patient's draft or print preview. Do not make a failing test pass by removing the assertion, adding arbitrary waits, skipping the case, or masking errors with retries.

## Limits and future tests

The public sample credentials and browser-only demo views do not establish authentication or API authorization. The API currently provides only the document-parser proxy. These checks cannot establish API authorization, shared persistence, a synchronized multi-device queue, staff identity, permitted visit transitions, atomic appointment/visit completion, audit history, migrations, or backup recovery. The SQL history view is not itself an authorization boundary. A browser `localStorage` test is not a server persistence test.

Add API integration and browser tests for those capabilities as they are implemented, using the requirement IDs in the SRS. Run future migrations against an existing schema as well as a fresh database. Keep all test fixtures synthetic, and verify workload, security, accessibility, and recovery requirements separately before handling real patient records.
