# Repository instructions

These instructions apply throughout this repository. Read [docs/SRS.md](docs/SRS.md) for business rules and [docs/TESTING.md](docs/TESTING.md) for test commands, prerequisites, and current implementation limits.

## Requirements tracking

- Before feature work, check the SRS for existing requirements and implementation status. In the same change, update `docs/SRS.md` when a feature adds or changes a user workflow, actor, permission, business rule, or acceptance behavior. Keep its implementation status, acceptance scenarios, and test traceability accurate.
- Do not change the SRS for internal refactors or bug fixes that restore behavior already specified there.

## Required tests for changes

- Every new feature or application behavior change must include meaningful unit tests in the same change. Test new or changed business rules directly; use component tests for behavior expressed through React.
- Every bug fix must include a regression test that fails for the original defect and passes with the fix.
- Cover normal behavior, relevant boundaries, invalid input, error handling, and state transitions. Assert observable outcomes and preserved data, rather than repeating the implementation or adding placeholder assertions.
- Add component/integration tests when UI interactions, storage, or linked entities are affected. Add browser tests when a user journey, navigation, persistence, or device layout needs browser verification. Pure helper tests cannot establish API authorization or cross-device behavior.
- Schema or database behavior changes require real PostgreSQL regression assertions in `apps/api/db/tests/regression.sql`; frontend mocks do not replace database tests. Use synthetic fixtures and disposable databases only.
- Do not skip, remove, or weaken relevant tests, coverage thresholds, or CI checks to make a change pass. Fix the underlying issue; avoid arbitrary waits or retries that conceal failures.
- Documentation-only changes do not need runtime tests or meaningless new tests. Check the documentation, links, and diff instead.

## Verification

Use the existing scripts; [docs/TESTING.md](docs/TESTING.md) is the source of commands and setup details.

- From the repository root, run `pnpm install --frozen-lockfile` when dependencies need installation, `pnpm test:frontend` for focused frontend unit/component feedback, and `pnpm typecheck` plus `pnpm test:coverage` for frontend behavior changes. Use `pnpm --filter @clinic/frontend test:watch` during iteration when helpful.
- Run `pnpm build` to verify workspace builds (or `pnpm --filter @clinic/frontend build`), `pnpm test:api` for API proxy changes, or `pnpm test:e2e` when browser coverage is relevant; the browser suite builds and type-checks the frontend itself. Install Chromium with `pnpm --filter @clinic/frontend exec playwright install chromium` when needed.
- From the repository root, run `sh scripts/test-stack.sh` for schema, SQL regression, or Compose changes. It requires Docker/Compose and creates an isolated stack with disposable volumes. Run `sh scripts/test-image.sh` for frontend image/delivery changes. Never point these checks at a real patient database.
- Run the affected checks after changes and rerun them after fixes. Report the commands run and their results. If an external prerequisite is unavailable, report that check as unverified and explain why; never claim it passed or suppress it.
