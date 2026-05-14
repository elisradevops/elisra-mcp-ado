import { describe, it, expect } from 'vitest';
import { rewriteDefinitionsToDefs } from '../../src/mcp/schemaCompat.js';

describe('rewriteDefinitionsToDefs — passthrough for schemas without issues', () => {
  it('returns flat schema unchanged', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    const result = rewriteDefinitionsToDefs(schema) as typeof schema;
    expect(result).toEqual(schema);
    expect('definitions' in result).toBe(false);
    expect('$defs' in result).toBe(false);
  });

  it('returns null unchanged', () => {
    expect(rewriteDefinitionsToDefs(null)).toBeNull();
  });
});

describe('rewriteDefinitionsToDefs — definitions → $defs rename', () => {
  it('renames top-level definitions key', () => {
    const schema = {
      type: 'object',
      definitions: { Node: { type: 'string' } },
      properties: { root: { $ref: '#/definitions/Node' } },
    };
    const result = rewriteDefinitionsToDefs(schema) as Record<string, unknown>;
    expect('definitions' in result).toBe(false);
    expect('$defs' in result).toBe(true);
    expect((result.$defs as Record<string, unknown>).Node).toEqual({ type: 'string' });
  });

  it('rewrites all $ref paths from #/definitions/ to #/$defs/', () => {
    const schema = {
      definitions: { Node: { type: 'object', properties: { child: { $ref: '#/definitions/Node' } } } },
      $ref: '#/definitions/Node',
    };
    const json = JSON.stringify(rewriteDefinitionsToDefs(schema));
    expect(json).not.toContain('#/definitions/');
    expect(json).toContain('#/$defs/');
  });
});

describe('rewriteDefinitionsToDefs — path-based $ref removal', () => {
  it('replaces $ref "#/properties/..." with {} (empty schema)', () => {
    const schema = {
      type: 'object',
      properties: {
        filter: {
          anyOf: [
            { type: 'object', properties: { kind: { const: 'condition' } }, required: ['kind'] },
            {
              type: 'object',
              properties: {
                kind: { const: 'and' },
                nodes: { type: 'array', items: { $ref: '#/properties/filter' } },
              },
              required: ['kind', 'nodes'],
            },
          ],
        },
      },
    };
    const result = rewriteDefinitionsToDefs(schema);
    const json = JSON.stringify(result);
    expect(json).not.toContain('#/properties/filter');
    // The $ref node should be replaced with {}
    expect(json).toContain('"items":{}');
  });

  it('does NOT remove $defs-based $refs', () => {
    const schema = {
      $defs: { Node: { type: 'string' } },
      properties: { x: { $ref: '#/$defs/Node' } },
    };
    const json = JSON.stringify(rewriteDefinitionsToDefs(schema));
    expect(json).toContain('#/$defs/Node');
  });
});

describe('rewriteDefinitionsToDefs — real FilterNodeSchema', () => {
  it('removes all path-based $ref values from FilterNodeSchema output', async () => {
    const { FilterNodeSchema } = await import('../../src/domain/fieldFilter.js');
    const { zodToJsonSchema } = await import('zod-to-json-schema');
    const { z } = await import('zod');

    // Simulate how the MCP SDK embeds the schema in a tool input object
    const toolInput = z.object({ filter: FilterNodeSchema.optional(), pat: z.string().optional() });
    const raw = zodToJsonSchema(toolInput, { strictUnions: true, pipeStrategy: 'input' });

    // Verify it contains path refs before patching
    expect(JSON.stringify(raw)).toContain('"$ref":"#/properties/filter"');

    const patched = rewriteDefinitionsToDefs(raw);
    const json = JSON.stringify(patched);

    // After patching: no path refs remain
    expect(json).not.toContain('"$ref":"#/properties/filter"');
    // The condition branch (no $ref) should still be intact
    expect(json).toContain('"condition"');
  });
});
