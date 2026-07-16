# Privacy and data handling

## Showcase policy

The scheduling dataset in the repository contains synthetic nicknames only. It contains no real employee first names, last names, patient records, diagnoses, identifiers, phone numbers, or email addresses.

Nickname is still pseudonymous data in a real unit. The current importer derives a
generated UUID from the scheduling period and normalized nickname, and the
persistence bridge also matches period employees by nickname. That identity is
not durable across renames and is suitable only for the showcase. A production
workflow needs a stable pseudonymous reference derived server-side from an
approved employee identifier.

## Inbound data

- The normalized spreadsheet contract requires `nickname` / `ชื่อเล่น`.
- The supplied MICU layout may include `รหัสพนักงาน` and the legacy
  `ชื่อ - สกุล` label. Employee-code and note cells are accepted for source
  compatibility but are dropped before the normalized dataset is returned.
- Values under the legacy display label must still be unique single-token
  nicknames or pseudonyms; multi-token legal names remain rejected.
- Outside that exact compatibility layout, first-name, last-name, and full-name
  headers are rejected.
- Raw source rows are not sent to OpenAI.
- Only ambiguous cell tokens are sent for normalization.
- Explanation requests contain nickname, date, request, assignment, reason code, and solver facts only.
- The OpenAI request uses `store: false` and a hashed privacy-preserving safety identifier.

## Stored data

- `employees` stores a generated UUID and `nickname`; it intentionally has no
  employee-code, first-name, or last-name column.
- Period employees snapshot an employee UUID, nickname, and skill level. The
  current application bridge maps imported rows to those snapshots by normalized
  nickname; it does not yet synchronize a newly imported roster transactionally.
- Candidate `generation_summary` currently includes the normalized solver problem,
  including pseudonymous nicknames, requests, and previous assignments. Employee
  codes and notes have already been removed, but this JSON should be minimized
  before production.
- Original uploads belong in a private Supabase Storage bucket with signed access, not a public bucket.
- Confirmed versions are immutable. Generation and confirmation RPCs append audit
  events, while ordinary table mutations rely on audit fields rather than a
  complete append-only event for every change.
- Application delete flows use `is_active = false` with `deleted_at` and `deleted_by`.

## Administrator identity

- The event build authenticates one administrator from server-only environment variables. The configured email and password are not part of the nurse roster dataset and are never sent to Supabase scheduling tables.
- The signed eight-hour session contains the administrator email, display name, and `ADMIN` role. The cookie is host-only, `HttpOnly`, `SameSite=Strict`, and `Secure` in production; signed JWT contents are integrity-protected, not encrypted.
- Only `ADMIN_DISPLAY_NAME` is used as the human-readable audit actor when a version is confirmed. The administrator email is not stored in `confirmed_by_nickname`, generation metadata, assignments, or exports.
- Both `.env.local` files are excluded from Git. Examples contain empty placeholders only.

## Production follow-up

Before a hospital pilot, replace the event-only plaintext environment password with managed authentication, password hashing, MFA, revocation, and centralized audit/rate-limit controls. Add stable pseudonymous employee identity, transactional roster synchronization, and a minimized generation summary. Also complete a privacy impact assessment, retention schedule, access review, breach-response plan, and legal review for employee scheduling data. Do not reuse showcase seed data or credentials in production.
