\# AI-CRM — Professional Product Roadmap



\## Purpose



This is the master execution roadmap for taking the existing AI-CRM from its current engineering state to a production-ready, enterprise-grade product.



Do NOT rebuild existing features without verifying the repository first.



Each phase must be:

1\. Inspected against the current repository.

2\. Implemented only where a real gap exists.

3\. Tested.

4\. Re-tested for regressions.

5\. Documented.

6\. Marked COMPLETE only when its exit criteria pass.



\---



\# Execution Order



0\. Baseline \& Product Definition

1\. Architecture \& Domain Boundaries

2\. Authorization Core

3\. Authentication \& Account Security

4\. API Contract \& Application Reliability

5\. Data Model, Integrity \& Database Performance

6\. File \& Document Security

7\. AI Security \& AI Product Layer

8\. Business Logic \& Workflow Correctness

9\. Frontend Product Quality

10\. Accessibility \& UX Quality

11\. Performance \& Scalability

12\. Observability \& Operations

13\. Infrastructure, Secrets \& Deployment

14\. CI/CD \& Release Gates

15\. Backup, Recovery \& Disaster Recovery

16\. Red-Team Security Validation

17\. Professional Product Release



\---



\# Phase 0 — Baseline \& Product Definition



\## Goal



Create one authoritative picture of what already exists before changing architecture.



\## Work



\- Freeze the current Git state and record the exact commit/tag.

\- Inventory frontend, API, services, database models, background jobs, integrations, AI providers and tests.

\- Create a feature matrix:

&#x20; - IMPLEMENTED

&#x20; - PARTIAL

&#x20; - BROKEN

&#x20; - MISSING

&#x20; - DEFERRED

\- Define security, reliability, performance, accessibility and availability requirements.

\- Define development, test, staging and production environments.

\- Maintain a decision log so future Codex sessions do not repeat completed work.



\## Exit Criteria



\- Baseline document matches the repository.

\- Every major feature has an explicit status.

\- No implementation begins from assumptions.



\---



\# Phase 1 — Architecture \& Domain Boundaries



\## Goal



Make the system understandable, maintainable and safe to extend.



\## Work



\- Document frontend, API, service, database, Redis/queue, worker and AI-provider boundaries.

\- Define domain ownership for:

&#x20; - Customers

&#x20; - Leads

&#x20; - Deals

&#x20; - Tasks

&#x20; - Activities

&#x20; - Notes

&#x20; - Emails

&#x20; - Attachments

&#x20; - AI Insights

\- Standardize service/repository boundaries.

\- Define transaction ownership.

\- Define synchronous vs asynchronous operations.

\- Standardize error contracts and request/response conventions.

\- Remove accidental coupling and duplicate business rules.



\## Exit Criteria



\- Architecture documentation is current.

\- Each domain has clear ownership.

\- Business rules are not duplicated across route/controller/UI layers.



\---



\# Phase 2 — Authorization Core 🔴



\## Goal



Make access control authoritative, consistent and testable.



\## Work



\- Define role × resource × operation permissions.

\- Make server-derived ownership/assignment scope authoritative.

\- Prevent mass assignment of:

&#x20; - ownerId

&#x20; - assignedToId

&#x20; - related ownership/scope fields

\- Authorize parent records before child-resource reads/writes.

\- Standardize policy functions/middleware.

\- Add hostile cross-user tests for every sensitive resource.



\## Exit Criteria



\- No verified IDOR/horizontal privilege bypass.

\- Ownership and assignment changes are explicitly authorized.

\- Authorization tests cover positive and negative cases.



\---



\# Phase 3 — Authentication \& Account Security



\## Goal



Make identity and session behavior predictable under real-world failures.



\## Work



\- Verify password policy and hashing.

\- Verify login throttling and abuse controls.

\- Verify access-token expiry.

\- Verify refresh-token rotation and reuse detection.

\- Define logout behavior.

\- Define password-change session behavior.

\- Define role-change session behavior.

\- Define account-disable session behavior.

\- Add MFA/recovery if required by product tier.

\- Add session/device management if required.

\- Remove production exposure of demo/default credentials.

\- Make bootstrap credentials non-deterministic.



\## Exit Criteria



\- Account lifecycle behavior is documented and tested.

\- No known production/default credentials.

\- Session revocation matches policy.



\---



\# Phase 4 — API Contract \& Application Reliability



\## Goal



Make every API predictable.



\## Work



\- Standardize success/error response envelopes.

\- Validate:

&#x20; - body

&#x20; - path

&#x20; - query

&#x20; - relevant headers

\- Correctly distinguish:

&#x20; - 401

&#x20; - 403

&#x20; - 404

&#x20; - 409

&#x20; - 422

&#x20; - 429

&#x20; - 5xx

\- Add correlation/request IDs.

\- Standardize structured errors.

\- Define pagination/filtering/sorting/limits.

\- Prevent incorrect empty-state behavior.

\- Add idempotency for safely retryable operations.



\## Exit Criteria



\- API contracts are documented and consistent.

\- Frontend distinguishes empty/forbidden/missing/failed states.

\- Retries cannot create duplicate business actions.



\---



\# Phase 5 — Data Model, Integrity \& Database Performance



\## Goal



Make the CRM data layer correct, scoped and scalable.



\## Work



\- Review relational constraints.

\- Review foreign keys.

\- Review unique constraints.

\- Review delete behavior.

\- Verify every data-access path applies authorization scope.

\- Index real production query patterns.

\- Paginate high-growth child collections.

\- Review transaction boundaries.

\- Review concurrency behavior.

\- Add optimistic/concurrency safeguards where required.

\- Define retention, deletion and archival rules.



\## Exit Criteria



\- Integrity rules are database-enforced where appropriate.

\- High-growth endpoints have bounded queries/payloads.

\- Concurrency behavior is defined.



\---



\# Phase 6 — File \& Document Security 🔴



\## Goal



Turn uploads into a controlled document subsystem.



\## Work



\- Eliminate public access to sensitive CRM attachments.

\- Authorize attachment access on every download.

\- Authorize parent-record access before attachment access.

\- Revoke access according to deletion policy.

\- Validate:

&#x20; - size

&#x20; - MIME/type

&#x20; - extension

&#x20; - content

\- Handle:

&#x20; - malicious archives

&#x20; - polyglots

&#x20; - double extensions

\- Add download/delete audit events.

\- Define storage lifecycle.

\- Define retention and cleanup behavior.



\## Exit Criteria



\- Attachment ID/URL alone cannot provide unauthorized access.

\- File lifecycle is auditable.

\- Large/malicious files cannot exhaust application resources.



\---



\# Phase 7 — AI Security \& AI Product Layer 🔴



\## Goal



AI must never become an authorization or data-exfiltration bypass.



\## Work



\- Authorize AI access using normal CRM permissions.

\- Minimize/redact sensitive CRM data before provider submission.

\- Separate system instructions from untrusted CRM/email/note content.

\- Defend against:

&#x20; - prompt injection

&#x20; - indirect prompt injection

\- Never execute privileged/destructive AI output directly.

\- Validate AI tool/action arguments server-side.

\- Re-check authorization immediately before executing AI actions.

\- Add provider:

&#x20; - timeouts

&#x20; - retries

&#x20; - circuit breakers

&#x20; - failure states

\- Track provider usage and cost.

\- Establish AI usage limits.

\- Define provider data-retention/privacy policy.

\- Store AI provenance:

&#x20; - model

&#x20; - provider

&#x20; - request context identifier

&#x20; - timestamp

&#x20; - action result

\- Do not store unnecessary secrets.



\## Exit Criteria



\- AI cannot bypass CRM permissions.

\- AI failures are safe and visible.

\- Provider usage is observable and bounded.

\- AI actions are auditable.



\---



\# Phase 8 — Business Logic \& Workflow Correctness



\## Goal



Make CRM behavior match real business expectations.



\## Work



\- Define lifecycle/state machines for:

&#x20; - leads

&#x20; - deals

&#x20; - tasks

&#x20; - customer relationships

\- Validate legal state transitions server-side.

\- Review analytics/business formulas.

\- Ensure derived metrics use correct denominators and states.

\- Prevent duplicate submissions.

\- Prevent race-condition-driven duplicate records.

\- Add representative business-rule tests.



\## Exit Criteria



\- Business states have documented transitions.

\- Critical calculations have test cases.

\- Invalid transitions are rejected server-side.



\---



\# Phase 9 — Frontend Product Quality



\## Goal



Make the CRM production-quality rather than prototype-quality.



\## Work



\- Standardize loading states.

\- Standardize empty states.

\- Standardize error/retry states.

\- Add pagination/infinite loading for large datasets.

\- Prevent silent data loss during forms/navigation.

\- Use consistent validation.

\- Add inline error messages.

\- Add confirmation/undo flows for destructive actions.

\- Keep navigation/filtering/sorting/search behavior consistent.

\- Remove development/demo artifacts from production UI.



\## Exit Criteria



\- Screens do not confuse errors with empty data.

\- Large datasets remain usable.

\- Critical actions have safe confirmation/recovery behavior.



\---



\# Phase 10 — Accessibility \& UX Quality



\## Goal



Make the product usable by a broader professional user base.



\## Work



\- Keyboard navigation for critical workflows.

\- Visible focus states.

\- Logical tab order.

\- Accessible labels/names.

\- Semantic controls.

\- Color contrast.

\- Non-color error indicators.

\- Screen-reader-friendly:

&#x20; - dialogs

&#x20; - tables

&#x20; - forms

&#x20; - notifications

\- Responsive behavior.

\- Automated accessibility checks.

\- Manual keyboard testing.



\## Exit Criteria



\- Critical workflows are keyboard accessible.

\- No major WCAG-level blockers remain.

\- Accessibility regressions are tested.



\---



\# Phase 11 — Performance \& Scalability



\## Goal



Move from "works locally" to predictable production performance.



\## Work



\- Define latency/error/throughput targets.

\- Measure slow queries.

\- Add targeted indexes.

\- Bound payload sizes.

\- Bound collection sizes.

\- Use caching only where invalidation semantics are correct.

\- Move expensive work to queues/workers.

\- Define queue:

&#x20; - retry

&#x20; - timeout

&#x20; - dead-letter

&#x20; - idempotency

\- Load-test:

&#x20; - login

&#x20; - search

&#x20; - dashboards

&#x20; - customer detail

&#x20; - exports

&#x20; - AI endpoints

\- Track database connection pressure.

\- Track Redis/queue pressure.



\## Exit Criteria



\- Critical endpoints have measured SLO targets.

\- Load tests identify safe operating limits.

\- No unbounded query/queue path remains in critical workflows.



\---



\# Phase 12 — Observability \& Operations



\## Goal



Production failures must be diagnosable.



\## Work



\- Structured logs.

\- Correlation/request IDs.

\- Metrics for:

&#x20; - API latency

&#x20; - API errors

&#x20; - DB

&#x20; - Redis

&#x20; - queues

&#x20; - AI providers

&#x20; - background jobs

\- Health/readiness endpoints reflecting real dependencies.

\- Alerting for:

&#x20; - elevated errors

&#x20; - latency

&#x20; - queue failures

&#x20; - authentication abuse

\- Separate security/audit events from ordinary application logs.

\- Define product-health dashboard.

\- Define security-health dashboard.



\## Exit Criteria



\- Incidents can be traced from request → service → dependency.

\- Critical alerts have owners and thresholds.

\- Sensitive data is not leaked into logs.



\---



\# Phase 13 — Infrastructure, Secrets \& Deployment



\## Goal



Create a safe production runtime.



\## Work



\- Use managed/secure secret storage.

\- Never commit production secrets.

\- Rotate API/database/encryption credentials.

\- Harden containers:

&#x20; - non-root

&#x20; - minimal images

&#x20; - dropped capabilities

&#x20; - resource limits

\- Review TLS.

\- Review network exposure.

\- Review Redis exposure.

\- Review PostgreSQL exposure.

\- Review Docker configuration.

\- Define staging/production configuration.

\- Define controlled database migration strategy.



\## Exit Criteria



\- Secrets are externalized.

\- Production services are appropriately isolated.

\- Deployment configuration is reproducible.



\---



\# Phase 14 — CI/CD \& Release Gates



\## Goal



Prevent broken or insecure code from reaching production.



\## Work



\- CI install/dependency validation.

\- Server TypeScript check.

\- Web TypeScript check.

\- Server build.

\- Web build.

\- Database security tests.

\- Performance tests where applicable.

\- Playwright critical-flow tests.

\- Security regression tests.

\- Dependency/security scanning.

\- Secret scanning.

\- Git diff validation.

\- Define merge/release gates.



\## Exit Criteria



\- CI fails on required quality/security regressions.

\- Production branch cannot bypass required gates.



\---



\# Phase 15 — Backup, Recovery \& Disaster Recovery



\## Goal



Recovery must be tested, not assumed.



\## Work



\- Verify encrypted backups.

\- Verify backup retention.

\- Test restoration.

\- Test database recovery.

\- Test application recovery.

\- Define RPO.

\- Define RTO.

\- Test failure scenarios.

\- Document recovery runbook.



\## Exit Criteria



\- Backup restoration has been successfully demonstrated.

\- RPO/RTO are documented.

\- Recovery steps can be executed without tribal knowledge.



\---



\# Phase 16 — Red-Team Security Validation 🔴



\## Goal



Independently validate the entire security posture.



\## Work



Test:



\### Authentication

\- brute-force resistance

\- token replay

\- refresh-token reuse

\- session invalidation

\- account abuse



\### Authorization

\- IDOR

\- horizontal privilege escalation

\- vertical privilege escalation

\- owner/assignee manipulation

\- child-resource authorization bypass



\### API

\- injection

\- XSS

\- CSRF

\- replay

\- rate-limit bypass

\- oversized input



\### Files

\- unauthorized downloads

\- malicious formats

\- polyglots

\- double extensions

\- resource exhaustion



\### AI

\- prompt injection

\- indirect prompt injection

\- data exfiltration

\- tool abuse

\- unauthorized actions



\### Infrastructure

\- dependencies

\- secrets

\- security headers

\- TLS

\- Docker

\- Redis

\- database exposure



\## Critical Rule



Re-test all previous audit findings independently.



Do not mark an old finding fixed merely because code was changed.



\## Exit Criteria



\- Previous findings classified:

&#x20; - FIXED

&#x20; - PARTIAL

&#x20; - NOT FIXED

&#x20; - REGRESSED

\- No open Critical issue for release.

\- High issues have remediation/acceptance decisions.

\- Security report is archived.



\---



\# Phase 17 — Professional Product Release



\## Goal



Convert engineering maturity into a maintainable product.



\## Work



\- Versioned release process.

\- Changelog.

\- Production runbook.

\- Current API/OpenAPI documentation.

\- Architecture documentation.

\- Security documentation.

\- Developer onboarding documentation.

\- Environment configuration documentation.

\- Known limitations register.

\- Residual-risk register.

\- Support/incident ownership.

\- Escalation process.

\- Post-release monitoring.

\- Rollback plan.



\## Exit Criteria



\- New engineer can run the project from documentation.

\- Production deployment can be executed without tribal knowledge.

\- Residual risks are explicit and owned.



\---



\# Definition of Professional Product



A professional product is:



\- Secure by default.

\- Server-side authorization cannot be overridden by client fields.

\- Reliable under dependency failures.

\- Scalable with bounded queries, payloads and queues.

\- Observable through logs, metrics and correlation IDs.

\- Maintainable through clear domain boundaries.

\- Tested across security, business rules, integrations and critical UI flows.

\- Deployable with externalized secrets and controlled migrations.

\- AI-safe: AI is untrusted and cannot bypass authorization.

\- Usable with production-quality loading/error/empty states.

\- Recoverable through tested backups and disaster recovery.



\---



\# Codex Session Handoff Protocol



At every new Codex session:



Read:



docs/AI\_CRM\_PROFESSIONAL\_PRODUCT\_ROADMAP.md



Then:



1\. Inspect the repository.

2\. Inspect current Git state.

3\. Identify the FIRST incomplete phase.

4\. Do NOT repeat completed work.

5\. Do NOT modify files yet.

6\. Report:

&#x20;  - current implementation

&#x20;  - existing tests

&#x20;  - gaps

&#x20;  - risks

&#x20;  - exact files involved

&#x20;  - recommended changes

7\. Wait for explicit authorization before implementation.



Use this exact instruction:



"Read docs/AI\_CRM\_PROFESSIONAL\_PRODUCT\_ROADMAP.md. Inspect the repository and current Git state first. Identify the first incomplete phase. Do not repeat completed work. Do not modify files until I explicitly authorize implementation. For the selected phase, report current implementation, gaps, risks and exact files before proposing changes."



\---



\# Core Rule



A phase is NOT COMPLETE merely because code exists.



Mark a phase COMPLETE only when:



\- implementation passes

\- tests pass

\- negative/security tests pass where relevant

\- operational behavior passes

\- documentation is updated

\- exit criteria pass

\- no regression was introduced

