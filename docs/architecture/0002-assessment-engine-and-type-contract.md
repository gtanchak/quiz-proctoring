# ADR 0002 — Assessment engine & assessment-type contract

- **Status:** Proposed (PRO-56) — pending team review
- **Date:** 2026-06-22
- **Context source:** AI Interview & Assessment Platform — engine architecture spike (PRO-56)
- **Supersedes (in part):** CLAUDE.md §2 backend-framework lock (see Decision 3)

## Context

The [AI Interview & Assessment Platform][project] reframes this product as a
**multi-tenant SaaS** built on a **shared assessment engine** with pluggable
**assessment types**. Two types are planned on one engine:

1. **MCQ exam** — deterministic auto-grading (P1, the first shippable product).
2. **AI Agent (text)** — RAG question generation + LLM-as-judge scoring (P2);
   real-time **voice** is layered on later (P3).

The project build order is **engine-first**: P1 (shared engine + MCQ) →
P2 (AI Agent text) → P3 (live voice) → P4 (enterprise & compliance). Every P2+
issue (PRO-65/66/67/68) plugs into engine primitives — session lifecycle
(PRO-59), pluggable scoring (PRO-60), model abstraction/BYOK (PRO-61),
multi-tenancy/auth (PRO-57) — so the engine and its contract must be defined
before any assessment type is built. This ADR is that definition (PRO-56,
**Urgent** — "the decision everything else depends on").

**Repository strategy (decided):** the platform is built by **evolving this
existing monorepo**, not a greenfield repo. We reuse `@proctoring/shared`
(the contract), the existing auth/accounts, reporting, and proctoring work
rather than reimplementing them. New engine capabilities are added as packages
and services under the existing pnpm + Turborepo layout.

This decision interacts with the platform's regulatory posture: hiring AI is
**high-risk** under the EU AI Act and similar laws (PRO-73). Two principles
from the proctoring product carry over and are load-bearing here:
**evaluation accuracy is a system property** (grounding + calibration +
human-in-the-loop, never "100% accurate"), and **detection/scoring produces
indicators, not verdicts** — never auto-reject a candidate from a score alone
(CLAUDE.md §1; FR-28/FR-37).

## Decision

### 1. The assessment-type contract

Every assessment type implements one interface. The **engine** drives the
session; a **type** only knows how to present its items, capture responses,
score them, and emit events. The contract is the canonical loop from PRO-56:

> `present next item → capture response → score response → emit events`

The interface lives in `@proctoring/shared` (the contract package — never
redefined per service or per type):

```ts
// packages/shared/src/assessment/contract.ts (illustrative)
export interface AssessmentType<TItem, TResponse> {
  readonly kind: "mcq" | "ai-agent-text" /* | "ai-agent-voice" */;

  /** What the candidate sees next, or null when the assessment is complete. */
  nextItem(ctx: SessionContext): Promise<TItem | null>;

  /** Validate + normalise a candidate response to an item. */
  captureResponse(ctx: SessionContext, item: TItem, raw: unknown): Promise<TResponse>;

  /** Produce a score with justification + evidence + confidence (PRO-60). */
  scoreResponse(ctx: SessionContext, item: TItem, response: TResponse): Promise<ScoreResult>;

  /** Domain events the engine persists + fans out (turn logged, item scored…). */
  readonly events: AssessmentEvent[];
}
```

`ScoreResult` is the shared scoring shape `{ score, justification, evidence,
confidence }` (PRO-60). MCQ returns it deterministically (no model);
the AI Agent returns it from an LLM-as-judge scorer (PRO-67). Aggregation,
banding, and reporting consume `ScoreResult` and **never branch on the type** —
that is what keeps the engine reusable.

### 2. Engine owns vs. type owns

| Concern | Owner | Notes |
| -- | -- | -- |
| Tenancy, auth, RBAC | **Engine** | PRO-57 |
| Assessment template & config studio | **Engine** | type-agnostic where possible (PRO-58) |
| Candidate session lifecycle / state machine | **Engine** | PRO-59 — intro → items → wrap-up → complete |
| Scoring framework (interface + aggregation + banding) | **Engine** | PRO-60 |
| Model abstraction / selection / BYOK | **Engine** | PRO-61 — shared by every type that uses a model |
| Reporting, results, override, export | **Engine** | PRO-62 |
| Proctoring / integrity signals | **Engine** | PRO-63 light; PRO-72 strict |
| Billing / metering | **Engine** | PRO-74 |
| **Item presentation** (what "next question" means) | **Type** | MCQ option set vs. agent turn |
| **Response capture** semantics | **Type** | selected options vs. free-text turn |
| **The scorer** | **Type** | deterministic vs. LLM-as-judge |

Rule of thumb: anything shared across MCQ and the AI Agent is the **engine**;
anything that differs between them is the **type**.

### 3. Core stack — backend framework: adopt **NestJS**

This is the substantive change and it **reverses the CLAUDE.md §2 Fastify
lock**. Recorded deliberately here (the correct mechanism per CLAUDE.md §10),
not as a side effect.

- **New platform services are built on NestJS** (Node + TypeScript). NestJS's
  module/DI structure fits an engine-with-pluggable-types design: assessment
  types register as injectable providers behind the `AssessmentType` contract;
  cross-cutting engine concerns (tenancy guard, RBAC, audit logging, model
  provider) are guards/interceptors/providers shared across modules.
- **Existing MVP services stay Fastify for now.** `core-api` and
  `violation-ingest` (ADR 0001) are not rewritten as part of this ADR. NestJS
  and Fastify **coexist** during the migration; each service is independently
  deployable (ADR 0001 still holds). A later issue may port `core-api` onto the
  engine, but that is out of scope for PRO-56.
- **Validation / contract:** keep all cross-boundary validation **framework-
  agnostic in `@proctoring/shared`** so it is callable from either framework.
  NestJS validates via a thin pipe that calls the shared validators; we do **not**
  scatter `class-validator` decorators that would fork the contract. (Note:
  `@fastify/type-provider-typebox`'s *native* Fastify integration does not carry
  over — the TypeBox/JSON-Schema definitions themselves still can, used
  standalone. CLAUDE.md §2's TypeBox guidance is Fastify-specific and is
  relaxed for NestJS services; see Consequences.)

> ⚠️ **Cost, stated honestly.** This is not free. It introduces a second
> backend framework, a different validation idiom, and new conventions the
> team must learn. The payoff is a better structural fit for the engine and a
> single idiom for all *new* platform work. The ADR confines the blast radius
> by **not** rewriting existing services.

### 3b. Rest of the core stack

| Layer | Decision | Rationale |
| -- | -- | -- |
| Database | **PostgreSQL (RDS) + Drizzle ORM** — unchanged | ORM is framework-agnostic; reuse migrations tooling and `shared` types. CLAUDE.md §2 Drizzle lock stands. |
| Async queue | **AWS SQS** — unchanged | CV inference, evidence processing, async scoring stay off the candidate hot path (CLAUDE.md §5). |
| Vector store | **pgvector** on the existing Postgres | Lowest-friction for P2 RAG (PRO-65); no new datastore to operate. Revisit a dedicated store (Qdrant/Pinecone) only if recall/scale demands it — record as a follow-up ADR. |
| Real-time transport | **Deferred to PRO-69** (voice spike) | Text agent (P2) needs only HTTP + SSE/streaming. WebRTC/WebSocket is a P3 decision; CLAUDE.md's open "WebSocket gateway" item is resolved there, not here. |
| Model layer | **Provider abstraction + BYOK** (PRO-61) | Separate conversation vs. scoring model; per-tenant keys. Default to the latest Claude models; abstraction allows swap/A-B/pin without code changes. |

### 4. Tenancy model: shared-schema + `tenant_id`

Adopt **shared-schema multi-tenancy** (every tenant-scoped table carries a
non-null `tenant_id`), **not** schema-per-tenant.

- Enforced structurally: a NestJS tenancy guard resolves the tenant from
  auth context and every engine query is scoped by `tenant_id`; Postgres
  **row-level security** as defence-in-depth on the most sensitive tables.
- Rationale: far simpler migrations and operations at MVP/V1 scale than
  schema-per-tenant, and it matches FR-38 (tenant data isolation) without the
  per-tenant DDL overhead. Schema/DB-per-tenant remains available later for a
  specific enterprise tenant that contractually requires physical isolation —
  a future ADR, not a default.
- Evidence, recordings, and any biometric/ID data are partitioned by tenant in
  S3 prefixes and served only via signed, time-limited URLs (CLAUDE.md §5/§6).

### 5. Core data model (engine-owned)

Minimal shared spine every assessment type builds on:

- **Tenant** — `id`, branding, plan/limits, BYOK key refs (masked). Root of
  isolation.
- **AssessmentTemplate** — `id`, `tenant_id`, `type` (`mcq` | `ai-agent-text`),
  config (language, modality, duration, difficulty, proctoring level, retakes),
  scoring rubric (competencies, weights, scale, model answers). Authored in the
  studio (PRO-58).
- **CandidateSession** — `id`, `tenant_id`, `template_id`, candidate ref,
  state (`intro → items → wrap-up → complete`), **server-authoritative**
  timing (CLAUDE.md §5), consent record, per-turn transcript/event log.
- **Score** — `id`, `tenant_id`, `session_id`, per-competency `ScoreResult`s,
  aggregate + recommendation band, plus recruiter override + notes, **fully
  audit-logged** (FR-30; never auto-reject, FR-28).

These are engine tables (owned per ADR 0001's database-per-service principle by
the engine service that introduces them). Assessment-type-specific item and
response tables hang off `CandidateSession` and are owned by the type.

## Consequences

- ✅ One contract (`AssessmentType`) lets MCQ (P1) and the AI Agent (P2) reuse
  sessions, scoring aggregation, reporting, proctoring, tenancy, and BYOK.
- ✅ Engine-first order is enforceable: P2 issues have concrete interfaces to
  build against instead of stubs.
- ✅ ADR 0001 (service boundaries, own-your-schema, contract-only sharing)
  continues to hold; new engine services follow it.
- ⚠️ **CLAUDE.md must be updated** to reflect: NestJS as the framework for new
  platform services (Fastify retained for existing `core-api`/`violation-ingest`),
  TypeBox relaxed to "shared-package validators, framework-agnostic," and the
  new project/phase context. Done alongside this ADR (PRO-56 acceptance:
  "document the contract"; user instruction: update CLAUDE.md first).
- ⚠️ Two backend frameworks coexist until/unless existing services are ported —
  a deliberate, scoped cost (Decision 3).
- 📋 Follow-ups: PRO-57 (tenancy/auth) and PRO-59 (session lifecycle) are the
  first engine slices to implement against this ADR; PRO-60/61 next; then the
  AI Agent (PRO-65 → 66 → 67 → 68). Vector-store and real-time-transport
  choices are revisited in their own issues (PRO-65 / PRO-69).

[project]: https://linear.app/proctoring/project/ai-interview-and-assessment-platform-a73be8cf0e11
