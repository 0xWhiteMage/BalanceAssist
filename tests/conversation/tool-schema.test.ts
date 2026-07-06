import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  recordBriefUpdatesJsonSchema,
  recordBriefUpdatesSchema
} from '@/lib/conversation/tool-schema';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateJsonSchema = ajv.compile(recordBriefUpdatesJsonSchema);

const positiveFixture = {
  service: 'production',
  projectType: 'Brand film',
  projectScope: '30s hero spot',
  scopePolished: '',
  timelineBand: '1-2-months',
  budgetBand: '50k-150k',
  contactName: 'Alex Tan',
  contactCompany: 'Acme Co',
  contactEmail: 'alex@acme.com'
};

const negativeFixture = {
  service: 'production',
  projectType: 'Brand film',
  projectScope: '30s hero spot',
  scopePolished: '',
  timelineBand: '1-2-months',
  budgetBand: '50k-150k',
  contactName: 'Alex Tan',
  contactCompany: 'Acme Co',
  contactEmail: 'not-an-email'
};

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObject((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

test('referenceLinks and referenceFiles are no longer part of the Zod schema', () => {
  const shape = (recordBriefUpdatesSchema as unknown as { shape: Record<string, unknown> }).shape;
  expect(shape).not.toHaveProperty('referenceLinks');
  expect(shape).not.toHaveProperty('referenceFiles');
});

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
    contactEmail: ''
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toEqual({
      service: '',
      projectType: '',
      projectScope: '30s animation',
      scopePolished: '',
      timelineBand: '',
      budgetBand: '',
      contactName: '',
      contactCompany: '',
      contactEmail: ''
    });
  }
});

test('happy path: parsed data matches default-everywhere object', () => {
  const result = recordBriefUpdatesSchema.safeParse(positiveFixture);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toEqual({ ...positiveFixture });
  }
});

test('contactEmail: empty string is accepted', () => {
  const result = recordBriefUpdatesSchema.safeParse({ contactEmail: '' });
  expect(result.success).toBe(true);
});

test('contactEmail: undefined is accepted', () => {
  const result = recordBriefUpdatesSchema.safeParse({ contactEmail: undefined });
  expect(result.success).toBe(true);
});

test('contactEmail: malformed string is rejected', () => {
  const result = recordBriefUpdatesSchema.safeParse({ contactEmail: 'not-an-email' });
  expect(result.success).toBe(false);
});

test('strict mode rejects extra keys', () => {
  const result = recordBriefUpdatesSchema.safeParse({
    projectScope: 'hi',
    extraKey: 'nope'
  });
  expect(result.success).toBe(false);
});

test('JSON schema rejects payloads with extra keys', () => {
  const valid = validateJsonSchema({
    ...positiveFixture,
    extraKey: 'nope'
  });
  expect(valid).toBe(false);
});

test('JSON schema rejects malformed email', () => {
  const valid = validateJsonSchema(negativeFixture);
  expect(valid).toBe(false);
});

test('JSON schema accepts the positive fixture', () => {
  const valid = validateJsonSchema(positiveFixture);
  expect(valid).toBe(true);
});

test('JSON schema top-level required lists every key', () => {
  const required = (recordBriefUpdatesJsonSchema as { required?: string[] }).required ?? [];
  const properties = Object.keys(
    (recordBriefUpdatesJsonSchema as { properties: Record<string, unknown> }).properties
  );
  for (const key of properties) {
    expect(required).toContain(key);
  }
});

test('JSON schema declares contactEmail with format email', () => {
  const emailSchema = (recordBriefUpdatesJsonSchema as {
    properties: { contactEmail: { anyOf?: Array<{ format?: string; const?: string }> } };
  }).properties.contactEmail;
  const branches = emailSchema.anyOf ?? [];
  expect(branches.some((b) => b.const === '')).toBe(true);
  expect(branches.some((b) => b.format === 'email')).toBe(true);
});

test('JSON schema result is independent of property key order', () => {
  const reordered: Record<string, unknown> = {};
  for (const key of Object.keys(positiveFixture).reverse()) {
    reordered[key] = (positiveFixture as Record<string, unknown>)[key];
  }
  const a = validateJsonSchema(positiveFixture);
  const b = validateJsonSchema(reordered);
  expect(a).toBe(b);
  expect(sortObject(positiveFixture)).toEqual(sortObject(reordered));
});

test('Zod and JSON schema agree on positive fixture', () => {
  const zodOk = recordBriefUpdatesSchema.safeParse(positiveFixture).success;
  const jsonOk = validateJsonSchema(positiveFixture);
  expect(zodOk).toBe(jsonOk);
});

test('Zod and JSON schema agree on negative fixture', () => {
  const zodOk = recordBriefUpdatesSchema.safeParse(negativeFixture).success;
  const jsonOk = validateJsonSchema(negativeFixture);
  expect(zodOk).toBe(jsonOk);
});
