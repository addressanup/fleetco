# FleetCo — Vision

## What FleetCo is

FleetCo is a fleet management ERP built for one heavy-construction company operating in Nepal. It is an internal tool, not a product. It is built by the company's CEO, working with AI coding agents, with the goal of replacing the current operational reality (spreadsheets, WhatsApp messages, paper logbooks, and memory) with a single integrated system whose source of truth is the Trip.

## Why this exists

The business currently runs on spreadsheets, WhatsApp threads, paper logbooks, and the CEO's memory. This combination works at small scale and breaks at growth. Specifically, it fails at knowing where vehicles actually are in real time, at maintenance scheduling so that services are not missed and breakdowns are not the first sign that a service was due, at fuel and trip-level cost attribution so that the profitability of any individual vehicle or job can actually be measured, at compliance deadlines so that Bluebook renewals and insurance and route permits and Bishesh Anumati documents do not slip through the cracks, at billing lease-takers accurately based on actual contract terms, and at closing the books at month-end with confidence.

FleetCo is intended to replace all of these failures with one system whose source of truth is the Trip. Every event in the business — fuel consumed, distance covered, driver paid, customer billed, vehicle maintained — attaches to a Trip. The Trip is the spine; everything else is a module that hangs off of it. This architectural choice (recorded in ADR-0003) is the most consequential design decision in the project, and the reasoning behind it is explained both in that ADR and in `docs/architecture/overview.md`.

## Who uses it

In v1, the only user is the company owner, who is also the CEO and the sole administrator of the system. The expected later users are office staff in subsequent phases, drivers using a mobile app from Phase 2 onward, managers using a manager-mobile view from Phase 5, and possibly customers via a portal from Phase 5 onward. The v1 scope is deliberately narrow because narrow scope ships and broad scope does not, especially when the development team is one person working with AI agents.

## What success looks like

By the end of Phase 1, the success criteria are concrete and observable. Every active vehicle is in the system with full Bluebook and insurance metadata. Every job for the previous month has been logged as a Trip. Fuel and expenses are entered against Trips, not floating in undifferentiated lists. The CEO can answer the question "how much did vehicle X cost versus earn last month?" without opening a spreadsheet. The system is the daily working tool, not a parallel record that exists alongside the real records elsewhere.

## What FleetCo is not

FleetCo is not a SaaS product or a multi-tenant platform. It is not a customer-facing logistics platform. It is not a replacement for IRD-grade accounting (it feeds into accounting workflows but does not replace formal books). It is not a route optimization product. These constraints are intentional. Each of them, if relaxed, would substantially expand scope and risk the project never shipping. They are recorded here so that future sessions do not casually re-open them.

## Operating context

The project is built and maintained by one person, the CEO, using AI coding agents (primarily Claude Code). It is hosted simply (single VPS or small cloud setup) for at least year one. It is Nepal-specific in deep ways: Bikram Sambat calendar awareness, Nepali Rupee currency with paisa as the integer minor unit, Devanagari script support, and the regulatory frameworks of IRD, Bluebook, Bishesh Anumati, and route permits. These are not optional features to add later; they are baked into the data model and the UI from the start, because retrofitting them later would be substantially more expensive than building them in from the foundation.
