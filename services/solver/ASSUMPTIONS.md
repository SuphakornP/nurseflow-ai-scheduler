# Scheduling assumptions

These decisions make the source business rules executable for the Build Week MVP.
They are deliberately isolated in the API model so that a hospital reviewer can
change them later without asking an LLM to rewrite the schedule directly.

## Hard rules

- Approved Vacation uses `constraint_mode=LOCKED` and is immutable. Ordinary-RN
  Education is also `LOCKED`; a conflicting lock makes the model infeasible
  instead of silently changing the event.
- `O/D` (`D/O`) and `O/N` (`N/O`) use `constraint_mode=REQUIRED`. They restrict
  the assignment to `OFF|D` and `OFF|N`, respectively, without fixing which of
  the two the solver selects. Legacy Admin-locked assignment sets remain valid.
- Blank input allows `D`, `N`, or `OFF` for ordinary staff; the weekday Member L0
  default described below replaces `OFF` with `ED`.
- Day staffing is exactly 10 and Night staffing is exactly 9.
- The published skill ranges apply independently to Day and Night.
- The canonical trainee skill code is `TRAINEE_INC`, matching the shared app and
  database contract.
- Member L0 counts toward total staffing and may work at most seven clinical
  shifts in the period. On weekdays, its non-clinical default is Education;
  OFF is available only for an explicit O1-O4 or required/locked OFF choice,
  while approved Vacation remains allowed.
- D and N runs, total clinical runs, N-to-D, and N-to-ED use provided previous
  assignments. Missing history breaks a run rather than being guessed.
- OFF/VAC runs are checked inside the generated period only because the source
  requirement asks previous-month context specifically for D and N rules.
- A maximal contiguous run of explicit O1-O4 and locked Vacation longer than
  four days may lose at most one requested OFF. Vacation is never counted as a
  relaxable day. If one OFF cut cannot make the block safe, generation returns
  infeasible for Admin intervention.
- A deterministic preflight explanation is attached when fixed VAC/ED events
  leave too few nurses in a skill group to meet both shifts. The explanation is
  aggregate by date and skill, never by employee identifier. It does not relax
  VAC, ED, or staffing rules.

## Soft rules and optimization order

`D`, `N`, and O1-O4 are nurse preferences. Member L0 may also prefer Education.
They may yield only as allowed by the long-block rule, staffing, skill mix, and
sequence safety. Unfulfilled preferences are reported for Admin review. VAC,
ordinary-RN ED, O/D, and O/N instead use the hard modes described above.

OFF optimization is lexicographic. Each completed phase is frozen before the next:

1. Maximize O1 satisfaction.
2. Maximize O2 satisfaction.
3. Maximize O3 satisfaction.
4. Maximize O4 satisfaction.
5. Maximize remaining non-O preferences.
6. Maximize adjacent assigned OFF/VAC days.
7. Minimize Day and Night workload spreads within comparable skill groups.
8. Minimize Member L0 clinical use.
9. Minimize weekend workload spreads.
10. Apply the selected profile only as a final deterministic tie-break.

Profiles never change any frozen hospital-priority value.

When a phase reaches only `FEASIBLE` before its time limit, the best value found is
frozen and reported as not proven optimal. This is transparent in `phases`.
CP-SAT uses eight search workers for responsive 28x31 generation. The demo input
and random seed are deterministic; assignments are persisted as the version source
of truth rather than regenerated when an existing version is exported.

The one-cut rule is scoped per maximal contiguous requested OFF/VAC block for one
nurse. Blocks of four days or fewer use normal O1-O4 optimization; blocks longer
than four receive the additional hard one-cut limit.

## Ambiguous input and privacy

- `O1/N`, `D/N`, `D1`, `Vac1`, and unknown tokens block generation until an
  explicit human resolution is supplied.
- Common casing, whitespace, `Vac`, Thai `\u0e0aED`, `D/O`, and `N/O` variants are
  normalized deterministically.
- Thai Buddhist year 2569 is parsed as Gregorian year 2026.
- Nickname is the only display identity. Solver payloads use generated
  pseudonymous IDs, but the current importer derives them from period plus
  nickname and the persistence bridge maps by normalized nickname. Duplicate
  nicknames are rejected. Stable identity across renames is future work.
- The solver never calls an LLM and never needs an OpenAI key. AI interpretation
  and explanation belong in the application layer and should receive only the
  minimum pseudonymized structured data.

## Weekend and fairness

- Weekend means Saturday and Sunday (`weekday` 5 and 6).
- Fairness is measured within skill levels, not globally, because skill minimums
  require different workloads across groups.
