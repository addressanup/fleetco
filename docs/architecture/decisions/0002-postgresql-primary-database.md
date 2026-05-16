# ADR-0002: PostgreSQL as the primary database

- **Status:** Accepted
- **Date:** 2026-05-09
- **Decider:** Product owner (CEO)

## Context

FleetCo data is strongly relational. Vehicles relate to trips, trips relate to drivers, trips relate to jobs, jobs relate to customers, fuel logs relate to trips, expenses relate to trips and vehicles, vendors relate to bills, lease-takers relate to contracts. Money is involved at multiple points (customer billing, lease-taker billing, vendor payments, driver compensation), so transactional integrity is non-negotiable. We also have geospatial data (GPS pings starting in Phase 2, geofences for the depot and customer sites and route corridors) and we will accumulate time-series data at scale (the GPS pings, again, which will eventually constitute most of the data volume). We need to choose a primary database that handles all of this without forcing us to introduce a second store before we have the data to justify one.

## Decision

We use PostgreSQL as the primary database for FleetCo. We add the PostGIS extension for geospatial work, which lets us store geometries, run spatial queries, and define geofences as polygons in the same database that holds everything else. We start with plain partitioned tables for the eventual time-series volume of GPS pings, partitioning by month, and we adopt TimescaleDB only if measurements show that plain partitioning is insufficient. We do not adopt Elasticsearch for full-text search; PostgreSQL's full-text search and its `pg_trgm` extension handle our search needs for years.

## Alternatives considered

MongoDB or another document database was considered and rejected because the data is fundamentally relational. Expressing the trip-fuel-vehicle-customer-job join structure on a document store creates worse complexity than it removes, because the natural unit of read access varies depending on the question being asked. A trip-centric document is wrong for a fuel report, and a vehicle-centric document is wrong for a job-billing report. We would end up either embedding things wrongly, duplicating data, or relying on application-level joins that defeat the point of using a document store. Transactional integrity over money is also harder to achieve in document stores than in relational ones.

MySQL was considered and rejected on technical merit. PostgreSQL has stronger feature support for our specific needs: better JSON handling, native full-text search, native partitioning, and the PostGIS ecosystem for geospatial work. There is no specific reason to prefer MySQL for this workload.

A separate spatial database (such as PostGIS-only deployments or specialized geospatial stores) was considered and rejected because it would mean two databases for one workload. PostGIS as an extension to PostgreSQL is the industry standard, and it gives us the spatial capabilities without the operational cost of a second database.

Adding Elasticsearch from the start was considered and rejected as premature. PostgreSQL's full-text search handles our scale for years. We may add Elasticsearch in some future phase if free-text search performance becomes a measurable bottleneck and PostgreSQL's options have been exhausted, but introducing it before then would add operational complexity without delivering value.

## Consequences

The benefits of one database are substantial. We have one thing to back up, one thing to migrate, one set of types, one set of credentials, one place where data integrity rules live. Operationally this is dramatically simpler than running multiple stores. The decision also keeps the option open to add purpose-built stores later — search, analytics, time-series — as the second store rather than the first, when we actually have the data to justify the addition.

The constraint we accept is that we are committing to PostgreSQL's performance envelope for everything FleetCo does. For our scale (approximately 100 vehicles, 500 trips per day, with GPS pings as the largest volume in Phase 2 and beyond), this envelope is comfortable. If we ever genuinely outgrow it, we will know from measurements rather than from anxiety.

## Revisit when

Two signals would prompt revisiting parts of this decision. If GPS ping volume measurably hurts query performance even with month-based partitioning, we consider TimescaleDB; this is a Phase 2 or later concern. If search queries on free-text fields become a measurable bottleneck and `pg_trgm` cannot address it, we consider Elasticsearch; this is unlikely in the foreseeable scope. The PostgreSQL choice itself is unlikely to be revisited; it would take a fundamental change in our data model or a tenfold increase in scale to make migration worthwhile.
