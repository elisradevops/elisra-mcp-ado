import { z } from 'zod';

// Shared auth input — all tools accept an optional auth context
export const AuthInputSchema = z.object({
  pat: z.string().describe('Azure DevOps PAT. Required when ADO_AUTH_MODE=per_request_pat.'),
}).optional();

export type AuthInput = z.infer<typeof AuthInputSchema>;

// ado_ping
export const AdoPingInputSchema = z.object({
  auth: AuthInputSchema,
});
export type AdoPingInput = z.infer<typeof AdoPingInputSchema>;

export interface AdoPingOutput {
  collection: string;
  projects: { id: string; name: string; state: string }[];
  apiVersion: string;
  serverVersion?: string;
}

// ado_discover_fields
export interface AdoDiscoverFieldsOutput {
  totalFields: number;
  source: 'discovered' | 'seed_fallback';
  fields: Array<{
    referenceName: string;
    displayName: string;
    type: string;
    isCustom: boolean;
    isIdentity: boolean;
    isLongText: boolean;
    isTreePath: boolean;
    allowedOperators: string[];
    knownInDocGen: boolean;
    safeForFiltering: boolean;
    safeForGrouping: boolean;
    source: string;
  }>;
  warnings: string[];
}

// ado_check_pat
export const AdoCheckPatInputSchema = z.object({
  auth: AuthInputSchema,
});
export type AdoCheckPatInput = z.infer<typeof AdoCheckPatInputSchema>;

export interface AdoCheckPatOutput {
  valid: boolean;
  displayName?: string;
  id?: string;
  message?: string;
}
