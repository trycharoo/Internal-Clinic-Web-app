# Testing

The test suite covers the browser demo, backend document-parser proxy, and document-parser service: pure clinic rules, React behavior, desktop/mobile browser journeys, proxy forwarding/limits, and parser API checks. Read the [SRS](SRS.md) for intended requirements and the distinction between implemented and planned behavior.

## Required testing policy

The root [AGENTS.md](../AGENTS.md) applies across the repository. Every new feature or behavior change must include meaningful unit tests, and every bug fix must include a regression test. Cover relevant boundaries, invalid inputs, failures, and state transitions; add component/integration or browser tests when the affected behavior requires them. Do not skip or weaken tests, assertions, coverage thresholds, or CI checks to make a change pass.

Documentation-only changes need documentation and diff checks, not runtime tests or placeholder test cases. Report unavailable checks as unverified, with the missing prerequisite.

## Run the checks

Use Node.js `22.22.2+` in the Node 22 line, Node.js `24.15+` in the Node 24 line, or Node.js `26+`, matching `package.json`. Running the `services/doc-parser` suite locally requires Python 3 and the packages in `services/doc-parser/requirements-dev.txt`.

From the repository root:

```sh
npm ci
npm run typecheck
npm run test:coverage
npx playwright install chromium
npm run test:e2e
npm test --prefix backend
python3 -m pip install -r services/doc-parser/requirements-dev.txt
python3 -m pytest services/doc-parser/test_app.py
```

On Linux, install Chromium's operating-system dependencies with `npx playwright install --with-deps chromium` when needed. The browser suite builds the application and starts a production preview on port 4173; that port must be available. It fails if another process is already serving the configured port.

For a shorter feedback loop:

```sh
npm test
npm run test:watch
npm run test:e2e -- --project=chromium
```

## What each check verifies

| Level | Files | Evidence |
| --- | --- | --- |
| Unit | [`src/clinic.test.ts`](../src/clinic.test.ts), [`src/demoLogin.test.ts`](../src/demoLogin.test.ts) | Pure date, booking, stored-data (including patient documents), and queue rules, plus public demo-credential matching, email normalization, exact passwords, and role-mismatch rejection. |
| Component / integration | [`src/App.test.tsx`](../src/App.test.tsx) | User interactions with the actual React app: public demo-credential matching and mismatch feedback, explicit `/login` and role-view routing, in-memory-session boundaries, role-specific UI isolation, local hero-cover validation/replacement/reset, explicit synthetic-demo entry, document-upload review and chart persistence, validation, chart isolation, booking, queue behavior, staff-confirmed allergy status, unknown sex selection, encounter note preservation, prescriptions, and browser storage. Browser APIs can be mocked here. |
| Browser | [`e2e/clinic.spec.ts`](../e2e/clinic.spec.ts) | Desktop and mobile Chromium journeys against a production build, including matching/mismatched demo credentials, Doctor/Attendant/Patient view navigation, Back/Forward and refresh/direct-route login boundaries, actual hero-image loading and cover selection/reset, explicit demo entry, reviewed patient document upload and reload persistence, public check-in and triage allergy confirmation, reload persistence, responsive hero/form layout, and absence of unhandled application errors. |
| Parser API | [`services/doc-parser/test_app.py`](../services/doc-parser/test_app.py) | Health, API-key rejection, extension and upload-size errors, decoded-image and PDF raster limits, image/scanned-page OCR, and temp-file cleanup. Native OCR/rendering are mocked. |
| Backend proxy | [`backend/server.test.mjs`](../backend/server.test.mjs) | Secret-header forwarding, multipart response handling, unavailable-service errors, missing configuration, upload limits, and recovery after cancelled uploads. |

Vitest reports coverage for application sources through `npm run test:coverage`. Coverage reports are evidence of exercised code, not proof that every requirement or branch is correct. TypeScript checks are part of the build. The browser suite freezes time for repeatable dates and exercises both desktop and narrow-screen navigation; the application itself uses the user's local date.

CI enforces an initial coverage floor of 75% lines, 70% branches, 65% statements, and 60% functions across the application, plus 100% for the extracted date, booking, validation, and storage helpers in `clinic.ts`. These thresholds prevent coverage from silently declining; they do not substitute for behavioral assertions.

Useful local reports are `coverage/index.html` and `playwright-report/index.html`. Browser failures retain traces and screenshots under `.context/test-results/`. These outputs are ignored by Git. Run `npx playwright show-report` from the repository root to inspect the browser report.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pull requests, main-branch pushes, and manual runs:

| Job | Required checks / output |
| --- | --- |
| `workflow` | Validate GitHub Actions with actionlint and check shell script syntax (`services/doc-parser/install-debian.sh`). |
| `backend` | Test multipart proxy forwarding, configuration/errors, upload limits, and cancelled uploads. |
| `parser` | Test the document-parser API, extraction, resource limits, and cleanup. |
| `frontend` | Install from the root lockfile, run unit/component coverage, and execute the desktop/mobile browser suite against a production build. Preserve reports for review. |

Repository maintainers should configure branch protection to require the test jobs before merge. Workflow files define checks and job dependencies; they do not configure repository branch protection themselves.

## Review, resolve, and iterate

1. Read the failing assertion and relevant implementation together. Reproduce the smallest meaningful failing case before changing code.
2. Fix the underlying behavior and add a regression assertion that fails without the fix. Keep patient identity and historical content in view when reviewing clinical-chart changes.
3. Rerun the affected suite, then the broader checks affected by the change. A web app change needs unit/component, build, and browser checks; backend proxy or parser changes need `npm test --prefix backend` or `pytest services/doc-parser/test_app.py`.
4. Review the resulting diff for new problems, incorrect assumptions, and accidentally weakened assertions. If that review exposes another issue, fix it and rerun the relevant checks.
5. Finish only when required checks pass. Record a genuinely unavailable external check as unverified, rather than calling it passed or suppressing it.

Use behavioral assertions and negative cases: a rejected booking must leave existing appointments intact; a note save must retain its historical text; a patient switch must never reuse another patient's draft or print preview. Do not make a failing test pass by removing the assertion, adding arbitrary waits, skipping the case, or masking errors with retries.

## Limits

The public sample credentials and browser-only demo views do not establish authentication or API authorization. The backend currently provides only the document-parser proxy. These checks cannot establish API authorization, shared persistence, a synchronized multi-device queue, staff identity, permitted visit transitions, atomic appointment/visit completion, audit history, migrations, or backup recovery. Browser `localStorage` tests are not server persistence tests.

Add API integration, database, and browser tests for those capabilities when they are implemented, using the requirement IDs in the SRS. Keep all fixtures synthetic, and verify workload, security, accessibility, and recovery requirements separately before handling real patient records.
