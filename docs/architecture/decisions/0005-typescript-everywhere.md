# ADR-0005: TypeScript everywhere with strict mode

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

We need to choose the language(s) for FleetCo's backend, frontend, and shared code. The candidates are TypeScript end-to-end, Python (with FastAPI or Django) for the backend with TypeScript for the frontend, Go for the backend with TypeScript for the frontend, or some other combination. The choice of language shapes velocity, type safety, the shape of the developer experience, and the quality of AI-agent output.

## Decision

We use TypeScript end-to-end for FleetCo, with `strict: true` in `tsconfig.json` and lint rules that forbid `any` and unjustified `@ts-ignore`. The backend is NestJS in TypeScript, the frontend is Next.js in TypeScript, and shared code (types, validation schemas, domain helpers) lives in `packages/shared` and is imported by both.

## Alternatives considered

The Python-backend-with-TypeScript-frontend alternative is widely used and has a strong ecosystem. Its costs for our project are real: types must be duplicated across the API boundary, two runtimes must be operated and updated, and the shared concepts that exist between API and UI (input validation, domain types, currency handling) cannot be shared in code. For a one-person team, the duplication tax is significant. Rejected for v1.

The Go-backend-with-TypeScript-frontend alternative has excellent runtime characteristics and clear deployability. Its costs are similar to the Python case (no shared types, two runtimes) and additionally Go's verbosity slows velocity for the CRUD-heavy ERP work that dominates the Phase 1 build. Rejected for v1.

The TypeScript-everywhere alternative wins because one language for both runtimes lets us share types between API and UI through the `packages/shared` package, the ecosystem is massive, both NestJS and Next.js are TypeScript-native, AI agents have particularly strong training mass on this combination, and static types catch a class of bugs that AI agents would otherwise ship.

## Consequences

We have one toolchain (pnpm + tsc + eslint + Prettier). We have one language to debug, one set of patterns to learn, one ecosystem to navigate. Cold-path performance is JavaScript-tier, which is acceptable at our scale; if we ever have a specific subsystem (such as heavy GPS ingestion in a future phase) that bottlenecks on Node performance, that subsystem can be a separate worker in Go or Rust without changing the rest of the stack.

The discipline of strict mode and no-`any` is non-negotiable from commit one. Disabling these rules is the start of the slope to a codebase that has types in name only. The agent enforces this in plan-and-review, and CI enforces it in the build pipeline. The cost of strict mode is small (some additional friction when types are awkward) and the benefit is large (a class of bugs simply does not ship).

## Revisit when

The signal to revisit this decision is a specific subsystem with measured performance bottlenecks attributable to Node. Such a subsystem might justify being rewritten in Go or Rust as a separate worker, while the rest of FleetCo stays in TypeScript. The TypeScript-everywhere decision itself is unlikely to be reopened; the costs of language migration far exceed any benefit we can foresee.
