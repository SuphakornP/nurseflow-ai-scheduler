# OpenAI Build Week - Devpost Submission Worksheet

> Live requirements and project/submission state rechecked through the Devpost Hackathons connector on 2026-07-16. This is a preparation document only: do not submit the project until the owner completes the final review. Never put credentials or real staff data in this repository.

## Submission snapshot

| Item | Current value |
| --- | --- |
| Devpost project | [NurseFlow AI](https://devpost.com/software/ai-nurse-shift-schedules) |
| Project page state | `published` after the prepared fields were saved |
| Hackathon submission | **Unsubmitted** (`submitted_at` is still empty) |
| Track | **Work & Productivity** |
| Repository | https://github.com/SuphakornP/nurseflow-ai-scheduler |
| Deadline | **Tuesday, July 21, 2026 at 5:00 PM PT** / **July 22 at 7:00 AM ICT** |
| Demo video | Required: public YouTube, under 3 minutes, with voiceover |
| Website | Optional |
| Zip file | Not required |

NurseFlow belongs in Work & Productivity because it improves a real operational workflow for clinical scheduling teams. It reduces manual request reconciliation while preserving accountable human approval; it is not patient-facing medical advice.

## Copy-ready project fields

### Name

`NurseFlow AI`

### Tagline

`Turn nurse requests into validated, explainable ICU schedule candidates with human approval built in.`

### Built with

`GPT-5.6`, `Codex`, `OpenAI Responses API`, `Next.js`, `React`, `TypeScript`, `FastAPI`, `Python`, `Google OR-Tools CP-SAT`, `Supabase`, `Zod`, `ExcelJS`, `Vitest`, `pytest`

### Project description

```markdown
## Inspiration

Nurse schedules are high-stakes operational documents assembled from staffing rules, skill mix, leave, education, and individual requests. The work is repetitive, difficult to audit, and still requires an experienced human decision-maker. We built NurseFlow AI to make that workflow faster and more explainable without pretending AI should make the final staffing decision.

## What it does

NurseFlow imports pseudonymous nurse request sheets, normalizes ambiguous request values for human review, and creates multiple ICU roster candidates. It supports the supplied MICU form while discarding employee codes and notes before the normalized dataset reaches the browser workflow, solver, OpenAI, or exports. Every candidate is checked by an independent validator against coverage, skill-mix, request, sequence, and workload constraints. Schedulers can compare trade-offs, inspect assignment evidence, confirm one version, and export a review-ready workbook. When Supabase has a matching staged period roster, confirmation also saves an immutable schedule-version history.

The application is admin-only. Public examples use synthetic nicknames and no patient data. The configured administrator email is never written to scheduling records.

## How we built it

The interface and server boundary use Next.js, React, and TypeScript. A private FastAPI service models the roster with Google OR-Tools CP-SAT. Supabase stores confirmed versions and validation evidence, while ExcelJS and openpyxl produce exports.

GPT-5.6 is used through the OpenAI Responses API with Structured Outputs to suggest normalization for ambiguous request tokens and to explain solver evidence. It does **not** generate the roster: CP-SAT creates assignments, a separate deterministic validator checks them, and a human scheduler approves the result.

Codex accelerated architecture exploration, implementation across TypeScript and Python, admin authentication, security hardening, test generation, browser QA, documentation, and release preparation. We used Codex to challenge design decisions and verify boundaries rather than simply generate an unchecked prototype.

## Challenges

The hardest part was keeping feasibility, privacy, and explainability aligned. We had to encode real scheduling constraints, bound every import and solver input, distinguish AI suggestions from deterministic decisions, and make complex trade-offs readable in one workspace.

## Accomplishments

- End-to-end prototype path for import, review, optimization, validation, comparison, confirmation, and export
- Immutable candidate history when Supabase has a matching staged period roster
- Independent validation of every generated candidate
- Admin-only JWT session and protected server-to-server solver boundary
- Formula-safe spreadsheet exports and bounded runtime inputs
- 117 web test cases, 58 solver tests, clean dependency audits, and responsive browser QA
- Public, reproducible repository with synthetic pseudonymous sample data

## What we learned

AI is most useful here at the ambiguous edges: interpreting messy request notation and translating structured evidence into clear explanations. Constraint solving and validation remain the right tools for schedule correctness, while the final decision remains human.

## What's next

Before any hospital pilot, we would move identity to managed authentication with MFA, add shared abuse controls and session revocation, introduce stable pseudonymous employee identity and transactional roster synchronization, harden deployment and spreadsheet decompression limits, and validate the workflow with real scheduling teams under an approved privacy and governance process.
```

## Required submission questions

| Field ID | Devpost field | Prepared answer or owner action |
| --- | --- | --- |
| `27945` | Submitter Type | **Owner input required:** Individual / Team of Individuals / Organization |
| `27946` | Country of Residence | **Owner input required:** select the legal country of residence and reconfirm eligibility |
| `27947` | Category | `Work & Productivity` |
| `27948` | Code repository | `https://github.com/SuphakornP/nurseflow-ai-scheduler` |
| `27949` | Judge test URL and instructions | Optional private field; use the template below |
| `27950` | `/feedback` Session ID | **Required owner action:** run `/feedback` in the primary Codex task and paste the returned ID |
| `27951` | Plugin/developer-tool instructions | `Not applicable - NurseFlow is a web application.` |

### Private judge instructions (`27949`)

Complete this only in Devpost's judge-only field. Do not commit the URL's credentials here.

```text
Demo URL: [ADD DEPLOYED URL, OR STATE THAT JUDGES SHOULD RUN LOCALLY]

Local setup:
1. Copy .env.example to .env.local and services/solver/.env.example to services/solver/.env.local.
2. Set ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_DISPLAY_NAME, and a random AUTH_SECRET in the root file.
3. Set one separate random SOLVER_API_TOKEN in both files. OpenAI and Supabase are optional for the local fallback path.
4. Run npm ci and uv sync --directory services/solver --extra dev --locked.
5. Run npm run dev:all and open http://localhost:3000.

Judge-only admin email: [ENTER ONLY IN DEVPOST]
Judge-only admin password: [ENTER ONLY IN DEVPOST]

Use the built-in synthetic MICU dataset. No patient data or real staff identities are required.
```

## Demo and judging plan

Follow the [demo recording runbook](devpost-demo-runbook.md) for the exact voiceover, privacy checks, media shot list, and low-credit recording workflow.

| Criterion | Evidence to emphasize |
| --- | --- |
| Technological Implementation | Cross-stack build, CP-SAT model, independent validator, strict auth boundaries, tests, and audits |
| Design | Complete clinical workspace with progressive workflow, comparison surface, responsive UI, and accessible login |
| Potential Impact | Less manual reconciliation for nurse schedulers while preserving accountable human approval |
| Quality of the Idea | Deliberate separation of LLM interpretation, deterministic optimization, independent validation, and human judgment |

## Tomorrow review checklist

- [x] Public repository includes a relevant MIT license.
- [x] Live Devpost project page has the project name, tagline, description, Built With list, and repository URL.
- [x] OpenAI Build Week submission remains unsubmitted; no submit action was called.
- [x] README explains setup, sample data, Codex, and GPT-5.6 usage.
- [x] Submission copy, judge instructions template, demo script, and credit-safe CI are prepared.
- [ ] Confirm submitter type and country of residence; add any team members and wait for their invitations to be accepted.
- [ ] Retrieve the primary Codex `/feedback` Session ID.
- [ ] Decide between a deployed judge URL and local setup; add throwaway credentials only to field `27949`.
- [ ] Capture a privacy-reviewed thumbnail and 3-4 supporting screenshots using only synthetic data, then upload them to Devpost.
- [ ] Record and publish the voiced, under-three-minute public YouTube demo, then attach its URL to the project.
- [ ] Recheck the repo, video, and optional demo URL in a signed-out browser.
- [ ] Perform the owner's final content and eligibility review.
- [ ] Submit the entry and verify the hackathon `submitted_at` value is populated. **Do not perform this step during preparation.**

## Official references

- [OpenAI Build Week](https://openai.devpost.com/)
- [Official rules](https://openai.devpost.com/rules)
- [Current Devpost project](https://devpost.com/software/ai-nurse-shift-schedules)
- [Public repository](https://github.com/SuphakornP/nurseflow-ai-scheduler)
