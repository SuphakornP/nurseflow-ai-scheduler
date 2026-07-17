# Devpost Demo Recording Runbook

Use this runbook to produce the required public YouTube demo and supporting images without exposing staff data, secrets, or repeatedly consuming OpenAI credits.

## Capture guardrails

- Use only the built-in synthetic MICU dataset. Do not show the real Google Sheet URL, employee codes, notes, browser history, terminal environment, or Supabase records containing real pseudonyms.
- Rehearse with `OPENAI_API_KEY` unset so normalization and explanations use deterministic fallbacks. For the final take, enable the key only if a live GPT-5.6 interaction materially improves the demo.
- If showing live AI with the built-in dataset, make one explanation request in the final take. A normalization request is needed only if a separate privacy-reviewed synthetic import is recorded. Solver generation and Excel export are local and do not use OpenAI credits.
- Hide notifications, password managers, developer tools, and browser autofill. Use a throwaway admin account and verify every frame before publishing.
- Keep the OpenAI Build Week submission unsubmitted. Recording and uploading media do not authorize submission.

## Manual infeasibility check

Use a synthetic fixture if this behavior is shown publicly. When fixed VAC/ED
events leave fewer qualified staff than the Day + Night skill minimum, Compare
must show `INFEASIBLE`, the affected date/skill capacity, and disabled
Confirm/Export controls. Preserve VAC; add a qualified relief nurse or formally
correct the ED approval in the source fixture, then re-import. Never present an
invalid workbook as an acceptable roster.

## Three-minute shot and voiceover plan

| Time | Screen | Voiceover focus |
| --- | --- | --- |
| `0:00-0:15` | Login and product title | ICU scheduling problem and accountable human decision-maker |
| `0:15-0:38` | Reload built-in synthetic demo | Pseudonymous intake; employee-code and notes columns are discarded |
| `0:38-1:08` | Compare generated candidates | Three CP-SAT profiles and independent hard-rule validation |
| `1:08-1:33` | Explain one outcome | One bounded GPT-5.6 explanation from structured solver evidence |
| `1:33-1:58` | Evidence and metrics | Request satisfaction, coverage, skill mix, and assignment reasons |
| `1:58-2:18` | Confirm and export | Fail-closed confirmation, optional persisted history, and workbook export |
| `2:18-2:42` | Architecture or README | Exact roles of Codex and GPT-5.6 |
| `2:42-2:50` | Product close | Faster reconciliation without autonomous staffing decisions |

This plan records the built-in synthetic dataset. It can demonstrate the
evidence-explanation path, but not ambiguous-token normalization because the demo
snapshot is already normalized. If import footage is important, prepare a
separate synthetic MICU-format Sheet or workbook with an ambiguous token and
privacy-review it before recording; never open the real request form on screen.

### Narration draft

Nurse scheduling combines coverage, skill mix, leave, prior shifts, and individual requests. NurseFlow AI helps an experienced scheduler reconcile those inputs without handing the final decision to a model.

The app can import a pseudonymous request sheet. The supplied MICU layout is supported, but employee codes and notes are dropped during import. Known request notation is parsed deterministically. When a token is ambiguous, GPT-5.6 uses Structured Outputs to suggest a bounded interpretation, and the administrator must review it. Approved Vacation and non-L0 Education are fixed, O/D and O/N are required choices, and the remaining nurse requests are soft.

After review, a private FastAPI service runs Google OR-Tools CP-SAT to create three candidates: request-first, balanced, and reduced Member L0 utilization. GPT-5.6 does not generate the roster. Fixed events, required choices, staffing, skill mix, and sequence safety remain hard constraints. A separate deterministic validator recomputes those rules and assignment completeness for every candidate.

The workspace makes trade-offs visible. Fixed-event and required-choice evidence is shown separately from soft-request satisfaction, so the scheduler can inspect workload trade-offs without hiding mandatory inputs inside an aggregate. Confirm and export are fail-closed: only a `VALID` result with non-empty, all-passing hard-validation evidence can proceed. The chosen version is exported as a formula-safe workbook and, when Supabase has a matching staged roster, recorded as immutable schedule history.

Codex accelerated the cross-stack implementation, architecture review, authentication, security hardening, tests, browser QA, and documentation. GPT-5.6 is deliberately limited to ambiguous-language interpretation and evidence-grounded explanations. Constraint solving decides feasibility, independent validation checks correctness, and a human remains accountable.

NurseFlow turns a difficult spreadsheet workflow into a reviewable decision-support process while keeping privacy and safety boundaries visible.

## Submission media

The prepared 3:2 JPG assets below came from a clean synthetic run and were
reviewed at full resolution. Devpost upload remains a manual owner action.

| Asset | Prepared file |
| --- | --- |
| Thumbnail candidate | [`04-candidate-comparison.jpg`](screenshots/04-candidate-comparison.jpg) |
| Synthetic intake | [`01-synthetic-demo-import.jpg`](screenshots/01-synthetic-demo-import.jpg) |
| Request-policy review | [`02-request-review.jpg`](screenshots/02-request-review.jpg) |
| Candidate generation | [`03-candidate-generation.jpg`](screenshots/03-candidate-generation.jpg) |
| Preserved-VAC evidence | [`05-roster-evidence.jpg`](screenshots/05-roster-evidence.jpg) |
| Hard validation and profiles | [`06-hard-validation.jpg`](screenshots/06-hard-validation.jpg) |
| Fail-closed confirmation/export | [`07-confirm-export.jpg`](screenshots/07-confirm-export.jpg) |

For a compact Devpost set, use the thumbnail candidate plus synthetic intake,
preserved-VAC evidence, hard validation, and confirmation/export. Existing
ignored mobile QA captures are not submission assets.

## Final upload QA

- Video is public on YouTube, shorter than 3:00, and has intelligible voiceover.
- Voiceover explicitly covers what was built, how Codex was used, and how GPT-5.6 was used.
- No employee code, real nickname, note, secret, private URL, or credential appears in video, captions, thumbnail, or screenshots.
- Repository and demo links work in a signed-out browser; judge credentials exist only in Devpost's private field.
- The final Devpost submit action remains reserved for the owner's review.
