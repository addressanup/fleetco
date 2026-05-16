# Business Continuity Plan

> **STATUS: STUB.** This document is the founder's commitment to a degraded-mode operation plan and an unavailability handoff. The substantive content below is the framework; specific names, contact details, and credential locations need to be filled in by the founder before Phase 1 ships and updated whenever the operational substrate changes.

A business continuity plan exists for a specific reason: a single-founder, single-customer software business has the same kind of operational fragility that a small medical practice or a one-attorney law firm has. The technical infrastructure is reasonably resilient (Postgres backups, R2 redundancy, CI gates, SLO discipline) but the human substrate is not redundant at all. If the founder is unavailable for two weeks, whether through illness, family emergency, or any other reason, the customer needs to be able to continue operating and the system needs to continue running without the founder making any decisions.

This document is the procedural memory for that scenario. It is written so that the customer or a designated substitute can execute it without needing to ask the founder anything, because by hypothesis the founder is unavailable. It is also written so that the founder, when returning from unavailability, can pick up where things left off without confusion about what happened in the meantime.

## What "unavailability" means

The plan distinguishes between three lengths of unavailability. Short unavailability is up to three working days, such as an unexpected illness or a planned short vacation without internet access. The plan for short unavailability is to inform the customer in advance when possible, monitor incoming alerts via mobile if any reach a SEV1 threshold, and otherwise let routine operations continue without intervention. The system is designed to operate without daily founder attention, so short unavailability should not require any specific action.

Medium unavailability is from four working days to two weeks, such as a longer vacation, a family emergency, or a serious illness with expected recovery. The plan for medium unavailability requires explicit handoff to the customer's designated point of contact, suspension of all non-critical changes (no deploys other than security patches), and preparation of a substitute who can handle SEV1 incidents if they arise during the period.

Extended unavailability is more than two weeks, including indefinite unavailability. The plan for extended unavailability is the most thorough and requires designating a substitute developer or developer team who has the access, the documentation, and the agreement to maintain the system on behalf of the customer until the founder returns or until a more permanent arrangement is made.

## Designated points of contact

The customer has a designated business point of contact who is the person the founder communicates with about scheduling, billing, and operational changes. This person's contact information lives below and is updated whenever the customer organization changes the relationship.

The founder has a designated personal point of contact who is the person who should be informed if the founder is unavailable due to circumstances the founder cannot communicate themselves. This person has access to the basic information needed to inform the customer that an extended unavailability is beginning. This person is typically a family member or close friend rather than a technical person, and their role is communication rather than operational substitution.

The founder has a designated technical substitute who is a developer or developer team capable of handling FleetCo's operational needs in the founder's absence. This is the most consequential designation because it is the person who can actually keep the system running. The substitute is identified by name and contractual relationship, has signed agreements regarding access and confidentiality, and has been given access to the credentials and documentation needed to operate the system.

[TODO: Fill in the actual names, contact methods, and dates of last contact for each of the three designated points of contact. Update this section whenever any of these change.]

## Credentials and access

The credentials needed to operate FleetCo include the production server SSH access, the database superuser credentials, the Cloudflare R2 access keys, the GitHub repository administrative access, the domain registrar account, the email and notification provider credentials, and the payment processing credentials (when Phase 4 introduces them). Each of these is a Tier 1 secret per ADR-0013 and is stored in the production secret store, which itself has access controlled by the founder.

For business continuity purposes, the founder maintains a sealed envelope (physical or in a secure password manager with emergency access enabled) that contains the master credentials needed to bootstrap recovery. The envelope is held by the personal point of contact identified above. The envelope is updated whenever the master credentials change.

[TODO: Fill in the specific format and location of the sealed envelope, the password manager being used, and the emergency access protocol. Update this whenever the credential set changes.]

## Degraded mode operation

In an extreme scenario where the founder is unavailable and the technical substitute cannot be reached, the customer needs to be able to continue operating in a degraded mode that does not require any technical intervention. The system is designed so that the existing data remains accessible read-only through the admin UI for at least 30 days without any administrative attention, because the database backups are scheduled and the application server runs unattended. The customer cannot create new records during this period, but they can see the records that exist, which is sufficient to continue billing customers and paying drivers based on the most recent state of the system.

If the period of unavailability extends beyond 30 days, the customer should engage a different developer or developer team to take over operations. The handoff documentation lives in the runbook and includes the architecture overview, the deployment procedures, the credential locations, and the contact information for the technical substitute.

## What the founder commits to

The founder commits to the following operational disciplines that make this plan workable. The credentials are kept current in the secret store and the emergency envelope. The technical substitute is identified, paid a retainer, and engaged at least quarterly to verify that they can still execute the plan. The customer is informed about the existence of this plan and given the contact information they need to reach the substitute. The plan itself is reviewed at least annually and updated when the operational substrate changes.

These commitments are not ceremonial. They are the difference between a one-person business that survives a serious unavailability and one that loses its customer relationship during the founder's absence. The cost of the commitments is moderate (a quarterly engagement with a substitute, an annual plan review) and the benefit is substantial (a customer who is not exposed to single-point-of-failure risk).

## Last review

[TODO: Fill in the date of the most recent annual review. Update annually.]
