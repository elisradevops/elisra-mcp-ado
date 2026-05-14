// ADO REST API DTOs — Phase 1 subset (projects + connection data)

export interface AdoProject {
  id: string;
  name: string;
  description?: string;
  url: string;
  state: string;
  lastUpdateTime?: string;
  visibility?: string;
}

export interface AdoProjectsResponse {
  count: number;
  value: AdoProject[];
}

export interface AdoConnectionData {
  instanceId: string;
  deploymentType?: string;
  serverVersion?: string;
  authenticatedUser?: {
    id: string;
    providerDisplayName: string;
    subjectDescriptor?: string;
    properties?: Record<string, unknown>;
  };
}

export interface AdoErrorResponse {
  $id?: string;
  errorCode?: number;
  eventId?: number;
  message?: string;
  typeName?: string;
  typeKey?: string;
  innerException?: AdoErrorResponse;
}

// ADO field definition as returned by _apis/wit/fields
export interface AdoFieldDefinition {
  referenceName: string;
  name: string;
  type: string;
  readOnly?: boolean;
  isIdentity?: boolean;
  isPickList?: boolean;
  isPickListSuggested?: boolean;
  supportedOperations?: Array<{ referenceName?: string; name: string }>;
}

export interface AdoFieldsResponse {
  count: number;
  value: AdoFieldDefinition[];
}

// ADO work-item-type field entry (per-WIT endpoint)
export interface AdoWitFieldEntry {
  referenceName: string;
  name: string;
  type?: string;
  alwaysRequired?: boolean;
  helpText?: string;
}

export interface AdoWitFieldsResponse {
  count: number;
  value: AdoWitFieldEntry[];
}

// Work item relation as returned by ADO (with $expand=relations or $expand=all)
export interface AdoWorkItemRelation {
  rel: string;
  url: string;
  attributes?: Record<string, unknown>;
}

// Single work item as returned by workitemsbatch or workitems/{id}
export interface AdoWorkItem {
  id: number;
  rev?: number;
  fields: Record<string, unknown>;
  relations?: AdoWorkItemRelation[];
  url?: string;
}

export interface AdoWorkItemsBatchResponse {
  count: number;
  value: AdoWorkItem[];
}

// ADO work-item relation type as returned by _apis/wit/workItemRelationTypes
export interface AdoWorkItemRelationType {
  referenceName: string;
  name: string;
  attributes?: {
    usage: 'workItemLink' | 'resourceLink' | 'remoteWorkItemLink' | string;
    editable?: boolean;
    enabled?: boolean;
    acyclic?: boolean;
    directional?: boolean;
    singleTarget?: boolean;
    topology?: 'tree' | 'network' | 'directedNetwork' | 'dependency' | string;
    isForward?: boolean;
    oppositeEndReferenceName?: string;
  };
  url?: string;
}

export interface AdoWorkItemRelationTypesResponse {
  count?: number;
  value: AdoWorkItemRelationType[];
}

// Compact work item shape — used in all overview/sample responses
export interface AdoCompactWorkItem {
  id: number;
  title: string;
  workItemType: string;
  state: string;
  areaPath?: string;
  iterationPath?: string;
  assignedTo?: string;
  changedDate?: string;
  url?: string;
}
