# Privacy and data handling

## Showcase policy

The scheduling dataset in the repository contains synthetic nicknames only. It contains no real employee first names, last names, patient records, diagnoses, identifiers, phone numbers, or email addresses.

Nicknames in a real unit can identify employees. Use synthetic nicknames and
requests in demonstrations and fixtures. The importer derives each nurse ID
from the scheduling period and normalized nickname, so a rename creates a new
identifier.

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
- Before an imported workbook can be reused for export, the server removes
  employee-code/note values, comments, formulas, hyperlinks, unrelated sheets,
  embedded or external content, defined names, and document properties. Only the
  bounded sanitized template is cached, and the generated schedule is bound to
  its SHA-256 snapshot digest.
- A relationship-free empty drawing placeholder emitted by Google Sheets is
  accepted only after bounded ZIP inspection, then removed with Google person
  metadata during serialization. Drawing relationships, media, macros, embedded
  objects, and other active workbook parts remain rejected.
- Only ambiguous cell tokens are sent for normalization.
- Request policy is retained without adding identity data: approved `VAC` and
  non-L0 `ED` are `LOCKED`, O/D and O/N are `REQUIRED` choices, and the remaining
  requests are `PREFERENCE`. The browser shows these categories separately so a
  soft satisfaction percentage cannot hide a mandatory event.
- Explanation requests contain nickname, date, request, assignment, reason code, and solver facts only.
- Generation failure logs never contain request bodies, bearer tokens, employee
  values, nicknames, raw normalization values, or upstream validation messages.
  They contain a generated request ID, optimization profile, aggregate counts,
  status, and sanitized validation categories only.
- The OpenAI request uses `store: false` and a hashed privacy-preserving safety identifier.

## Workspace and download

- The web server parses the upload in memory. It makes the sanitized template
  available for export for up to eight hours.
- The server temporarily caches the normalized dataset, generated assignments
  and validation evidence so it can verify a selected version for confirmation
  or export. Candidate entries expire after 30 minutes. These caches are bounded,
  scoped to the login, and cleared by a server restart. Expired entries cannot
  be retrieved. The cache removes them on lookup or on the next insertion.
- The current selection and confirmation live in the open browser workspace.
  Refreshing the page resets it. Download the Excel export before leaving
  if you want to retain a version.

## Administrator identity

- The event build authenticates one administrator from server-only environment variables. Roster inputs and exports omit the administrator's email and password.
- The signed eight-hour session contains the administrator email, display name, and `ADMIN` role. The cookie is host-only, `HttpOnly`, `SameSite=Strict`, and `Secure` in production; signed JWT contents are integrity-protected, not encrypted.
- Both `.env.local` files are excluded from Git. Examples contain empty placeholders only.

## Production follow-up

Before a hospital pilot, replace the event-only plaintext environment password with managed authentication, password hashing, MFA, revocation, and centralized audit/rate-limit controls. Also complete a privacy impact assessment, retention schedule, access review, breach-response plan, and legal review for employee scheduling data.
