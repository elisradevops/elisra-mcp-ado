import { describe, it, expect } from 'vitest';
import {
  API_VERSION_LADDER,
  parseApiMajor,
  shouldStepDown,
} from '../../src/ado/apiVersionLadder.js';

describe('API_VERSION_LADDER', () => {
  it('includes 4.1 rung for TFS 2018', () => {
    expect(API_VERSION_LADDER).toContain('4.1');
  });

  it('orders from highest to lowest', () => {
    const versions = API_VERSION_LADDER.filter((v): v is string => v !== null);
    const majors = versions.map((v) => parseFloat(v));
    for (let i = 1; i < majors.length; i++) {
      expect(majors[i]).toBeLessThan(majors[i - 1]);
    }
  });

  it('ends with null (no-version fallback)', () => {
    expect(API_VERSION_LADDER[API_VERSION_LADDER.length - 1]).toBeNull();
  });
});

describe('parseApiMajor', () => {
  it('parses major version from standard version string', () => {
    expect(parseApiMajor('7.0')).toBe(7);
    expect(parseApiMajor('5.1')).toBe(5);
    expect(parseApiMajor('4.1')).toBe(4);
  });

  it('parses preview version strings', () => {
    expect(parseApiMajor('7.1-preview.1')).toBe(7);
  });

  it('returns NaN for null', () => {
    expect(parseApiMajor(null)).toBeNaN();
  });

  it('returns NaN for undefined', () => {
    expect(parseApiMajor(undefined)).toBeNaN();
  });

  it('returns NaN for empty string', () => {
    expect(parseApiMajor('')).toBeNaN();
  });

  it('returns NaN for non-numeric string', () => {
    expect(parseApiMajor('latest')).toBeNaN();
  });
});

describe('shouldStepDown', () => {
  it('returns true for 400', () => expect(shouldStepDown(400)).toBe(true));
  it('returns true for 404', () => expect(shouldStepDown(404)).toBe(true));
  it('returns true for 405', () => expect(shouldStepDown(405)).toBe(true));
  it('returns true for 410', () => expect(shouldStepDown(410)).toBe(true));
  it('returns false for 401', () => expect(shouldStepDown(401)).toBe(false));
  it('returns false for 403', () => expect(shouldStepDown(403)).toBe(false));
  it('returns false for 500', () => expect(shouldStepDown(500)).toBe(false));
  it('returns false for 200', () => expect(shouldStepDown(200)).toBe(false));
});
