import { describe, expect, it } from '@jest/globals';

import { driverGreeting } from './greeting';

describe('driverGreeting', () => {
  it('greets generically when no name is given', () => {
    expect(driverGreeting()).toBe('Welcome to FleetCo Driver');
  });

  it('greets a named driver', () => {
    expect(driverGreeting('Ram')).toBe('Welcome, Ram');
  });

  it('falls back to the generic greeting for a blank name', () => {
    expect(driverGreeting('   ')).toBe('Welcome to FleetCo Driver');
  });
});
