# ADR-0001: Modular monolith over microservices

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

FleetCo is being built by one product owner working with AI coding agents. The system covers fleet operations, telematics, compliance, accounting, and lease management, which is broad scope. We need to choose between three architectural shapes: microservices, an unstructured monolith, or a modular monolith. The choice we make at this moment will shape every subsequent design decision, every deployment configuration, and the cost of every cross-cutting feature for the life of the project.

## Decision

We build FleetCo as a modular monolith. This means a single deployable application with a single database, but the code inside is organized into strict modules with explicit public service interfaces and event contracts between them. NestJS provides the module pattern as a first-class part of its framework design, so the discipline is supported by the tooling rather than imposed against it.

## Alternatives considered

The microservices alternative offers independent scaling per service, independent deployment, language flexibility per service, and fault isolation between services. These are real benefits at large enough scale. The costs are significant: distributed-system overhead in the form of network calls between services, eventual consistency problems that ACID transactions inside a single service do not have, observability complexity that requires distributed tracing rather than simple logs, and deployment topology that requires orchestration tooling. AI coding agents have an additional weakness with microservices that human teams do not share: the relevant context for a change often lives across multiple repositories or service codebases, and agents that cannot hold all of it in their working set produce poorly-coordinated changes. For a one-person team at year-zero scale, the operational tax of microservices dwarfs the benefits. Rejected as premature.

The unstructured-monolith alternative is the fastest to start: open one folder, write code, ship. The cost is that without explicit module boundaries, the codebase rots into unmaintainability surprisingly fast, particularly when AI agents are doing most of the writing. Patterns drift between sections of the code, modules bleed into each other through shared imports of internal helpers, and the cost of any cross-cutting change rises until the system effectively cannot be modified. Rejected as insufficient discipline for a long-lived ERP that will be modified continuously over years.

## Consequences

The consequences of choosing modular monolith are mostly positive at our scale. We have one repository, one deployment, and one database, which simplifies operations dramatically. We get atomic cross-module changes in single commits, which is a real benefit when designing the schema and refactoring boundaries. AI agents have all the context they need in one repository, which improves their output quality. We retain the option to extract any single module into its own service later, when measurements show that any one module's load or deployment cadence justifies the separation, and we will have the data to justify the extraction at that point rather than guessing now.

The negative consequences are real and worth naming. A single deployable cannot scale per-module: if the trips module is hot but the reports module is cold, we still scale the whole application. We accept this until measurements force a change. We must be disciplined about module boundaries, because the framework supports the discipline but does not enforce it: a developer (or agent) who imports an internal file from another module will compile fine, run fine, and leave a broken boundary that future changes will trip over. Code review and CI rules carry the burden of enforcement that runtime cannot provide.

## Revisit when

Two specific signals would tell us to reopen this decision. The first is when a single module's read or write load measurably saturates the shared database or application, in a way that vertical scaling and connection pooling cannot address. The second is when multiple developers are working on disjoint modules and deployment coupling becomes a real bottleneck for shipping. Neither of these signals is present in v1 or in any foreseeable phase. The decision is unlikely to be revisited in year one and possibly not at all.
