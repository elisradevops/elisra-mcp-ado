export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Confidence {
  level: ConfidenceLevel;
  reason: string;
  evidence: string[];
  limitation?: string;
}
