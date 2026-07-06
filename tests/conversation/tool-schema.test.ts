import { recordBriefUpdatesSchema, recordBriefUpdatesJsonSchema } from '@/lib/conversation/tool-schema';

test('rejects unknown keys', () => {
  const result = recordBriefUpdatesSchema.safeParse({ evil: 'x', projectScope: 'hi' });
  expect(result.success).toBe(false);
});

test('accepts all known fields with empty strings', () => {
  const result = recordBriefUpdatesSchema.safeParse({
    service: '',
    projectType: '',
    projectScope: '30s animation',
    scopePolished: '',
    timelineBand: '',
    budgetBand: '',
    contactName: '',
    contactCompany: '',
    contactEmail: '',
    referenceLinks: [],
    referenceFiles: []
  });
  expect(result.success).toBe(true);
});

test('rejects malformed email', () => {
  const result = recordBriefUpdatesSchema.safeParse({ contactEmail: 'not-an-email' });
  expect(result.success).toBe(false);
});

test('exposes a JSON schema for the LLM', () => {
  expect(recordBriefUpdatesJsonSchema.type).toBe('object');
});
