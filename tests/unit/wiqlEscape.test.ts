import { describe, it, expect } from 'vitest';
import {
  escapeWiqlString,
  quoteWiqlString,
  isWiqlMacro,
  validateMacro,
  formatScalarValue,
  formatArrayValue,
} from '../../src/domain/wiqlEscape.js';

describe('escapeWiqlString', () => {
  it('passes plain string unchanged', () => {
    expect(escapeWiqlString('hello')).toBe('hello');
  });

  it("escapes single quotes by doubling them", () => {
    expect(escapeWiqlString("it's")).toBe("it''s");
  });

  it('escapes multiple single quotes', () => {
    expect(escapeWiqlString("a'b'c")).toBe("a''b''c");
  });

  it('rejects string exceeding 4000 chars', () => {
    expect(() => escapeWiqlString('x'.repeat(4001))).toThrow(/too long/);
  });

  it('accepts string of exactly 4000 chars', () => {
    expect(() => escapeWiqlString('x'.repeat(4000))).not.toThrow();
  });

  it('rejects control characters (null byte)', () => {
    expect(() => escapeWiqlString('abc\x00def')).toThrow(/control characters/);
  });

  it('rejects control characters (ESC)', () => {
    expect(() => escapeWiqlString('abc\x1Bdef')).toThrow(/control characters/);
  });

  it('allows tab, newline, carriage return', () => {
    expect(() => escapeWiqlString('a\tb\nc\rd')).not.toThrow();
  });
});

describe('quoteWiqlString', () => {
  it('wraps in single quotes', () => {
    expect(quoteWiqlString('hello')).toBe("'hello'");
  });

  it('escapes inner quote and wraps', () => {
    expect(quoteWiqlString("it's")).toBe("'it''s'");
  });
});

describe('isWiqlMacro', () => {
  it('recognizes @project', () => expect(isWiqlMacro('@project')).toBe(true));
  it('recognizes @me', () => expect(isWiqlMacro('@me')).toBe(true));
  it('recognizes @today', () => expect(isWiqlMacro('@today')).toBe(true));
  it('recognizes @today - 7', () => expect(isWiqlMacro('@today - 7')).toBe(true));
  it('recognizes @today + 1', () => expect(isWiqlMacro('@today + 1')).toBe(true));
  it('recognizes @startOfDay', () => expect(isWiqlMacro('@startOfDay')).toBe(true));
  it('recognizes @startOfWeek', () => expect(isWiqlMacro('@startOfWeek')).toBe(true));
  it('rejects plain string', () => expect(isWiqlMacro('hello')).toBe(false));
  it('rejects @ alone', () => expect(isWiqlMacro('@')).toBe(false));
  it('rejects @123 (starts with digit)', () => expect(isWiqlMacro('@123')).toBe(false));
  it('handles leading/trailing whitespace', () => expect(isWiqlMacro('  @me  ')).toBe(true));
});

describe('formatScalarValue', () => {
  it('formats string as quoted', () => {
    expect(formatScalarValue('Active')).toBe("'Active'");
  });

  it('emits macro unquoted', () => {
    expect(formatScalarValue('@today')).toBe('@today');
  });

  it('emits @today - 7 unquoted', () => {
    expect(formatScalarValue('@today - 7')).toBe('@today - 7');
  });

  it('formats integer as string', () => {
    expect(formatScalarValue(42)).toBe('42');
  });

  it('formats float as string', () => {
    expect(formatScalarValue(3.14)).toBe('3.14');
  });

  it('rejects non-finite number', () => {
    expect(() => formatScalarValue(Infinity)).toThrow(/finite/);
    expect(() => formatScalarValue(NaN)).toThrow(/finite/);
  });

  it('formats boolean true', () => {
    expect(formatScalarValue(true)).toBe('True');
  });

  it('formats boolean false', () => {
    expect(formatScalarValue(false)).toBe('False');
  });
});

describe('formatArrayValue', () => {
  it('formats string array', () => {
    expect(formatArrayValue(['Active', 'Resolved'])).toBe("('Active', 'Resolved')");
  });

  it('formats numeric array', () => {
    expect(formatArrayValue([1, 2, 3])).toBe('(1, 2, 3)');
  });

  it('formats single value', () => {
    expect(formatArrayValue(['Active'])).toBe("('Active')");
  });

  it('rejects empty array', () => {
    expect(() => formatArrayValue([])).toThrow(/at least one/);
  });

  it('includes macro unquoted in array', () => {
    expect(formatArrayValue(['@me', 'John'])).toBe("(@me, 'John')");
  });
});

describe('validateMacro', () => {
  it('accepts known bare macros', () => {
    expect(validateMacro('@Me')).toBe('@Me');
    expect(validateMacro('@today')).toBe('@today');
    expect(validateMacro('@CurrentIteration')).toBe('@CurrentIteration');
    expect(validateMacro('@StartOfDay')).toBe('@StartOfDay');
    expect(validateMacro('@Follows')).toBe('@Follows');
  });

  it('accepts bare arithmetic (no unit)', () => {
    expect(validateMacro('@today - 7')).toBe('@today - 7');
    expect(validateMacro('@today + 1')).toBe('@today + 1');
  });

  it('accepts arithmetic with unit suffix', () => {
    expect(validateMacro('@today - 30d')).toBe('@today - 30d');
    expect(validateMacro('@StartOfWeek + 1w')).toBe('@StartOfWeek + 1w');
    expect(validateMacro('@today - 2mo')).toBe('@today - 2mo');
    expect(validateMacro('@today - 1y')).toBe('@today - 1y');
  });

  it('accepts parameterized form', () => {
    expect(validateMacro("@CurrentIteration('[MyProj]\\TeamA')")).toBe("@CurrentIteration('[MyProj]\\TeamA')");
  });

  it('trims surrounding whitespace', () => {
    expect(validateMacro('  @me  ')).toBe('@me');
  });

  it('rejects unknown macro name', () => {
    expect(() => validateMacro('@Yesterday')).toThrow(/Unknown WIQL macro/);
    expect(() => validateMacro('@Foo')).toThrow(/Valid macros/);
  });

  it('rejects malformed macro syntax', () => {
    expect(() => validateMacro('@today - 3z')).toThrow(/Invalid WIQL macro syntax/);
  });

  it('rejects oversized arithmetic offset (>4 digits)', () => {
    expect(() => validateMacro('@today - 99999')).toThrow(/Invalid WIQL macro syntax/);
  });

  it('rejects macro arg containing control characters', () => {
    expect(() => validateMacro('@CurrentIteration(\'[Proj\x00]\')')).toThrow(/control characters/);
  });
});
