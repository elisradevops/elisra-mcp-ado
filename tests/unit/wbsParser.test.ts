import { describe, it, expect } from 'vitest';
import { extractWbsCodes } from '../../src/utils/wbsParser.js';

describe('wbsParser', () => {
  it('extracts standard dotted numeric WBS codes', () => {
    const input = 'The item milestone is 1.2.3.4 and the next is 2.5';
    const result = extractWbsCodes(input);
    expect(result).toContain('1.2.3.4');
    expect(result).toContain('2.5');
    expect(result).toHaveLength(2);
  });

  it('extracts prefixed WBS codes', () => {
    const input = 'We are working on WBS-1.2.3 and platform project P-5.4.1';
    const result = extractWbsCodes(input);
    expect(result).toContain('WBS-1.2.3');
    expect(result).toContain('P-5.4.1');
    expect(result).toHaveLength(2);
  });

  it('strips HTML before matching WBS codes', () => {
    const input = `
      <table>
        <tr>
          <td>WBS Code</td>
          <td>Description</td>
        </tr>
        <tr>
          <td>1.3.4.2</td>
          <td>CDR milestone approval <span style="font-size:12px;">(12.3.4)</span></td>
        </tr>
      </table>
    `;
    const result = extractWbsCodes(input);
    expect(result).toContain('1.3.4.2');
    expect(result).toContain('12.3.4');
    expect(result).toHaveLength(2);
  });

  it('does not match single integers as WBS codes', () => {
    const input = 'Check out requirement 5 and task 12345';
    const result = extractWbsCodes(input);
    expect(result).toHaveLength(0);
  });

  it('handles empty, null, or undefined input', () => {
    expect(extractWbsCodes(null)).toEqual([]);
    expect(extractWbsCodes(undefined)).toEqual([]);
    expect(extractWbsCodes('')).toEqual([]);
  });
});
