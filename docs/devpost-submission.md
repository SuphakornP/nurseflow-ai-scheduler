# OpenAI Build Week — Devpost Submission Worksheet

> Prepared from the live Devpost requirements on 2026-07-16. Recheck the [hackathon page](https://openai.devpost.com/) and [official rules](https://openai.devpost.com/rules) before submitting. Do not place real credentials or secrets in this repository.

## Submission snapshot

| Item | Value |
| --- | --- |
| Devpost project | [AI NurseFlow](https://devpost.com/software/ai-nurse-shift-schedules) |
| Current state | `submission_draft` |
| Recommended title | **NurseFlow AI** |
| Recommended track | **Work & Productivity** |
| Repository | https://github.com/SuphakornP/nurseflow-ai-scheduler |
| Deadline | **July 21, 2026 at 5:00 PM PT** / **July 22 at 7:00 AM ICT** |
| Demo video | Required: public YouTube, under 3 minutes, with voiceover |
| Website | Optional |

### Why Work & Productivity

NurseFlow improves a real operational workflow for clinical scheduling teams. Its main value is reducing manual request reconciliation, producing comparable schedule candidates, and preserving human approval—not providing patient-facing health advice.

## Project fields

### Name

`NurseFlow AI`

### Tagline

`Turn nickname-only nurse requests into validated, explainable ICU schedule candidates—with human approval built in.`

### Built with

`GPT-5.6`, `Codex`, `OpenAI Responses API`, `Next.js`, `React`, `TypeScript`, `FastAPI`, `Python`, `Google OR-Tools CP-SAT`, `Supabase`, `Zod`, `ExcelJS`, `Vitest`, `pytest`

### Project description draft

```markdown
## Inspiration

Nurse schedules are high-stakes operational documents assembled from staffing rules, skill mix, leave, education, and individual requests. The work is repetitive, difficult to audit, and still requires an experienced human decision-maker. We built NurseFlow AI to make that workflow faster and more explainable without pretending AI should make the final staffing decision.

## What it does

NurseFlow imports a nickname-only request sheet, normalizes ambiguous request values for human review, and creates multiple ICU roster candidates. Every candidate is checked by an independent validator against coverage, skill-mix, request, sequence, and workload constraints. Schedulers can compare trade-offs, inspect assignment evidence, confirm one version, save immutable history, and export a review-ready workbook.

The application is admin-only. It rejects explicit full-name columns, uses synthetic showcase data, and keeps the configured administrator email out of scheduling records.

## How we built it

The interface and server boundary use Next.js, React, and TypeScript. A private FastAPI service models the roster with Google OR-Tools CP-SAT. Supabase stores confirmed versions and validation evidence, while ExcelJS and openpyxl produce exports.

GPT-5.6 is used through the OpenAI Responses API with Structured Outputs to suggest normalization for ambiguous request tokens and to explain solver evidence. It does **not** generate the roster: CP-SAT creates assignments, a separate deterministic validator checks them, and a human scheduler approves the result.

Codex accelerated architecture exploration, implementation across TypeScript and Python, admin authentication, security hardening, test generation, browser QA, documentation, and release preparation. We used Codex to challenge design decisions and verify boundaries rather than simply generate an unchecked prototype.

## Challenges

The hardest part was keeping feasibility, privacy, and explainability aligned. We had to encode real scheduling constraints, bound every import and solver input, preserve immutable requests, distinguish AI suggestions from deterministic decisions, and make complex trade-offs readable in one workspace.

## Accomplishments

- End-to-end import, review, optimize, validate, compare, confirm, persist, and export workflow
- Independent validation of every generated candidate
- Admin-only JWT session and protected server-to-server solver boundary
- Formula-safe spreadsheet exports and bounded runtime inputs
- 61 web tests, 58 solver tests, clean dependency audits, and responsive browser QA
- Public, reproducible repository with synthetic nickname-only sample data

## What we learned

AI is most useful here at the ambiguous edges: interpreting messy request notation and translating structured evidence into clear explanations. Constraint solving and validation remain the right tools for schedule correctness, while the final decision remains human.

## What's next

Before any hospital pilot, we would move identity to managed authentication with MFA, add shared abuse controls and session revocation, harden deployment and spreadsheet decompression limits, and validate the workflow with real scheduling teams under an approved privacy and governance process.
```

## Required submission questions

| Field ID | Devpost field | Prepared answer |
| --- | --- | --- |
| `27945` | Submitter Type | `[CONFIRM: Individual / Team of Individuals / Organization]` |
| `27946` | Country of Residence | `[CONFIRM COUNTRY; verify eligibility in official rules]` |
| `27947` | Category | `Work & Productivity` |
| `27948` | Code repository | `https://github.com/SuphakornP/nurseflow-ai-scheduler` |
| `27949` | Judge test URL and instructions | Use the template below; enter credentials only in Devpost's private field |
| `27950` | `/feedback` Session ID | `[REQUIRED: run /feedback in the primary Codex task and paste the ID]` |
| `27951` | Plugin/developer-tool instructions | `Not applicable — NurseFlow is a web application.` |

### Private judge instructions template (`27949`)

Do not commit completed credentials here. Paste the finished version directly into Devpost:

```text
Demo URL: [ADD DEPLOYED URL, OR STATE THAT JUDGES SHOULD RUN LOCALLY]

Local setup:
1. Copy .env.example to .env.local and services/solver/.env.example to services/solver/.env.local.
2. Use the same SOLVER_API_TOKEN in both files.
3. Run npm install and uv sync --directory services/solver --extra dev.
4. Run npm run dev:all and open http://localhost:3000.

Judge-only admin email: [ENTER ONLY IN DEVPOST]
Judge-only admin password: [ENTER ONLY IN DEVPOST]

Use the built-in synthetic MICU dataset. No patient data or real staff identities are required.
```

## Demo video plan (maximum 3 minutes)

| Time | Content |
| --- | --- |
| `0:00–0:20` | Problem: request sheets, hard constraints, and manual audit burden |
| `0:20–0:40` | Admin checkpoint and nickname-only privacy boundary |
| `0:40–1:10` | Import and human review of ambiguous request values |
| `1:10–1:45` | Generate three CP-SAT candidates and show independent validation |
| `1:45–2:15` | Compare trade-offs and inspect assignment evidence |
| `2:15–2:35` | Confirm, persist history, and export the workbook |
| `2:35–2:55` | Explain Codex's build role and GPT-5.6's bounded runtime role |
| `2:55–3:00` | Human-in-the-loop impact statement |

The voiceover must explicitly cover **what was built**, **how Codex was used**, and **how GPT-5.6 was used**. A music-only screencast does not meet the requirement.

## Judging alignment

| Criterion | Evidence to emphasize |
| --- | --- |
| Technological Implementation | Cross-stack build, CP-SAT model, independent validator, strict auth boundaries, tests, and audits |
| Design | Complete clinical workspace with progressive workflow, comparison surface, responsive UI, and accessible login |
| Potential Impact | Less manual reconciliation for nurse schedulers while preserving accountable human approval |
| Quality of the Idea | Deliberate separation of LLM interpretation, deterministic optimization, independent validation, and human judgment |

## Submission blockers and checklist

- [x] Add a relevant open-source `LICENSE` to the public repository.
- [ ] Confirm submitter type and country of residence against the official rules.
- [ ] Rename the Devpost project to `NurseFlow AI` and replace the current tagline.
- [ ] Add the project description and Built With technologies.
- [ ] Record and publish the under-three-minute YouTube demo with required voiceover.
- [ ] Retrieve the primary Codex `/feedback` Session ID.
- [ ] Decide whether judges use a deployed URL or local setup.
- [ ] If deployed, provide throwaway judge credentials only in Devpost field `27949`.
- [ ] Add a strong thumbnail and supporting screenshots on Devpost.
- [x] Verify the README clearly identifies where Codex and GPT-5.6 were used.
- [ ] Add every teammate and wait for invitations to be accepted, if applicable.
- [ ] Recheck links, video visibility, and repository access in a signed-out browser.
- [ ] Submit the entry; confirm it is no longer saved as a draft.

## Official references

- [OpenAI Build Week](https://openai.devpost.com/)
- [Official rules](https://openai.devpost.com/rules)
- [Current Devpost project](https://devpost.com/software/ai-nurse-shift-schedules)
- [Public repository](https://github.com/SuphakornP/nurseflow-ai-scheduler)
