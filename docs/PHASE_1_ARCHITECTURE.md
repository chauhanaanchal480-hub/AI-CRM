# AI-CRM Phase 1 Architecture

**Snapshot date:** 2026-08-17

**Baseline commit:** `444fa3474c291fd058a476c862ada1322805995f`

**Phase:** 1 — Architecture & Domain Boundaries

**Status:** IN PROGRESS

**Coverage:** current-state architecture plus completed Phase 1 boundary decisions and enforcement

This document records the architecture that exists in the repository and the Phase 1 boundary rules completed so far. Open work is tracked at the end. Authorization and file-access remediation assigned to later roadmap phases remain out of scope.

## 1. Runtime boundaries

| Boundary | Current responsibility | Primary evidence |
|---|---|---|
| Web application | React routes and pages render workflows; feature hooks own API calls and TanStack Query cache coordination; Zustand holds authentication and theme state. | `web/src/App.tsx`, `web/src/pages`, `web/src/hooks`, `web/src/store`, `web/src/lib/api.ts` |
| HTTP API | Express owns HTTP parsing, middleware, versioned router mounting, authentication context, validation, response serialization, and error translation. | `server/src/app.ts`, `server/src/routes/index.ts`, `server/src/middleware`, `server/src/utils` |
| Application/domain logic | Every API module places persistence and business rules behind a module service. Core CRM modules use controllers; thinner modules call their service directly from the route adapter. | `server/src/modules` |
| Persistence | A shared Prisma client provides PostgreSQL access. Prisma middleware adds field security and query monitoring. Within API modules, only service/repository files may import the client. | `server/src/lib/prisma.ts`, `server/prisma/schema.prisma`, `server/src/database` |
| Cache | Redis-backed cache helpers cache entity, analytics, and AI results; callers explicitly invalidate tags. Redis-disabled operation loads data directly. | `server/src/performance/cache.ts` and its module callers |
| Queue | BullMQ exposes `ai`, `export`, and `cleanup` queues with encrypted envelopes, retries, timeouts, retained failures, and queue health. Enqueue failure falls back to inline execution where a fallback is supplied. | `server/src/performance/queue.ts`, `server/src/performance/jobs.ts` |
| Worker | A separate process consumes all three queues. It dynamically dispatches AI work to the configured provider, export work to the export module, and cleanup work to retention/export cleanup. | `server/src/worker.ts`, `server/src/performance/workers.ts` |
| AI providers | The application depends on the `AiProvider` interface. Provider selection chooses Mock, OpenAI, Anthropic, or Gemini from configuration. | `server/src/services/ai/AiProvider.ts`, `server/src/services/ai/index.ts` |
| File storage | Uploads are written to local storage configured by `UPLOAD_DIR`; attachment metadata is persisted in PostgreSQL. Prepared exports also use local temporary storage. | `server/src/modules/uploads/uploads.routes.ts`, `server/src/modules/export/export.service.ts`, `server/src/app.ts` |
| Deployment | Docker Compose separates web, API, worker, PostgreSQL, and Redis services and supplies persistent data/upload/export volumes. | `docker-compose.yml` |

## 2. Observed execution paths

### Standard core-domain request

```text
page/component
  -> feature hook
  -> Axios client
  -> Express middleware and module router
  -> controller
  -> service
  -> Prisma / cache / shared activity service
  -> response envelope
```

Customers, Leads, Deals, and Tasks generally follow this path. Validation is performed before their controllers, and controllers translate service results through `sendSuccess`.

### Thin-module request

```text
page/component
  -> feature hook
  -> Axios client
  -> Express middleware and module router
  -> thin route adapter
  -> module service
  -> Prisma / queue adapter / shared service
  -> response envelope
```

Activities, Notes, Emails, Uploads, AI Insights, Users, Audit, and Notifications use this shape. Their route files own middleware, validated transport input, headers, and status codes; their services own persistence, business rules, and side effects.

### Queue-backed request

```text
HTTP handler/service
  -> runQueuedJob
  -> BullMQ queue
  -> separate worker
  -> AI provider or export processor
  -> BullMQ completion result
  -> waiting HTTP request
```

AI and export queue use is operationally off-process when Redis is enabled, but their public HTTP contract remains synchronous because `runQueuedJob` waits for the worker result. If Redis is disabled or enqueueing fails, the operation executes inline. Cleanup is different: it is scheduled work with no waiting HTTP request.

## 3. Current domain locations and dependencies

The “current code custodian” column describes where behavior is implemented today. It is not yet the Phase 1 target ownership decision.

| Domain | Current code custodian | Persistence | Observed dependencies and boundary crossings |
|---|---|---|---|
| Customers | `server/src/modules/customers` with route/controller/service/validation; `web/src/hooks/useCustomers.ts` and customer pages/components | `Customer` | Customer detail reads Deals, Leads, Notes, Emails, Attachments, AI Insights, Activities, and Tasks counts as one aggregate-shaped response. Writes call the shared activity service and cache invalidation. |
| Leads | `server/src/modules/leads` with route/controller/service/validation; `web/src/hooks/useLeads.ts` | `Lead` | Conversion creates a `Customer` directly in the Leads service, then updates the Lead and logs an Activity. Lead scoring is implemented in the AI route. |
| Deals | `server/src/modules/deals` with route/controller/service/validation; `web/src/hooks/useDeals.ts` | `Pipeline`, `Stage`, `Deal` | Reads related Customer, Tasks, and Attachments. Writes log Activities; won-stage movement creates a Notification. Stage movement and resequencing are transaction-owned by the Deals service. |
| Tasks | `server/src/modules/tasks` with route/controller/service/validation; `web/src/hooks/useTasks.ts` | `Task` | A Task may reference a Customer and Deal. The service owns assignment scope, completion timestamps, persistence, and cache invalidation. |
| Activities | Read API/service in `server/src/modules/activities`; write helper in `server/src/services/activity.service.ts`; customer timeline UI | `Activity` | Many domains call `logActivity`. The helper persists the Activity and invalidates Customer, Lead, AI, and analytics caches. Activity read filtering is implemented in `activities.service.ts`. |
| Notes | `server/src/modules/notes` route/service; `web/src/hooks/useInteractions.ts` | `Note` | The service verifies a Customer, writes/deletes the Note, calls the Activity service, and invalidates Customer/AI caches. Customer detail also reads Notes directly. |
| Emails | `server/src/modules/emails` route/service; `web/src/hooks/useInteractions.ts` | `EmailLog` | The service verifies a Customer, writes the EmailLog inline, and calls the Activity service. There is no outbound email transport. Customer detail and AI context read EmailLogs directly. |
| Attachments | `server/src/modules/uploads` route/service; `web/src/hooks/useInteractions.ts` | `Attachment` plus a local file | The service owns file validation/storage helpers, parent existence checks, metadata writes, deletion, and Activity creation. The route retains multipart middleware and HTTP adaptation. Customers and Deals read attachment relations directly; Express serves stored files from `/uploads`. |
| AI Insights | `server/src/modules/ai` route/service, `server/src/services/ai`, and `web/src/hooks/useAi.ts` | `AiInsight`; Lead score fields for lead scoring | The service assembles Customer context, checks current scope rules, dispatches provider work through the AI queue, persists insights or Lead scores, calls the Activity service, and invalidates caches. |

Related support domains—Auth, Users, Analytics, Audit, Notifications, Exports, and Performance—are mounted as peer API modules. They are outside the nine requested ownership decisions but participate in shared identity, reporting, audit, notification, export, and runtime concerns.

## 4. Current service and repository shape

Prisma is the default repository implementation, accessed directly by module services. A separate repository file is optional and is introduced only when a persistence concern is reused, sufficiently complex to isolate, or needs an alternate adapter.

| Shape | Modules currently using it |
|---|---|
| Route → controller → service → Prisma | Customers, Leads, Deals, Tasks, and Auth for its main flows |
| Route → service → Prisma | Activities, AI, Analytics, Audit, Emails, Exports, Notes, Notifications, Uploads, and Users |
| Shared service → Prisma | Activity/notification helper, audit service, authentication sub-services, and secrets service |
| Provider interface → provider implementation | AI provider boundary |

The enforced module boundary is:

- Routes own middleware composition, request validation, multipart parsing, response status/headers, and calls to a controller or same-module service.
- Controllers are optional transport adapters. They are retained where a module already benefits from them and are not required for thin routes.
- Services own application/business rules, persistence coordination, cache/queue/provider calls, and calls to other application services.
- Services may use Prisma directly as the repository implementation. A `*.repository.ts` extraction is justified for reusable/complex persistence or adapter substitution, not required as a pass-through layer.
- Module files other than `*.service.ts` and `*.repository.ts` must not import `server/src/lib/prisma.ts`. `server/src/architecture/serviceBoundary.test.ts` enforces this rule.

Justified exceptions outside module code are process/bootstrap lifecycle (`server/src/server.ts`, `server/src/worker.ts`), database/security/retention infrastructure under `server/src/database`, and cross-cutting persistence services under `server/src/services`. These are not HTTP domain handlers and may access the shared client when their infrastructure responsibility requires it.

## 5. Current transaction ownership

Explicit Prisma transactions observed in the current repository are:

- Deals service: moving/resequencing cards and compacting positions after deletion.
- Auth service: refresh-token rotation.
- MFA service: enabling, disabling, and regenerating recovery state.
- Session service: coordinated session, token, login-history, and user-state updates.
- Retention subsystem: one locked cleanup run and its retention bookkeeping.

No repository-wide transaction policy is documented. The following multi-step CRM operations currently run without an enclosing transaction:

- Lead conversion: optional Customer creation, Lead update, Activity creation, and cache invalidation.
- Customer, Lead, and Deal mutations followed by Activity creation and/or cache invalidation.
- EmailLog creation followed by Activity creation.
- Note creation followed by Activity creation.
- Attachment filesystem validation/write, parent checks, metadata creation, and Activity creation.
- AI provider completion followed by AI Insight or Lead update and optional Activity creation.

Cache invalidation and external/provider/filesystem operations cannot be made atomic merely by adding a database transaction. Their desired consistency and recovery semantics remain a later Phase 1 decision.

## 6. Current synchronous and asynchronous semantics

| Operation | Current execution | Caller-visible semantic |
|---|---|---|
| Ordinary CRUD and reads | API process | Synchronous HTTP |
| Email logging | API process; explicitly kept out of BullMQ | Synchronous HTTP |
| AI generation/scoring | Worker through BullMQ when enabled; inline fallback otherwise | Synchronous HTTP; request waits for result |
| Export preparation | Worker through BullMQ when enabled; inline fallback otherwise | Synchronous HTTP; request waits for prepared result |
| Data retention and prepared-export cleanup | Scheduled cleanup worker | Asynchronous, no waiting HTTP caller |
| Activity and notification creation | API process | Synchronous database side effect |
| Cache invalidation | API process | Awaited side effect |

The queue is currently a workload-isolation mechanism for AI/export calls, not a job-acceptance API. No domain event bus or outbox boundary exists.

## 7. Current request, response, and error conventions

- Route input is normally validated with Zod through `validate`; body, params, and query schemas are module-local.
- Authenticated identity is supplied on `req.user` by middleware and is converted to a small actor object by core controllers.
- Successful API responses normally use `{ success: true, data, meta? }` through `sendSuccess`.
- Expected failures use `ApiError` and are translated into `{ success: false, error: { message, details? } }` by the global error handler.
- The error handler also maps selected body-parser and Prisma failures and masks sensitive values.
- The Axios client handles access tokens, refresh-on-401, and step-up retry. Feature hooks declare response types locally and coordinate query invalidation.
- `web/src/types/index.ts` mirrors domain payloads manually; there is no generated or shared compile-time API contract.

These conventions exist, but Phase 1 has not yet made them enforceable boundary rules. Exhaustive status-code and endpoint-contract normalization belongs to Phase 4.

## 8. Boundary exceptions and duplicated rules observed

- Parent Customer existence and access logic is repeated in Customers, Notes, Emails, Uploads, Activities, and AI paths rather than exposed through one domain boundary.
- Customer and Lead employee scoping is separately expressed in core services, child routes, AI routes, analytics/export queries, and activity filtering.
- Activity creation is centralized as a write helper, but callers decide when and how to emit it; it is generally not atomic with the originating write.
- Cache tags and invalidation knowledge are spread across domain modules and the Activity helper.
- Lead conversion owns Customer creation despite Customers being a peer domain.
- Deal movement owns Notification creation through a shared helper.
- The AI service still combines context assembly, provider orchestration, persistence, and current access checks; only HTTP translation has been separated into its route adapter.
- Customer detail acts as a cross-domain read composition root by directly loading most child collections.

These are current-state architecture findings. This task does not classify them as authorization defects or change their behavior.

## 9. Authoritative domain ownership and dependency direction

This section is normative for future Phase 1 changes. “Owns” means that the domain is the only application boundary permitted to define invariants or perform writes for that domain's records. It does not assign authorization policy; authorization remains a required caller context and is completed in Phase 2.

### Ownership rules

1. A domain owns its model invariants, commands, persistence writes, domain-specific errors, and cache invalidation signals.
2. HTTP routes and controllers adapt transport input/output only. They may call application services but must not become an alternative owner of persistence or business rules.
3. A domain must not import another domain's repository or write another domain's Prisma model. Cross-domain work uses the owning domain's application-facing command or query interface.
4. Cross-domain workflows that require more than one owner belong to an application use-case orchestrator. The orchestrator coordinates domain interfaces; it does not reimplement either domain's rules.
5. Cross-domain read composition may join domain query results in a dedicated read-model/query layer. Read composition grants no write ownership and must not cause domain services to depend back on their consumers.
6. Activities is the append-only business-event timeline boundary. Domains may request an Activity append through its application interface; they must not create Activity rows directly.
7. Cache, queue, database, filesystem, provider, logging, and audit implementations are infrastructure. Domains may depend on narrow interfaces for them; infrastructure must not become the source of domain rules.
8. Shared types may contain transport-neutral identifiers and value shapes only. They must not import a domain service, repository, HTTP type, or infrastructure client.

### Domain ownership matrix

| Domain | Authoritative ownership | Interfaces it must expose | Allowed outbound domain dependencies | Not owned by this domain |
|---|---|---|---|---|
| Customers | Customer identity/profile data, status, tags, owner reference, Customer lifecycle rules, and Customer persistence | Customer commands; Customer-by-id/reference queries; scoped Customer detail query input | Activities append for Customer timeline events | Deals, Leads, Tasks, Notes, Emails, Attachments, and AI Insights returned on a detail screen; those are composed reads owned by their respective domains |
| Leads | Lead data, status/lifecycle, source, assignment reference, Customer link, score result fields, and Lead persistence | Lead commands and queries; conversion use case; command to apply a validated score result | Customers commands/queries during conversion or linking; Activities append | Customer creation rules and AI provider execution |
| Deals | Pipelines, Stages, Deals, stage ordering, movement/resequencing, close bookkeeping, owner and Customer references, and Deal persistence | Deal/Pipeline commands and queries; Deal reference query | Customers reference query; Activities append | Customer lifecycle, attached file lifecycle, Task lifecycle, and notification delivery |
| Tasks | Task data, assignment reference, status/completion bookkeeping, optional Customer/Deal references, and Task persistence | Task commands and queries | Customers and Deals reference queries; Activities append when a Task event is required | Customer, Deal, or assignee lifecycle |
| Activities | Activity content, supported activity types, actor and entity references, timeline ordering/querying, and Activity persistence | Append-activity command; scoped timeline queries | Customer, Lead, and Deal reference queries only when reference validation or scoped reads require them | Rules deciding when another domain action should emit an Activity |
| Notes | Note content, author reference, Customer reference, Note lifecycle, and Note persistence | Note commands; Customer-scoped Note queries | Customers reference query; Activities append | Customer lifecycle and the combined Customer detail response |
| Emails | EmailLog content, direction/address metadata, actor and Customer references, and EmailLog persistence | Record-email command; Customer-scoped EmailLog queries | Customers reference query; Activities append | SMTP/provider delivery and AI-generated drafts |
| Attachments | Attachment metadata, file validation/storage lifecycle, uploader and parent references, and Attachment persistence | Store/delete attachment commands; parent-scoped Attachment queries; storage interface | Customers and Deals reference queries; Activities append | Customer/Deal lifecycle and HTTP static-file serving policy |
| AI Insights | AI use-case orchestration, context selection, provider interface invocation, AI Insight lifecycle, provenance-shaped result boundary, and AI Insight persistence | Customer insight commands/queries; Lead scoring orchestration; AI provider port | Customers, Leads, Activities, Notes, and Emails query interfaces; Leads command to apply a score; Activities append | Customer/Lead persistence writes, EmailLog creation, and provider-specific HTTP details |

### Allowed dependency direction

The default dependency direction is:

```text
web page/component
  -> web feature hook/API adapter
  -> HTTP route/controller
  -> application service or use-case orchestrator
  -> owning domain interface
  -> owning repository/infrastructure port
  -> Prisma, Redis/BullMQ, filesystem, or external provider adapter
```

Cross-domain dependencies are directed and interface-based:

```text
read-model composer -> domain query interfaces
use-case orchestrator -> domain command/query interfaces
child/reference domain -> parent reference query interface
event-producing domain -> Activities append interface
AI Insights -> CRM read interfaces and owning-domain result commands
```

The reverse directions are not allowed. In particular, a parent domain must not import child-domain services merely to build a screen response, Activities must not call back into an emitting domain to complete its command, and infrastructure adapters must not invoke routes or UI code.

### Cross-domain workflow ownership

| Workflow | Owning coordinator | Required domain interactions |
|---|---|---|
| Customer detail response | Dedicated Customer-detail read composer | Customer plus read-only Deals, Leads, Tasks, Activities, Notes, Emails, Attachments, and AI Insights queries |
| Lead conversion | Leads application use-case orchestrator | Read/update Lead, request Customer creation from Customers, append Activity |
| Deal stage movement | Deals application service | Move/resequence Deal, append Activity, invoke notification support outside the nine CRM domains |
| Note or EmailLog creation | Owning Notes or Emails application service | Validate Customer reference through Customers, persist owned record, append Activity |
| Attachment upload | Attachments application service | Validate Customer/Deal reference, use storage port, persist Attachment metadata, append Activity |
| Customer AI insight | AI Insights application service | Read Customer and interaction context through domain queries, call provider port, persist AI Insight, append Activity when required |
| Lead scoring | AI Insights application use-case orchestrator | Read Lead scoring input, call provider port, ask Leads to apply the score result |

These rules define target dependency ownership only. The standard service/repository form, transaction semantics, asynchronous contracts, and enforcement migrations remain separate Phase 1 items.

## 10. Phase 1 progress and remaining work

Completed Phase 1 documentation items:

- Document the current runtime architecture and dependency map.
- Define authoritative ownership and allowed dependency direction for the nine CRM domains.
- Standardize and enforce the service/repository boundary, including justified infrastructure exceptions.

Remaining roadmap requirements:

- Define transaction owners, atomicity requirements, and post-commit side-effect handling.
- Define which operations must remain synchronous and which should become accepted background jobs.
- Adopt enforceable request/response/error conventions at module boundaries without duplicating Phase 4 contract work.
- Remove prioritized accidental coupling and duplicated business rules and add appropriate regression/boundary tests.
- Re-inspect the resulting architecture and assess all Phase 1 exit criteria before marking the phase complete.
