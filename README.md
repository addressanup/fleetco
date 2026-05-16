# FleetCo

A fleet management platform for heavy-construction operations.

> **Status:** Pre-code. Phase 0 (kickoff). See [`docs/product/roadmap.md`](docs/product/roadmap.md).

## What this is

FleetCo is an internal-use ERP for managing trucks, tippers, drivers, jobs, fuel, maintenance, compliance (Bluebook, insurance, route permits), and lease-taker billing for a heavy-construction fleet operating in Nepal. It is built by one person, the company's CEO, working with AI coding agents.

It is not a SaaS product. It is built for a single company by its owner.

## Stack

The backend is NestJS in TypeScript, organized as a modular monolith. The frontend is Next.js with the App Router for the admin web, with a React Native (Expo) driver app planned for a later phase. The database is PostgreSQL with the PostGIS extension. Cache and background jobs run on Redis with BullMQ. Object storage is S3-compatible via Cloudflare R2. The repository is a pnpm workspace monorepo.

## Delivery operating model

FleetCo is built not just as a software architecture but as a delivery operating model. The four canonical DORA metrics plus the rework rate are tracked weekly in the operations folder. Two service-level indicators (API availability and trip-creation success) are measured against a 99.0 percent objective over a rolling 28-day window. A three-level incident severity classification governs response expectations. A security baseline runs on every PR (Dependabot, GitHub native secrets scanning, Semgrep with OWASP rulesets, action-version pinning, CycloneDX SBOM generation). Data is classified into four tiers with explicit retention, encryption, and logging rules. The full set of commitments lives in the architecture decisions folder, particularly ADRs 0010 through 0013.

## Documentation

The repository functions as the project's memory. Documentation is therefore not auxiliary; it is the substrate on which the project's continuity over time depends. Every reader (human or AI agent) is expected to read the relevant documentation before acting.

For the project itself, see the [Vision](docs/product/vision.md) for why we are building this, the [Roadmap](docs/product/roadmap.md) for the phasing, and the [Current Phase](docs/CURRENT_PHASE.md) for what is active right now. For architecture, see the [Architecture Overview](docs/architecture/overview.md) for the system shape, the [Memory Architecture](docs/architecture/memory-architecture.md) for how the repo holds project memory, and [Architecture Decisions](docs/architecture/decisions/) for the full set of ADRs. For language, see the [Glossary](docs/glossary.md). For procedures, see the [Runbook](docs/runbook/) and [Bootstrap](BOOTSTRAP.md). For visual design, see the [Design folder](docs/design/). For prospective work, see [Tech Debt](docs/tech-debt.md). For incident records, see [Postmortems](docs/postmortems/). For operational measurements, see the [Operations folder](docs/operations/).

## Working with AI agents

Read [`CLAUDE.md`](CLAUDE.md) before starting any session with Claude Code. The first part of that document explains the theory of how this project holds memory across time; the second part contains the operational rules an agent follows when working in the repo. The theory is not optional reading; it is what makes the rules make sense.
