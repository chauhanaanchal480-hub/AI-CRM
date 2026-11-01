# AI-CRM Phase 0 Baseline

**Snapshot date:** 2026-08-17

**Phase:** 0 — Baseline & Product Definition

**Status:** COMPLETE

**Evidence rule:** a source inspection is not treated as a passing runtime test. Statuses below are based on the evidence recorded in this snapshot.

## 1. Frozen Git state

| Item | Value |
|---|---|
| Branch | `main` |
| Commit | `444fa3474c291fd058a476c862ada1322805995f` (`444fa34`) |
| Commit message | `fix web typing and Playwright server setup` |
| Tag at commit | None |
| Remote relation | `main` is one commit ahead of `origin/main` |
| Pre-existing worktree state | `.claude/` and `docs/AI_CRM_PROFESSIONAL_PRODUCT_ROADMAP.md` were untracked before this Phase 0 documentation work |

This document and the decision log are documentation outputs; they do not change the frozen application commit.

## 2. Repository inventory

### Runtime and boundaries

- **Web:** React + TypeScript + Vite, with React Router, TanStack Query, Zustand, Tailwind, and reusable UI components under `web/src`.
- **API:** Node.js + Express + TypeScript under `server/src`; routes are mounted from `server/src/routes/index.ts` beneath `/api` and `/api/v1`.
- **Persistence:** PostgreSQL through Prisma (`server/prisma/schema.prisma`), with migrations and database-security helpers under `server/prisma` and `server/src/database`.
- **Cache and queues:** Redis/ioredis cache (`server/src/performance/cache.ts`) and BullMQ queues/workers (`server/src/performance`, `server/src/worker.ts`). Queues are `ai`, `export`, and `cleanup`; Redis-disabled operation falls back to inline/database behavior.
- **Uploads/exports:** Local filesystem storage configured by `UPLOAD_DIR`; exports use temporary prepared files and streamed responses.
- **Deployment shape:** `docker-compose.yml` defines PostgreSQL, Redis, API, worker, and web services, with persistent volumes for database, Redis, uploads, and exports.

### Frontend flows

Implemented pages and flows include login/registration/MFA, dashboard, customers and customer detail, leads, deals/pipeline, tasks, analytics, profile, settings/user administration, notifications, AI assistance, uploads, and exports. Primary evidence is `web/src/pages`, `web/src/hooks`, `web/src/components`, `web/src/store`, and the Playwright suites in `web/tests`.

### API modules

The mounted module routers are:

| Module | Route source | Main capabilities |
|---|---|---|
| Auth | `server/src/modules/auth/auth.routes.ts` | registration, login, refresh/logout, password change, MFA, step-up, sessions |
| Users | `server/src/modules/users/users.routes.ts` | current profile and role/user administration |
| Customers | `server/src/modules/customers` | list/search/filter, CRUD, detail, notes, activities, emails, uploads |
| Leads | `server/src/modules/leads` | CRUD, filtering/pagination, conversion and assignment |
| Deals | `server/src/modules/deals` | CRUD, pipeline board, stage movement |
| Tasks | `server/src/modules/tasks` | CRUD, status/priority/scope |
| Activities | `server/src/modules/activities` | activity logging and listing |
| Notes | `server/src/modules/notes` | customer notes |
| Emails | `server/src/modules/emails` | email-log recording/listing |
| AI | `server/src/modules/ai` | summaries, follow-ups, email drafts, meeting summaries, lead scoring |
| Analytics | `server/src/modules/analytics` | dashboard, trend, stage/source aggregations |
| Exports | `server/src/modules/export` | authenticated customer/lead/deal PDF and Excel exports |
| Uploads | `server/src/modules/uploads` | authenticated upload and attachment deletion |
| Audit | `server/src/modules/audit` | authenticated audit-log search/pagination |
| Notifications | `server/src/modules/notifications` | notification listing/read/clear |
| Performance | `server/src/modules/performance` | operational cache/queue status |

Cross-cutting middleware includes authentication, role authorization, request IDs, validation, structured errors, rate limiting, abuse detection, HMAC request signing, idempotency, origin validation, audit logging, compression, and security headers (`server/src/middleware`, `server/src/app.ts`).

### Data model

The Prisma schema contains users, refresh tokens, sessions, password history, MFA challenges/recovery/trusted devices, login history, audit logs, API nonces/idempotency records, customers, leads, pipelines/stages, deals, tasks, activities, notes, email logs, attachments, notifications, AI insights, and retention runs. Seed data is in `server/prisma/seed.ts`. There is no separate repository abstraction; services access Prisma directly.

### Integrations and providers

- PostgreSQL/Prisma and Redis/BullMQ are runtime dependencies.
- AI provider abstraction supports mock, OpenAI, Anthropic, and Gemini implementations under `server/src/services/ai`.
- Email is represented as an application email log; no outbound mail transport is configured.
- PDF/Excel generation is local/server-side.

### Tests and verification evidence

- Server database-security tests: **7/7 passed**.
- Server performance tests: **3/3 passed**.
- Server and web production builds: **passed**.
- Playwright: broad coverage exists across 24 spec files, but the latest existing August 17 artifact records a failed run. It was not rerun against the shared configured backend/database, so the suite is **not classified as current-green**.
- No application implementation files were changed for this baseline.

## 3. Feature matrix

Status meanings: **IMPLEMENTED** means present and supported by the available evidence; **PARTIAL** means meaningful implementation exists but an explicit gap remains; **BROKEN** means an existing path is known not to meet its intended behavior; **MISSING** means no repository implementation was found; **DEFERRED** means deliberately outside this phase or roadmap scope.

| Capability | Status | Evidence and boundary |
|---|---|---|
| Authentication, sessions, refresh rotation, MFA and step-up | IMPLEMENTED | Auth services/routes, session schema, MFA UI, authentication/security Playwright coverage; full production lifecycle still needs independent validation. |
| Core customer/lead/deal/task CRUD | IMPLEMENTED | Prisma models, route/controller/service layers, frontend hooks/pages, CRUD Playwright suites. |
| Search, filtering, pagination and dashboard analytics | IMPLEMENTED | Query validation, bounded list endpoints, analytics services and UI; load limits are not production-measured. |
| Role and ownership authorization | PARTIAL | `authenticate`/`authorize` and per-resource scope checks exist, but policy coverage is not centralized or proven complete for every child/resource path. |
| API envelopes, validation, request IDs and security boundary | PARTIAL | Implemented in middleware and `apiResponse`; OpenAPI exists, but the written API reference and all route semantics are not fully synchronized. |
| Idempotency and retry-safe operations | PARTIAL | Idempotency middleware and queue retry controls exist; comprehensive duplicate-action coverage is not established. |
| Database security, encryption controls and retention | IMPLEMENTED | Security migrations, roles, field-security/query-monitoring tests, encrypted backup/retention modules. Restore and operational retention runs are not demonstrated. |
| Cache, queues and workers | IMPLEMENTED | Redis cache degradation path, BullMQ queues, encrypted queue envelopes, workers, dead-letter handling and performance tests. |
| Attachments and file validation | PARTIAL | Size/MIME/extension/content, double-extension and blocked-extension checks are implemented; files are still served by a public static `/uploads` mount and download authorization/parent checks are not an API operation. |
| PDF/Excel exports | IMPLEMENTED | Authenticated, rate-limited, bounded entity routes with streamed temporary files; operational capacity limits are not load-tested. |
| AI summaries, follow-ups, scoring and drafting | PARTIAL | Four providers, prompt/parsing layer, caching, queue integration and UI/tests exist; provider privacy/retention, cost/usage bounds, provenance, and full prompt-injection defense are not complete. |
| Audit trail | IMPLEMENTED | Audit middleware/service, database model, routes, masking and Playwright coverage. |
| Observability and operations | PARTIAL | Structured logger, request IDs, audit separation and `/health` exist; dependency-aware readiness, metrics, dashboards and alerts are missing. |
| Accessibility and UX quality | PARTIAL | Shared labels, focusable controls and some ARIA support exist; no automated accessibility suite or documented manual keyboard audit was found. |
| CI/CD release gates | PARTIAL | Playwright workflow and build/test scripts exist; a complete required security/dependency/secret/release gate is not established. |
| Staging, production deployment and secret operations | PARTIAL | Docker production-shaped compose and environment validation exist; managed secret storage, rotation, isolated staging, and controlled deployment/migration runbooks are not documented. |
| Backup restoration and disaster recovery | PARTIAL | Encrypted backup code exists; successful restore demonstration, RPO/RTO, and recovery runbook are missing. |
| Later roadmap phases (1–17 implementation) | DEFERRED | No Phase 1 or later implementation is authorized by this baseline task. |

No separate feature was classified BROKEN solely from a stale document or an unisolated Playwright artifact; those are recorded as evidence/gap conditions instead.

## 4. Non-functional baseline

| Area | Current status | Remaining baseline gap |
|---|---|---|
| Security | Strong middleware/database/upload/session foundations and passing focused security tests | Public attachment serving, authorization-policy completeness, AI data handling, and independent red-team validation remain open. |
| Reliability | Structured errors, request IDs, idempotency, queue retries/dead letters, and dependency degradation paths exist | No complete dependency-failure matrix, SLOs, or duplicate-action proof. |
| Performance | Index migrations, bounded list queries, compression, caching, streaming exports and workers exist | No measured latency/throughput targets or load-test operating limits. |
| Accessibility | Some semantic labels/ARIA/focus behavior are present | No axe/Lighthouse-equivalent automation or manual keyboard/screen-reader sign-off. |
| Availability | Docker restart policies, health endpoint, Redis fallback and worker separation exist | `/health` is not a full readiness check; no HA, alert ownership, RTO/RPO, or tested restore. |

## 5. Environments

| Environment | Evidence | Baseline classification |
|---|---|---|
| Development | Workspace scripts, local `.env`, `server/.env.example`, `web/.env.example`, Vite/tsx dev commands | PRESENT |
| Test | Server test scripts and Playwright config; Playwright points at a configured running API/database rather than a documented isolated test stack | PRESENT but shared-state isolation UNKNOWN |
| Staging | No distinct staging compose, env contract, deployment configuration, or runbook found | MISSING/UNKNOWN |
| Production | Docker compose sets `NODE_ENV=production` and includes API/worker/web/db/Redis services; secrets and deployment controls remain environment-dependent | PARTIAL |

## 6. Documentation drift and known unknowns

- `README.md` documents only three AI provider choices while the code also supports Gemini.
- `README.md` describes email as logging only; the application also exposes AI email drafting, while no outbound transport was found.
- `docs/API.md` is useful for the common envelope but is not an authoritative exhaustive route contract.
- Runtime production behavior, staging configuration, managed secrets, restore procedures, and alerting ownership are not verifiable from this repository.
- The Playwright failure artifact does not, by itself, establish which product assertions failed; it is retained as a test-status gap.

## Exit-criteria assessment

Phase 0 is COMPLETE for the frozen commit:

- The baseline matches the inspected repository and records the exact Git state.
- Every major capability has an explicit status and evidence boundary.
- Unknowns and documentation drift are explicit rather than inferred.
- The final check found no application-code changes; only the two Phase 0 documents were added by this continuation.
- Phase 1 and all later implementation remain unstarted and unauthorized by this work.
