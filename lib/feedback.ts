// Parsing for what the app sends with POST /api/suggestions (server.ts): the "Have a
// suggestion" form and its "Report a problem" variant on Profile share one endpoint and one
// collection (models/Suggestion.ts). Pure, so it's testable without a database
// (lib/feedback.test.ts).

export type FeedbackKind = 'suggestion' | 'problem';

export interface FeedbackContext {
  appVersion?: string;
  platform?: string;
  osVersion?: string;
  deviceModel?: string;
}

const CONTEXT_FIELDS = ['appVersion', 'platform', 'osVersion', 'deviceModel'] as const;
const MAX_CONTEXT_VALUE_LENGTH = 80;

export function parseFeedbackKind(value: unknown): FeedbackKind {
  return value === 'problem' ? 'problem' : 'suggestion';
}

// A problem report carries the app version and phone model so a tester doesn't have to be
// asked for them. Client-supplied, so: known keys only, strings only, clipped.
export function sanitizeFeedbackContext(value: unknown): FeedbackContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const context: FeedbackContext = {};
  for (const field of CONTEXT_FIELDS) {
    const raw = (value as Record<string, unknown>)[field];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().slice(0, MAX_CONTEXT_VALUE_LENGTH);
    if (trimmed) context[field] = trimmed;
  }
  return Object.keys(context).length > 0 ? context : undefined;
}
