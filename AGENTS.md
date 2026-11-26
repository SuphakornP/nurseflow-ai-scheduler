# Repository Guidelines

## Project Structure & Module Organization

The Next.js 16 application lives in `app/`, with Route Handlers under `app/api/` and reusable UI in `components/`. Shared contracts, authentication, Excel parsing and sanitization, solver adapters, and temporary server caches live in `lib/`. Keep privileged modules behind the existing `server-only` guard.

The Python scheduling service is in `services/solver/app/`, with pytest coverage in `services/solver/tests/`. The synthetic solver input is in `services/solver/app/demo.py` and the bundled UI preview is in `components/demo-data.ts`. Architecture and privacy decisions belong in `docs/`.

## Scheduling Data Lifecycle

Keep the app database-free. Use the built-in synthetic roster or import a workbook containing nicknames, skill levels, previous assignments, and requests for the selected period. Feed this dataset through human review, solver generation, and hard-rule validation. The preview and an imported but unsolved dataset must never stand in for a validated calculation.

Keep candidates and sanitized source templates in bounded, expiring server memory scoped to the authenticated login. Allow one confirmed candidate per calculation and make confirmation retries return the original result. Bind an imported roster export to its original sanitized workbook. If the necessary data expires, tell the user to re-import or regenerate. The downloaded workbook is the user's lasting copy.

## Build, Test, and Development Commands

- `npm ci` and `uv sync --directory services/solver --extra dev --locked` install pinned dependencies.
- `npm run dev:all` starts Next.js and FastAPI; use `npm run dev` or `npm run dev:solver` for one service.
- `npm run lint` runs ESLint with Next.js Core Web Vitals and TypeScript rules.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm test` runs Vitest and pytest; target one suite with `npm run test:web` or `npm run test:solver`.
- `npm run build` verifies the production Next.js build.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript/TSX and four spaces in Python. Prefer strict runtime schemas, explicit types, small functions, and existing helpers over duplicated logic. Use PascalCase for React components, camelCase for TypeScript functions, UPPER_SNAKE_CASE for constants, and snake_case in Python. Component filenames use kebab-case, for example `sign-out-button.tsx`. Follow PEP 8 and add Python type hints. Run lint and typecheck before committing.

## Testing Guidelines

Place TypeScript tests beside their modules as `*.test.ts` and name Python tests `test_*.py`. Add focused tests for behavior changes, especially workbook context, import privacy, cache isolation and expiry, solver constraints, confirmation and export eligibility, authentication, and error sanitization. Run `npm test` before opening a PR.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects, such as `Harden solver export validation`. Keep commits scoped and avoid generated artifacts. PRs should explain what changed and why, list verification commands, link relevant issues, and include screenshots for UI changes. Call out environment changes, workbook compatibility changes, and accepted security trade-offs explicitly.

## Security & Configuration

Copy `.env.example` files to `.env.local`; never commit real credentials. Both services must share `SOLVER_API_TOKEN`, while `AUTH_SECRET` must remain distinct. Keep FastAPI private, deploy over HTTPS, and never add real staff or patient data—fixtures must remain synthetic and nickname-only.
