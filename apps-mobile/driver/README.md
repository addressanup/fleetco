# FleetCo Driver (mobile)

The driver-facing mobile app — Expo / React Native, Android-first. A **standalone
sub-project outside the pnpm workspace** per **ADR-0033** (own lockfile, installed
with `--ignore-workspace`).

## Status

**D0 — toolchain spike.** Scaffold + CI gate + a no-login screen only. Driver
auth (ADR-0034), trip/fuel entry, and GPS capture (ADR-0035) arrive in D1–D5.

## Run it (dev)

This package is **not** a workspace member; install with `--ignore-workspace`:

```sh
cd apps-mobile/driver
pnpm install --ignore-workspace
pnpm start          # then scan the QR code with Expo Go on an Android phone
```

The device-build path (EAS / local prebuild) is **deferred** per ADR-0033 — Expo
Go is the D0–D3 on-device runtime. See `docs/runbook/dev-setup.md`.

## Checks (what the mobile CI job runs)

```sh
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint (eslint-config-expo)
pnpm test           # jest-expo
```
