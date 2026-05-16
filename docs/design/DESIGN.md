# DESIGN.md — FleetCo Design System

> **STATUS: STUB.** This file is the canonical design system for FleetCo, but the substantive content has not been authored yet. Authoring it is a Phase 0 deliverable, scheduled before the first UI-bearing slice of Phase 1. See `docs/design/README.md` for the design folder's discipline and ADR-0007 for the design-as-source-of-truth decision.
>
> When this file is filled in, the sections below are the expected structure. The TODO markers indicate where content goes.

## Foundations

### Color tokens

[TODO: define the color palette. Each color has a token name, a hex value, a description of when to use it, and a description of when not to use it. Token names follow a semantic scheme (`color.surface.primary`, `color.text.muted`, `color.border.subtle`) rather than literal scheme (`blue-500`, `gray-300`), so that the meaning persists if the actual hex value changes.]

### Typography

[TODO: define the type scale, font families, line heights, and letter spacing. FleetCo's font stack must include a Devanagari fallback so that Nepali text renders correctly. The type scale should support both dense ERP screens (compact tables, forms) and occasional reading surfaces (reports, settings).]

### Spacing

[TODO: define the spacing scale. Most modern systems use a base-4 or base-8 scale. The scale should support dense layouts without feeling cramped.]

### Sizing

[TODO: define the sizing scale for components: button heights, input heights, icon sizes, card widths.]

### Borders and corners

[TODO: define border weights, corner radii, and the rules for when each is used.]

### Shadows and elevation

[TODO: define the elevation system. Most ERP-like UIs need only a small number of elevation levels (flat, raised, modal).]

## Components

### Buttons

[TODO: define button variants (primary, secondary, ghost, destructive), sizes, states (default, hover, focus, active, disabled, loading), and the rules for when each variant is used.]

### Inputs and forms

[TODO: define text inputs, number inputs, date inputs (with Bikram Sambat support), select dropdowns, checkboxes, radio buttons, toggles, file uploads. Define form layout patterns, label placement, error message presentation, and validation timing.]

### Tables

[TODO: define table layout, header treatment, row spacing, hover and selection states, sorting indicators, pagination patterns, and empty states. Tables are the primary surface for FleetCo and need particular care.]

### Cards

[TODO: define card variants and the rules for when each is used.]

### Modals and drawers

[TODO: define modal and drawer patterns, sizing, dismissal behavior, and the rules for when each is used.]

### Navigation

[TODO: define the primary navigation, breadcrumbs, page headers, and the rules for which information lives where.]

### Data display

[TODO: define how money is displayed (NPR with paisa precision, with thousands separators), how dates are displayed (BS with optional Gregorian, configurable per user preference), how durations are displayed, how distances are displayed, and how status badges are styled.]

## Voice and tone

[TODO: define the voice. ERP UIs have a tone that is precise, calm, factual, and respectful of the user's time. They are not casual or playful. They are not formal or stiff. They acknowledge the operational reality the user is navigating without pretending it is more interesting than it is.]

## Anti-patterns

[TODO: list anti-patterns to avoid. Examples: gradient backgrounds (read as marketing rather than tooling), overly rounded corners on data tables (read as informal), heavy use of color in tables (creates visual noise that hides actual data signals), motion that is decorative rather than functional, modals for tasks that should be inline, full-page reloads for state changes that should be local.]

## Nepal-specific considerations

[TODO: document Devanagari text rendering, BS calendar widgets, NPR currency formatting, and any other locale-specific design decisions.]

## How this file relates to code

The Tailwind theme configuration in `apps/web/tailwind.config.ts` derives from this file. The mechanism for derivation is to be decided in Phase 0; the simplest version is to maintain the tokens here as the canonical record and copy them into `tailwind.config.ts`, with a script in CI that verifies the two are in sync. A more sophisticated version (a build step that generates the Tailwind config from this markdown) can come later if drift becomes a real problem.

When this file changes, the corresponding Tailwind config change is in the same PR. Drift between them is the failure mode and must be prevented.
