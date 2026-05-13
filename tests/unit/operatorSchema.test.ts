import { describe, it, expect } from 'vitest';
import { OperatorSchema } from '../../src/domain/fieldFilter.js';

function parse(v: unknown) {
  return OperatorSchema.safeParse(v);
}

describe('OperatorSchema — case normalization', () => {
  it('accepts UPPERCASE unchanged', () => {
    expect(parse('UNDER').data).toBe('UNDER');
    expect(parse('IN').data).toBe('IN');
    expect(parse('CONTAINS').data).toBe('CONTAINS');
    expect(parse('NOT UNDER').data).toBe('NOT UNDER');
  });

  it('normalizes lowercase to uppercase', () => {
    expect(parse('under').data).toBe('UNDER');
    expect(parse('in').data).toBe('IN');
    expect(parse('contains').data).toBe('CONTAINS');
    expect(parse('not under').data).toBe('NOT UNDER');
  });

  it('normalizes mixed case', () => {
    expect(parse('Under').data).toBe('UNDER');
    expect(parse('In').data).toBe('IN');
    expect(parse('Contains').data).toBe('CONTAINS');
    expect(parse('Not Under').data).toBe('NOT UNDER');
    expect(parse('Not In').data).toBe('NOT IN');
    expect(parse('Is Empty').data).toBe('IS EMPTY');
    expect(parse('Is Not Empty').data).toBe('IS NOT EMPTY');
    expect(parse('In Group').data).toBe('IN GROUP');
    expect(parse('Not In Group').data).toBe('NOT IN GROUP');
    expect(parse('Does Not Contain').data).toBe('DOES NOT CONTAIN');
    expect(parse('Contains Words').data).toBe('CONTAINS WORDS');
    expect(parse('Was Ever').data).toBe('WAS EVER');
    expect(parse('was ever').data).toBe('WAS EVER');
  });

  it('trims surrounding whitespace before normalizing', () => {
    expect(parse('  under  ').data).toBe('UNDER');
    expect(parse('\tin\t').data).toBe('IN');
    expect(parse(' Not Under ').data).toBe('NOT UNDER');
  });

  it('collapses internal whitespace', () => {
    expect(parse('not  under').data).toBe('NOT UNDER');
    expect(parse('is   empty').data).toBe('IS EMPTY');
    expect(parse('does  not  contain').data).toBe('DOES NOT CONTAIN');
  });
});

describe('OperatorSchema — alias expansion', () => {
  it('maps != to <>', () => {
    expect(parse('!=').data).toBe('<>');
  });

  it('maps == to =', () => {
    expect(parse('==').data).toBe('=');
  });
});

describe('OperatorSchema — all 19 canonical tokens accepted', () => {
  const validTokens = [
    '=', '<>', '<', '<=', '>', '>=',
    'IN', 'NOT IN',
    'CONTAINS', 'DOES NOT CONTAIN',
    'CONTAINS WORDS', 'DOES NOT CONTAIN WORDS',
    'IS EMPTY', 'IS NOT EMPTY',
    'UNDER', 'NOT UNDER',
    'EVER', 'WAS EVER',
    'IN GROUP', 'NOT IN GROUP',
  ];

  for (const token of validTokens) {
    it(`accepts "${token}"`, () => {
      const result = parse(token);
      expect(result.success).toBe(true);
      expect(result.data).toBe(token);
    });
  }
});

describe('OperatorSchema — rejects invalid operators', () => {
  it('rejects LIKE', () => {
    expect(parse('LIKE').success).toBe(false);
  });

  it('rejects BETWEEN', () => {
    expect(parse('BETWEEN').success).toBe(false);
  });

  it('rejects STARTS WITH', () => {
    expect(parse('STARTS WITH').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(parse('').success).toBe(false);
  });

  it('rejects number input', () => {
    expect(parse(42).success).toBe(false);
  });

  it('rejects null', () => {
    expect(parse(null).success).toBe(false);
  });

  it('rejects undefined', () => {
    expect(parse(undefined).success).toBe(false);
  });
});
