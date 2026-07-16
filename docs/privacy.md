# Privacy and data handling

## Showcase policy

The scheduling dataset in the repository contains synthetic nicknames only. It contains no real employee first names, last names, patient records, diagnoses, identifiers, phone numbers, or email addresses.

Nickname is still pseudonymous data in a real unit. The MVP therefore uses a generated UUID as the durable employee identifier and treats nickname as display-only data.

## Inbound data

- The spreadsheet contract requires `nickname` / `ชื่อเล่น`.
- Imports with first-name, last-name, or full-name headers are rejected.
- Raw source rows are not sent to OpenAI.
- Only ambiguous cell tokens are sent for normalization.
- Explanation requests contain nickname, date, request, assignment, reason code, and solver facts only.
- The OpenAI request uses `store: false` and a hashed privacy-preserving safety identifier.

## Stored data

- `mst_employee` has `nickname` and `external_ref`; it intentionally has no first/last-name columns.
- Period employees snapshot only nickname, skill level, and pseudonymous reference.
- Original uploads belong in a private Supabase Storage bucket with signed access, not a public bucket.
- Confirmed versions are immutable and all changes are audit logged.
- Application delete flows use `is_active = false` with `deleted_at` and `deleted_by`.

## Administrator identity

- The event build authenticates one administrator from server-only environment variables. The configured email and password are not part of the nurse roster dataset and are never sent to Supabase scheduling tables.
- The signed eight-hour session contains the administrator email, display name, and `ADMIN` role. The cookie is host-only, `HttpOnly`, `SameSite=Strict`, and `Secure` in production; signed JWT contents are integrity-protected, not encrypted.
- Only `ADMIN_DISPLAY_NAME` is used as the human-readable audit actor when a version is confirmed. The administrator email is not stored in `confirmed_by_nickname`, generation metadata, assignments, or exports.
- Both `.env.local` files are excluded from Git. Examples contain empty placeholders only.

## Production follow-up

Before a hospital pilot, replace the event-only plaintext environment password with managed authentication, password hashing, MFA, revocation, and centralized audit/rate-limit controls. Also complete a privacy impact assessment, retention schedule, access review, breach-response plan, and legal review for employee scheduling data. Do not reuse showcase seed data or credentials in production.
