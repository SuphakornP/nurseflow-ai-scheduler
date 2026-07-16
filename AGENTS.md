# Repository Guidelines

## Project Structure & Module Organization

The Next.js 16 application lives in `app/`; Route Handlers are under `app/api/`. Reusable React UI belongs in `components/`, while shared contracts, authentication, imports, solver adapters, and Supabase access live in `lib/`. Keep browser and server-only code separated; privileged modules should remain behind the existing `server-only` guard.

The Python scheduling service is in `services/solver/app/`, with pytest coverage in `services/solver/tests/`. Supabase migrations and synthetic seed data are under `supabase/`. Architecture, database, and privacy decisions belong in `docs/`.

## Build, Test, and Development Commands

- `npm install` and `uv sync --directory services/solver --extra dev` install pinned dependencies.
- `npm run dev:all` starts Next.js and FastAPI; use `npm run dev` or `npm run dev:solver` for one service.
- `npm run lint` runs ESLint with Next.js Core Web Vitals and TypeScript rules.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm test` runs Vitest and pytest; target one suite with `npm run test:web` or `npm run test:solver`.
- `npm run build` verifies the production Next.js build.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript/TSX and four spaces in Python. Prefer strict runtime schemas, explicit types, small functions, and existing helpers over duplicated logic. Use PascalCase for React components, camelCase for TypeScript functions, UPPER_SNAKE_CASE for constants, and snake_case in Python. Component filenames use kebab-case, for example `sign-out-button.tsx`. Follow PEP 8 and add Python type hints. Run lint and typecheck before committing.

## Testing Guidelines

Place TypeScript tests beside their modules as `*.test.ts`; name Python tests `test_*.py`. Add tests for every behavior change, especially authentication, route coverage, validation boundaries, solver constraints, and error sanitization. There is no fixed coverage threshold, but regressions must have a focused test. Run `npm test` before opening a PR.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects, such as `Harden solver export validation`. Keep commits scoped and avoid generated artifacts. PRs should explain what changed and why, list verification commands, link relevant issues, and include screenshots for UI changes. Call out migrations, environment changes, and accepted security trade-offs explicitly.

## Security & Configuration

Copy `.env.example` files to `.env.local`; never commit real credentials. Both services must share `SOLVER_API_TOKEN`, while `AUTH_SECRET` must remain distinct. Keep FastAPI private, deploy over HTTPS, and never add real staff or patient data—fixtures must remain synthetic and nickname-only.
