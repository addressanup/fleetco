/**
 * D0 placeholder domain logic. It exists only so the toolchain
 * (tsc + eslint + jest-expo) has a pure, deterministic unit to exercise
 * before any real screens or API calls land. Real driver-app logic
 * (auth, trips, fuel, GPS) replaces this from D1 onward — ADR-0034 / ADR-0035.
 */
export function driverGreeting(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? `Welcome, ${trimmed}` : 'Welcome to FleetCo Driver';
}
