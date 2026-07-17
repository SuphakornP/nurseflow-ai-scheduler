# NurseFlow database

## Purpose

The Supabase schema is designed to become the source of truth for schedule
inputs, generated candidate versions, validation evidence, confirmations, and
export history. The current application persists candidates and confirmations,
but the import route does not yet transactionally synchronize roster rows,
requests, or previous assignments. Its showcase bridge therefore requires a
matching period roster to be staged before confirmation.

The schema targets Supabase Postgres 17 and a pseudonymous showcase:
`employees` contains `nickname` but deliberately has no legal-name, employee
number, email, phone, patient, or clinical-record fields.

The local artifacts are:

- `supabase/migrations/20260716065746_nurseflow_initial_schema.sql`
- `supabase/seed.sql`
- `supabase/config.toml`

Migration deployment is an explicit operator action; this repository has no
automatic remote migration workflow. Treat the checked-in migration as the
canonical schema and verify any connected project's migration history before
using it.

## Data ownership

Every business row is scoped to a department. Transaction tables repeat
`department_id`, `schedule_period_id`, and, where applicable,
`schedule_version_id`. Composite foreign keys prevent a child from pointing to
a parent in another department or scheduling period.

| Area | Tables | Responsibility |
| --- | --- | --- |
| Access | `departments`, `department_memberships` | Department tenancy and user role |
| Master data | `skill_levels`, `shift_types`, `employees`, `constraint_rules` | Nickname-only roster and versioned rule configuration |
| Inputs | `schedule_periods`, `schedule_period_employees`, `schedule_imports`, `schedule_requests`, `previous_assignments` | Immutable snapshot of the data used by the solver |
| Solver output | `schedule_versions`, `schedule_assignments`, `schedule_validation_results`, `schedule_request_outcomes`, `schedule_version_metrics` | Candidate schedules and evidence |
| History | `schedule_exports`, `schedule_audit_logs` | Append-only export and confirmation records |

`schedule_period_employees` snapshots the nickname and skill code. Historical
schedules therefore do not change if an employee master record changes later.

The input tables and import ordering below describe the target persistence
contract. The current `/api/import` route returns a browser dataset and does not
write `schedule_imports`, `schedule_requests`, or `previous_assignments`.

## Audit contract

Every application table contains the required seven fields:

```text
is_active
created_at
created_by
updated_at
updated_by
deleted_at
deleted_by
```

The `nurseflow_private.apply_audit_fields()` trigger sets timestamps and uses
`auth.uid()` when a user identity is available. It also preserves the original
creator and keeps soft-delete fields coherent. Auth actor UUIDs are intentionally
not foreign keys: an audit trail must remain meaningful after an Auth user is
removed.

Confirmed periods and versions retain either `confirmed_by` (an Auth UUID) or
`confirmed_by_nickname` (the nickname supplied by the trusted showcase server),
never both. `schedule_audit_logs` mirrors this with nullable `actor_id` and
`actor_nickname`. This keeps the no-login showcase auditable without inventing
an Auth identity or collecting a legal name.

Authenticated clients receive no `DELETE` grant. Normal deletion is a soft
delete (`is_active = false`); exported files and audit events are append-only.

## Authorization

All application tables have RLS enabled and forced. The `anon` role has no
table or RPC access.

An authenticated user must have an active row in `department_memberships`.
Roles are:

- `ADMIN`: manages department master data and schedules.
- `SCHEDULER`: manages nickname-only employees, periods, and schedule inputs.
- `REVIEWER`: reads department data and may confirm a valid candidate.
- `VIEWER`: read-only department access.

These database roles support a future managed-auth client. The Build Week web
workspace itself authenticates one environment-configured administrator and
uses server-side Supabase credentials; "admin-only" in product copy refers to
that web boundary, not to eliminating the schema's other roles.

Users can read only their own membership row. Membership provisioning is a
trusted server/admin operation, which avoids self-service role escalation. RLS
checks use `nurseflow_private.has_department_role()`; it is `SECURITY INVOKER`,
queries only the caller-visible membership row, and is not in an exposed API
schema.

The migration uses explicit grants because grants and RLS are separate layers.
It revokes future automatic public-schema exposure, grants only required tables
to `authenticated`, and grants server output persistence to `service_role`.
Never put the service-role or secret key in browser code.

## Candidate persistence RPC

The Next server persists one complete solver result with:

```sql
select public.save_schedule_candidate(:payload::jsonb);
```

`save_schedule_candidate(jsonb)` is executable only by `service_role`. It is a
bounded `SECURITY DEFINER` function with an empty `search_path`, fully qualified
objects, no dynamic SQL, and a single database transaction. The period and its
input snapshots must already exist. Invalid references, duplicates, or malformed
data abort the entire call.

Payload contract:

```json
{
  "department_id": "10000000-0000-4000-8000-000000000001",
  "schedule_period_id": "40000000-0000-4000-8000-000000000001",
  "version": {
    "name": "Balanced candidate",
    "parent_version_id": null,
    "generation_type": "INITIAL",
    "solver_status": "FEASIBLE",
    "objective_score": 1234.5,
    "solver_duration_ms": 8421,
    "constraint_config": {},
    "generation_instruction": null,
    "generation_summary": {}
  },
  "assignments": [
    {
      "period_employee_id": "50000000-0000-4000-8000-000000000001",
      "assignment_date": "2026-08-01",
      "shift_code": "D",
      "assignment_source": "SOLVER",
      "is_manual_override": false,
      "override_reason": null
    }
  ],
  "validations": [
    {
      "constraint_code": "DAY_STAFFING",
      "validation_status": "PASS",
      "violation_count": 0,
      "validation_details": [],
      "validated_at": "2026-07-16T08:00:00Z"
    }
  ],
  "metrics": [
    {
      "metric_code": "OFF_SATISFACTION_RATE",
      "metric_value": 0.87,
      "metric_detail": {}
    }
  ]
}
```

The real assignment array must contain exactly one row for every active,
available period employee and every scheduling date. The real validation array
must include each code emitted by the independent validator. Rule codes in the
seed match `services/solver/app/validation.py`.

The RPC allocates the next version number while holding a row lock on the period,
inserts assignments, validations, and metrics, derives `VALID` or `INVALID`,
sets the period to `GENERATED`, writes an audit event, and returns:

```json
{
  "schedule_period_id": "...",
  "schedule_version_id": "...",
  "version_no": 1,
  "status": "VALID",
  "solver_status": "FEASIBLE",
  "hard_constraints_passed": 17,
  "hard_constraints_total": 17,
  "assignment_count": 868,
  "expected_assignment_count": 868
}
```

The RPC intentionally does not create departments, employees, periods, imports,
or requests. Keeping those operations separate makes input review explicit and
prevents a generic JSON RPC from bypassing the normal workflow.

## Confirmation RPC

### Authenticated production path

An authenticated `ADMIN`, `SCHEDULER`, or `REVIEWER` confirms a candidate with:

```sql
select public.confirm_schedule_version(:schedule_version_id::uuid);
```

The function re-checks all of the following inside one short transaction:

1. `auth.uid()` is present and has an active role in the candidate department.
2. The period is active, `GENERATED`, and not already confirmed.
3. The version is active, `VALID`, and its solver status is `OPTIMAL` or `FEASIBLE`.
4. Every effective active `HARD` rule has exactly one `PASS` result with zero violations.
5. The assignment matrix is complete for all active, available period employees.

It then supersedes other valid candidates, confirms the selected version,
confirms the period, and records `VERSION_CONFIRMED`. The response contains the
period ID, version ID/number, actor, timestamp, hard-rule count, and assignment
count.

This RPC is `SECURITY DEFINER` only because ordinary clients have no privilege to
mutate solver-output or confirmation columns. Safety controls are: an empty
`search_path`, fully qualified relations, no dynamic SQL, explicit actor and
membership checks, `EXECUTE` revoked from `PUBLIC`/`anon`/`service_role`, and an
explicit grant only to `authenticated`.

### Showcase server path

The current Build Week UI has no Supabase Auth session. Its trusted Next server
uses the secret/service-role client and calls:

```sql
select public.confirm_schedule_version_server(
  :schedule_version_id::uuid,
  :actor_nickname::text
);
```

`confirm_schedule_version_server(uuid, text)` is executable only by
`service_role`; `PUBLIC`, `anon`, and `authenticated` have no execute privilege.
It repeats the same period lock, solver-status gate, complete assignment-matrix
check, and all-hard-rules-pass check as the authenticated RPC. It writes a
trimmed 1-80 character non-PII nickname to `confirmed_by_nickname` and
`schedule_audit_logs.actor_nickname`, while the UUID actor fields remain null.

The Next route mapping is:

```ts
const { data: saved, error: saveError } = await supabaseAdmin.rpc(
  "save_schedule_candidate",
  { p_payload: candidatePayload },
);

const { data: confirmed, error: confirmError } = await supabaseAdmin.rpc(
  "confirm_schedule_version_server",
  {
    p_schedule_version_id: saved.schedule_version_id,
    p_actor_nickname: "Build Week Scheduler",
  },
);
```

Build `candidatePayload` by mapping each solver nickname to the matching active
`schedule_period_employees.nickname_snapshot`, then send that row's `id` as
`period_employee_id`. Map solver `date` to `assignment_date`, solver shift code
to `shift_code`, validator code to `constraint_code`, validator pass/fail to
`validation_status`, and violations to `violation_count` plus
`validation_details`. Use the seeded department and period IDs only for the
synthetic demo. The secret/service-role key must remain in the server runtime.

## Immutability

Database triggers reject:

- insert of a pre-confirmed period or version;
- update/delete of a confirmed version or confirmed period;
- changes to inputs after their period is confirmed;
- changes to assignments, validation evidence, outcomes, or metrics after confirmation;
- export creation for an unconfirmed version;
- update/delete of export and audit history.

A partial unique index also guarantees at most one active confirmed version per
period. Database-owner emergency maintenance requires deliberately disabling the
relevant trigger; application credentials cannot bypass it.

## Server insert order

For setup and imports, the trusted server follows this order:

1. Create the Auth user through the Supabase Auth Admin API.
2. Insert `department_memberships` with a trusted role.
3. Insert `departments`, then `skill_levels`, `shift_types`, and `constraint_rules`.
4. Insert nickname-only `employees`.
5. Insert `schedule_periods`.
6. Snapshot the roster into `schedule_period_employees`.
7. Insert `schedule_imports`.
8. Insert `schedule_requests` and `previous_assignments`.
9. Run the solver and independent validator.
10. Call `save_schedule_candidate`; do not insert output tables one at a time.
11. Call `confirm_schedule_version` for an authenticated decision-maker, or the
    service-role-only `confirm_schedule_version_server` for the no-login showcase.
12. Generate the file, upload it to a private Storage bucket, then insert `schedule_exports`.

Storage buckets are intentionally not created by this migration. Provision
private import/export buckets in the deployment environment and use paths that
begin with the department and period IDs. File operations remain server-side;
the database stores only metadata and object paths.

## Local development

The CLI configuration targets Postgres 17 and automatically loads
`supabase/seed.sql` after migrations.

```bash
npx supabase@latest start
npx supabase@latest db reset
npx supabase@latest db lint --local
```

The seed creates one synthetic MICU department, five skill levels, five shifts,
17 hard rules, six soft rules, 28 nickname-only employees (8 Incharge, 4 Trainee,
11 Member L1, 4 Member L2, and 1 Member L0), an August 2026 period, three days of
context assignments, and 129 normalized showcase requests. Both the deterministic
OFF requests/conflicts/locked events and the rotating July 29-31 patterns are
kept in sync with `services/solver/app/demo.py`.

The nickname order exactly matches `services/solver/app/demo.py`: Mint, Beam,
Ploy, Fah, May, Nan, Aom, Gift, Pear, Praew, Mook, Bam, June, Fern, Mind, Ice,
View, Noon, Ning, Bow, Earn, Kwan, Som, Fon, Pim, Oil, Dao, and Jan.

It does not write directly to `auth.users`. If a local Auth user with
`demo@nurseflow.local` already exists, that user receives the synthetic `ADMIN`
membership. Otherwise, create the user with the supported Auth API and provision
membership from a trusted server.

## Query guidance

RLS remains the authorization boundary, but application queries should still
filter by `department_id`, `schedule_period_id`, and `schedule_version_id`. This
gives the Postgres planner selective predicates and uses the composite/partial
indexes defined by the migration.

## References

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Data API security and explicit grants](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Postgres 17 change](https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change)
- [Supabase explicit table exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
