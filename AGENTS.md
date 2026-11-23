# Repository instructions

These instructions apply throughout this repository. Read [docs/SRS.md](docs/SRS.md) for business rules and [docs/TESTING.md](docs/TESTING.md) for test commands, prerequisites, and current implementation limits.

The React web application lives at the repository root alongside the Node document-parser proxy in `backend/` and the FastAPI parser service in `services/doc-parser/`. There is no database or container stack in this repository; patient and visit records remain stored in browser `localStorage`.

## Requirements tracking

- Before feature work, check the SRS for existing requirements and implementation status. In the same change, update `docs/SRS.md` when a feature adds or changes a user workflow, actor, permission, business rule, or acceptance behavior. Keep its implementation status, acceptance scenarios, and test traceability accurate.
- Do not change the SRS for internal refactors or bug fixes that restore behavior already specified there.

## Required tests for changes

- Every new feature or application behavior change must include meaningful unit tests in the same change. Test new or changed business rules directly; use component tests for behavior expressed through React.
- Every bug fix must include a regression test that fails for the original defect and passes with the fix.
- Cover normal behavior, relevant boundaries, invalid input, error handling, and state transitions. Assert observable outcomes and preserved data, rather than repeating the implementation or adding placeholder assertions.
- Add component/integration tests when UI interactions, storage, or linked entities are affected. Add browser tests when a user journey, navigation, persistence, or device layout needs browser verification. Pure helper tests cannot establish API authorization, shared persistence, or cross-device behavior.
- Do not skip, remove, or weaken relevant tests, coverage thresholds, or CI checks to make a change pass. Fix the underlying issue; avoid arbitrary waits or retries that conceal failures.
- Documentation-only changes do not need runtime tests or meaningless new tests. Check the documentation, links, and diff instead.

## Verification

Use the existing scripts; [docs/TESTING.md](docs/TESTING.md) is the source of commands and setup details.

- From the repository root, run `npm ci` when dependencies need installation, `npm test` for focused unit/component feedback, and `npm run typecheck` plus `npm run test:coverage` for behavior changes. Use `npm run test:watch` during iteration when helpful.
- Run `npm run build` to verify the build, or `npm run test:e2e` when browser coverage is relevant; the browser suite builds and type-checks the app itself. Install Chromium with `npx playwright install chromium` when needed.
- Run `npm test --prefix backend` for backend proxy changes, and `python3 -m pytest services/doc-parser/test_app.py` (with `services/doc-parser/requirements-dev.txt` installed) for document-parser changes.
- Run the affected checks after changes and rerun them after fixes. Report the commands run and their results. If an external prerequisite is unavailable, report that check as unverified and explain why; never claim it passed or suppress it.
