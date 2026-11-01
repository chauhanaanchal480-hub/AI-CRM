# AI-CRM Phase 0 Decision Log

This log records decisions made during the Phase 0 baseline so later sessions do not repeat discovery or treat assumptions as facts.

| ID | Decision | Evidence / consequence |
|---|---|---|
| D-000 | Freeze the baseline at commit `444fa3474c291fd058a476c862ada1322805995f` on `main`. | No tag points at the commit; `main` is one commit ahead of `origin/main`. |
| D-001 | Preserve pre-existing untracked state. | `.claude/` and `docs/AI_CRM_PROFESSIONAL_PRODUCT_ROADMAP.md` existed before this documentation output. |
| D-002 | Phase 0 is documentation-only. | No application behavior, schema, tests, dependencies, or deployment code is changed by this work. |
| D-003 | Use five explicit feature statuses: IMPLEMENTED, PARTIAL, BROKEN, MISSING, DEFERRED. | Status requires repository evidence; code presence alone is not proof of a complete feature. |
| D-004 | Separate “code-inspected” from “runtime-verified.” | Builds and focused server suites were run; the shared-state Playwright suite was not treated as a fresh pass. |
| D-005 | Record the Playwright artifact as a test-status gap, not as a new product defect list. | The artifact records a failed run but does not safely establish isolated failure causes. |
| D-006 | Treat the public `/uploads` static mount as a Phase 0 security gap. | Upload validation is strong, but attachment URL access is not mediated by a parent-record authorization check. |
| D-007 | Treat authorization, API contract synchronization, AI privacy/safety, observability, accessibility, deployment, and DR as partial rather than complete. | Relevant code exists, but the roadmap exit criteria require broader policy, operational, or negative-test evidence. |
| D-008 | Do not start Phase 1 or later phases. | Architecture changes and remediation are outside the authorized Phase 0 continuation. |
| D-009 | Keep existing documentation drift visible. | README/API documentation is not silently “corrected” during baseline capture; discrepancies are listed for a later authorized task. |
| D-010 | The documentation-only verification passed. | Both Phase 0 documents contain the required sections, have no trailing-whitespace errors, and no application files changed. |
| D-011 | Mark Phase 0 COMPLETE at the frozen commit. | The roadmap exit criteria are satisfied by `PHASE_0_BASELINE.md`; Phase 1 was not started. |

## Handoff

The prior session completed discovery and classification and stopped while this log and `PHASE_0_BASELINE.md` were still unwritten. This continuation wrote and verified those two artifacts. Phase 0 is complete at the frozen commit; Phase 1 has not started.
