import { describe, it, expect } from 'vitest';
import { GenericWiqlCompiler, createDefaultCompiler } from '../../src/domain/genericWiqlCompiler.js';
import { SEED_FIELD_CATALOG } from '../../src/domain/adoFields.js';

function compiler(allowUnknown = false): GenericWiqlCompiler {
  return new GenericWiqlCompiler(SEED_FIELD_CATALOG, allowUnknown);
}

describe('GenericWiqlCompiler — basic output', () => {
  it('emits SELECT ... FROM WorkItems with no filters', () => {
    const { wiql } = compiler().compile({ filters: [] });
    expect(wiql).toContain('SELECT [System.Id] FROM WorkItems');
  });

  it('emits project clause when project supplied', () => {
    const { wiql } = compiler().compile({ project: 'MyProject', filters: [] });
    expect(wiql).toContain('[System.TeamProject] = @project');
  });

  it('omits WHERE section when no project and no filters', () => {
    const { wiql } = compiler().compile({ filters: [] });
    expect(wiql).not.toContain('WHERE');
  });

  it('emits WHERE when project but no filters', () => {
    const { wiql } = compiler().compile({ project: 'P', filters: [] });
    expect(wiql).toContain('WHERE');
  });

  it('emits ORDER BY clause', () => {
    const { wiql } = compiler().compile({
      filters: [],
      orderBy: [{ field: 'System.Id', direction: 'DESC' }],
    });
    expect(wiql).toContain('ORDER BY [System.Id] DESC');
  });

  it('omits ORDER BY when not supplied', () => {
    const { wiql } = compiler().compile({ filters: [] });
    expect(wiql).not.toContain('ORDER BY');
  });
});

describe('GenericWiqlCompiler — field filter compilation', () => {
  it('compiles simple string equality', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'System.State', operator: '=', value: 'Active' }],
    });
    expect(wiql).toContain("[System.State] = 'Active'");
  });

  it('compiles IN operator with array', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'System.State', operator: 'IN', value: ['Active', 'Resolved'] }],
    });
    expect(wiql).toContain("[System.State] IN ('Active', 'Resolved')");
  });

  it('wraps scalar in array for IN operator', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'System.State', operator: 'IN', value: 'Active' }],
    });
    expect(wiql).toContain("[System.State] IN ('Active')");
  });

  it('compiles CONTAINS for string field', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'System.Title', operator: 'CONTAINS', value: 'Login' }],
    });
    expect(wiql).toContain("[System.Title] CONTAINS 'Login'");
  });

  it('compiles numeric comparison', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'Microsoft.VSTS.Common.Priority', operator: '<=', value: 2 }],
    });
    expect(wiql).toContain('[Microsoft.VSTS.Common.Priority] <= 2');
  });

  it('emits @today macro unquoted', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'System.ChangedDate', operator: '>=', value: '@today - 7' }],
    });
    expect(wiql).toContain('[System.ChangedDate] >= @today - 7');
  });

  it('emits @me unquoted for identity field', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'System.AssignedTo', operator: '=', value: '@me' }],
    });
    expect(wiql).toContain('[System.AssignedTo] = @me');
  });
});

describe('GenericWiqlCompiler — TreePath rules', () => {
  it('accepts UNDER for AreaPath', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'System.AreaPath', operator: 'UNDER', value: 'MyProject\\Area' }],
      })
    ).not.toThrow();
  });

  it('accepts NOT UNDER for IterationPath', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'System.IterationPath', operator: 'NOT UNDER', value: 'MyProject\\Sprint 1' }],
      })
    ).not.toThrow();
  });

  it('rejects CONTAINS on TreePath field', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'System.AreaPath', operator: 'CONTAINS', value: 'Area' }],
      })
    ).toThrow(/CONTAINS is not supported for TreePath/);
  });

  it('rejects < on TreePath field (invalid operator)', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'System.IterationPath', operator: '<', value: 'MyProject\\Sprint 1' }],
      })
    ).toThrow(/not valid for field/);
  });
});

describe('GenericWiqlCompiler — long-text fields', () => {
  it('accepts CONTAINS for html field (Description)', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'System.Description', operator: 'CONTAINS', value: 'requirement' }],
      })
    ).not.toThrow();
  });

  it('rejects = for html field', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'System.Description', operator: '=', value: 'anything' }],
      })
    ).toThrow(/not valid for field/);
  });
});

describe('GenericWiqlCompiler — case-insensitive field resolution', () => {
  it('resolves Custom.CustomerId to canonical Custom.CustomerID', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'Custom.CustomerId', operator: '=', value: 'CUST-001' }],
    });
    expect(wiql).toContain('[Custom.CustomerID]');
    expect(wiql).not.toContain('[Custom.CustomerId]');
  });

  it('resolves system.state (all lowercase) to System.State', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'system.state', operator: '=', value: 'Active' }],
    });
    expect(wiql).toContain('[System.State]');
  });

  it('resolves Elisra.testphase to Elisra.TestPhase', () => {
    const { wiql } = compiler().compile({
      filters: [{ field: 'Elisra.testphase', operator: '=', value: 'Alpha' }],
    });
    expect(wiql).toContain('[Elisra.TestPhase]');
  });
});

describe('GenericWiqlCompiler — unknown fields', () => {
  it('throws on unknown field by default', () => {
    expect(() =>
      compiler(false).compile({
        filters: [{ field: 'Custom.NoSuchField', operator: '=', value: 'x' }],
      })
    ).toThrow(/Unknown field/);
  });

  it('emits warning but succeeds when allowUnknownFields=true', () => {
    const { wiql, warnings } = compiler(true).compile({
      filters: [{ field: 'Custom.NoSuchField', operator: '=', value: 'x' }],
    });
    expect(wiql).toContain('[Custom.NoSuchField]');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/not in the known field catalog/);
  });

  it('rejects array value with scalar operator for unknown field', () => {
    expect(() =>
      compiler(true).compile({
        filters: [{ field: 'Custom.NoSuchField', operator: '=', value: ['a', 'b'] }],
      })
    ).toThrow(/requires a scalar value/);
  });
});

describe('GenericWiqlCompiler — operator validation', () => {
  it('rejects UNDER on non-TreePath field', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'System.State', operator: 'UNDER', value: 'something' }],
      })
    ).toThrow(/not valid for field/);
  });

  it('rejects IN on long-text field', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'System.Description', operator: 'IN', value: ['a', 'b'] }],
      })
    ).toThrow(/not valid for field/);
  });

  it('rejects CONTAINS on numeric field', () => {
    expect(() =>
      compiler().compile({
        filters: [{ field: 'Microsoft.VSTS.Common.Priority', operator: 'CONTAINS', value: '1' }],
      })
    ).toThrow(/not valid for field/);
  });
});

describe('createDefaultCompiler', () => {
  it('returns a working compiler backed by seed catalog', () => {
    const c = createDefaultCompiler(false);
    const { wiql } = c.compile({
      filters: [{ field: 'System.State', operator: '=', value: 'Active' }],
    });
    expect(wiql).toContain('SELECT [System.Id]');
  });
});

describe('GenericWiqlCompiler — orderBy injection guards', () => {
  it('rejects orderBy field with bracket injection characters', () => {
    expect(() =>
      compiler().compile({
        filters: [],
        orderBy: [{ field: 'System.Id]; DROP TABLE--', direction: 'ASC' }],
      })
    ).toThrow(/Invalid ORDER BY field/);
  });

  it('rejects orderBy field with space characters', () => {
    expect(() =>
      compiler().compile({
        filters: [],
        orderBy: [{ field: 'System.Id OR 1=1', direction: 'ASC' }],
      })
    ).toThrow(/Invalid ORDER BY field/);
  });

  it('rejects orderBy direction that is not ASC or DESC', () => {
    expect(() =>
      compiler().compile({
        filters: [],
        orderBy: [{ field: 'System.Id', direction: 'ASC; DROP--' as 'ASC' }],
      })
    ).toThrow(/Invalid ORDER BY direction/);
  });

  it('accepts valid field and direction', () => {
    const { wiql } = compiler().compile({
      filters: [],
      orderBy: [{ field: 'System.ChangedDate', direction: 'ASC' }],
    });
    expect(wiql).toContain('ORDER BY [System.ChangedDate] ASC');
  });
});

describe('GenericWiqlCompiler — field name bracket guard', () => {
  it('rejects canonicalField containing bracket characters via allowUnknownFields', () => {
    const c = new GenericWiqlCompiler(SEED_FIELD_CATALOG, true);
    expect(() =>
      c.compile({
        filters: [{ field: 'Bad[Field]Name', operator: '=', value: 'x' }],
      })
    ).toThrow(/illegal bracket/);
  });
});

describe('GenericWiqlCompiler — combined project + filters + orderBy', () => {
  it('produces correctly structured WIQL', () => {
    const { wiql, warnings } = compiler().compile({
      project: 'TestProject',
      filters: [
        { field: 'System.WorkItemType', operator: '=', value: 'Requirement' },
        { field: 'System.State', operator: 'IN', value: ['Active', 'In Progress'] },
        { field: 'System.AreaPath', operator: 'UNDER', value: 'TestProject\\SubArea' },
      ],
      orderBy: [{ field: 'System.ChangedDate', direction: 'DESC' }],
    });
    expect(wiql).toContain('SELECT [System.Id] FROM WorkItems');
    expect(wiql).toContain('[System.TeamProject] = @project');
    expect(wiql).toContain("[System.WorkItemType] = 'Requirement'");
    expect(wiql).toContain("[System.State] IN ('Active', 'In Progress')");
    expect(wiql).toContain("[System.AreaPath] UNDER 'TestProject\\SubArea'");
    expect(wiql).toContain('ORDER BY [System.ChangedDate] DESC');
    expect(warnings).toHaveLength(0);
  });
});
