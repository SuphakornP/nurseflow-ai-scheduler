# NurseFlow AI

Privacy-first nurse scheduling copilot for OpenAI Build Week. NurseFlow turns a nickname-only request sheet into validated ICU roster candidates, explains trade-offs, records the selected version in Supabase, and exports a review-ready Excel workbook.

The language model does **not** build the roster. Google OR-Tools CP-SAT creates assignments; a separate validator checks them before confirmation. OpenAI is used only for ambiguous-token suggestions and evidence-grounded explanations.

## Demo flow

```text
Create period
  -> import Google Sheet / .xlsx
  -> normalize and review ambiguous tokens
  -> generate CP-SAT candidates
  -> independently validate
  -> compare versions
  -> confirm one immutable version
  -> save to Supabase and export Excel
```

The built-in August 2026 MICU dataset is fully synthetic: 28 unique nicknames, no first names, no last names, and no patient data.

## Run locally

Requirements: Node.js 20+, Python 3.12+, and [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env.local
cp services/solver/.env.example services/solver/.env.local
# Fill the admin credentials and use the same SOLVER_API_TOKEN in both files.
npm install
uv sync --directory services/solver --extra dev
npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the single admin account from `.env.local`. OpenAI and Supabase remain optional; without them the UI clearly uses deterministic or local-demo behavior instead of pretending data was persisted. Admin authentication and the matching solver token are required.

Useful commands:

```bash
npm run dev             # Next.js only
npm run dev:solver      # FastAPI + CP-SAT only
npm run typecheck
npm run lint
npm test
npm run build
```

## Environment

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_DISPLAY_NAME=
AUTH_SECRET=
SOLVER_API_URL=http://127.0.0.1:8000
SOLVER_API_TOKEN=
NEXT_PUBLIC_DEMO_MODE=true
```

- `OPENAI_API_KEY` and `SUPABASE_SECRET_KEY` are server-only. Never prefix them with `NEXT_PUBLIC_`.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`, and `AUTH_SECRET` define one server-only administrator. Passwords must contain at least 12 characters; the signing secret must contain at least 32 characters.
- `SOLVER_API_TOKEN` must contain at least 32 characters and must match `services/solver/.env.local`. Next.js sends it only to the private FastAPI work endpoints.
- `gpt-5.6-terra` is the configured balance-of-quality-and-cost model. The app uses the Responses API with Structured Outputs and `store: false`.
- Without an OpenAI key, ambiguous values remain human-reviewed and explanations come from deterministic reason codes.
- Without Supabase server credentials, confirmation is kept in the current demo session and explicitly marked as not persisted.

Generate independent random values for `AUTH_SECRET` and `SOLVER_API_TOKEN`, for example with `openssl rand -base64 48`. Never commit either `.env.local` file. The event build keeps `ADMIN_PASSWORD` as a plaintext deployment secret by design; replace this single-admin mechanism with a managed identity provider, strong password hashing, MFA, and centralized rate limiting before a real hospital pilot.

## Admin access

- There is no signup, external-user role, password reset, remember-me, or client-side token storage.
- Supabase Auth is not used by the application, and signup is disabled in the checked-in local configuration; keep the equivalent cloud setting disabled.
- A successful login creates a signed `HttpOnly`, host-only, `SameSite=Strict` cookie for an absolute eight-hour session. Production cookies are also `Secure`.
- Every page and Next.js route is filtered by `proxy.ts`; every Route Handler verifies the session again. Verification checks the JWT signature, issuer, audience, expiry, `ADMIN` role, and current configured email.
- State-changing requests require a same-origin check. Login attempts are limited to five per 15 minutes by the current process-local limiter and return a generic response for invalid credentials.
- Rotating `AUTH_SECRET` invalidates every active session. Sign out deletes the cookie and returns to `/login`.
- The admin display name is used as the confirmation audit actor. The credential email is never written into scheduling tables.

## Supabase

The SQL in `supabase/migrations/` creates the nickname-only data model, explicit grants, Row Level Security, department membership, version history, validation results, export records, and an atomic confirmation function. Every application table includes these seven fields:

```text
is_active, created_at, created_by, updated_at,
updated_by, deleted_at, deleted_by
```

Apply the migration to a dedicated Supabase project, then run the synthetic seed:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Review `docs/database.md` before applying it to a shared project. Confirmed versions are immutable; normal application flows use soft delete.

## Import contract

The first worksheet must contain:

- a `nickname` or `ชื่อเล่น` column;
- a `skill_level` / `level` column;
- three previous-context date columns;
- one date column for every day in the scheduling period.

For privacy, imports containing explicit first-name, last-name, or full-name headers are rejected. Runtime imports are capped at 10 MB and `.xlsx`; Google Sheet URLs must use `https://docs.google.com/spreadsheets/d/...` and be accessible to anyone with the link.

## Project layout

```text
app/                  Next.js UI and server-only route handlers
components/           Operational workspace and schedule matrix
lib/                  Contracts, import, OpenAI, Supabase, solver client
services/solver/      FastAPI, CP-SAT model, validator, Excel export, tests
supabase/             Migration and synthetic seed
docs/                 Architecture, database, privacy, and solver assumptions
```

## Safety boundary

NurseFlow is a decision-support prototype, not an autonomous staffing or clinical system. A scheduler must review and confirm every roster. Invalid versions cannot be confirmed. AI explanations are generated only from structured solver evidence and must not be treated as clinical guidance.

OpenAI implementation follows the current [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) guidance. Supabase access follows the current [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [API key](https://supabase.com/docs/guides/api/api-keys) guidance.
