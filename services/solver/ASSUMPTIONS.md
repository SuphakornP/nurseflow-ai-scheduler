# Scheduling assumptions

These decisions make the source business rules executable for the Build Week MVP.
They are deliberately isolated in the API model so that a hospital reviewer can
change them later without asking an LLM to rewrite the schedule directly.

## Hard rules

- `D`, `N`, `VAC`, and `ED` in the current-period input are immutable assignments.
- `O/D` (`D/O`) allows only `OFF` or `D`; `O/N` (`N/O`) allows only `OFF` or `N`.
- Blank input allows `D`, `N`, or `OFF`.
- Day staffing is exactly 10 and Night staffing is exactly 9.
- The published skill ranges apply independently to Day and Night.
- The canonical trainee skill code is `TRAINEE_INC`, matching the shared app and
  database contract.
- Member L0 counts toward total staffing and may work at most seven clinical
  shifts in the period.
- D and N runs, total clinical runs, N-to-D, and N-to-ED use provided previous
  assignments. Missing history breaks a run rather than being guessed.
- OFF/VAC runs are checked inside the generated period only because the source
  requirement asks previous-month context specifically for D and N rules.
- Vacation is never relaxed. A Vacation block that itself conflicts with the
  seven-day OFF/VAC limit makes the problem infeasible.

## Soft rules and optimization order

OFF optimization is lexicographic. Each completed phase is frozen before the next:

1. Maximize O1 satisfaction.
2. Maximize O2 satisfaction.
3. Maximize O3 satisfaction.
4. Maximize O4 satisfaction.
5. Optimize the remaining soft goals with the selected profile:

   - `balanced` emphasizes Day/Night and weekend fairness.
   - `requests_first` emphasizes adjacent OFF/VAC blocks.
   - `minimize_l0` places the strongest penalty on Member L0 clinical use.

The profile score also rewards weekday ED for Member L0. Profile weights never
change the frozen O1 through O4 satisfaction counts.

When a phase reaches only `FEASIBLE` before its time limit, the best value found is
frozen and reported as not proven optimal. This is transparent in `phases`.
CP-SAT uses eight search workers for responsive 28x31 generation. The demo input
and random seed are deterministic; assignments are persisted as the version source
of truth rather than regenerated when an existing version is exported.

The source rule about cutting at most one day from a long OFF block is not treated
as a hard constraint in this MVP because its scope (per block, person, or month)
is not defined. OFF priorities and adjacency optimization preserve these requests
as far as coverage permits, while Vacation remains hard.

## Ambiguous input and privacy

- `O1/N`, `D/N`, `D1`, `Vac1`, and unknown tokens block generation until an
  explicit human resolution is supplied.
- Common casing, whitespace, `Vac`, Thai `\u0e0aED`, `D/O`, and `N/O` variants are
  normalized deterministically.
- Thai Buddhist year 2569 is parsed as Gregorian year 2026.
- Nickname is the only display identity. Internal IDs are pseudonymous codes;
  nicknames are never used as keys because duplicates are possible.
- The solver never calls an LLM and never needs an OpenAI key. AI interpretation
  and explanation belong in the application layer and should receive only the
  minimum pseudonymized structured data.

## Weekend and fairness

- Weekend means Saturday and Sunday (`weekday` 5 and 6).
- Fairness is measured within skill levels, not globally, because skill minimums
  require different workloads across groups.
