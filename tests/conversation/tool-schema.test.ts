import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  guardAgainstFabricatedBriefFields,
  recordBriefUpdatesJsonSchema,
  recordBriefUpdatesSchema,
  sanitizeShareWork,
  shareWorkJsonSchema,
  shareWorkSchema
} from '@/lib/conversation/tool-schema';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateJsonSchema = ajv.compile(recordBriefUpdatesJsonSchema);

const positiveFixture = {
  service: 'production',
  projectType: 'Brand film',
  projectScope: '30s hero spot',
  projectObjective: 'Build launch awareness',
  audience: 'Young adults',
  intendedOutputs: 'Hero film and social cut-downs',
  referencesStatus: 'added',
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
  projectObjective: 'Build launch awareness',
  audience: 'Young adults',
  intendedOutputs: 'Hero film and social cut-downs',
  referencesStatus: 'skipped',
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

test('consentToShare is NOT part of the LLM-controlled tool schema', () => {
  const shape = (recordBriefUpdatesSchema as unknown as { shape: Record<string, unknown> }).shape;
  expect(shape).not.toHaveProperty('consentToShare');
});

test('rejects consentToShare from LLM tool call', () => {
  const result = recordBriefUpdatesSchema.safeParse({
    service: 'production',
    projectType: 'Video',
    projectScope: '30s animation',
    projectObjective: '',
    audience: '',
    intendedOutputs: '',
    referencesStatus: '',
    scopePolished: '',
    timelineBand: '1-2-months',
    budgetBand: '20k-50k',
    contactName: 'Tool',
    contactCompany: 'Acme',
    contactEmail: 'tool@example.com',
    consentToShare: true
  });
  expect(result.success).toBe(false);
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
      projectObjective: '',
      audience: '',
      intendedOutputs: '',
      referencesStatus: '',
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

test('tool schema preserves a 4,000-character original scope and rejects 4,001 characters', () => {
  const exactScope = 's'.repeat(4_000);
  const parsed = recordBriefUpdatesSchema.safeParse({ ...positiveFixture, projectScope: exactScope });
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data.projectScope).toBe(exactScope);
  expect(recordBriefUpdatesSchema.safeParse({ ...positiveFixture, projectScope: `${exactScope}x` }).success).toBe(false);

  expect(validateJsonSchema({ ...positiveFixture, projectScope: exactScope })).toBe(true);
  expect(validateJsonSchema({ ...positiveFixture, projectScope: `${exactScope}x` })).toBe(false);
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

describe('shareWorkSchema', () => {
  const ajvShare = new Ajv({ allErrors: true, strict: false });
  const validateShareJsonSchema = ajvShare.compile(shareWorkJsonSchema);

  test('accepts a minimal share_work call (1 slug + default category)', () => {
    const result = shareWorkSchema.safeParse({ slugs: ['milo'] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slugs).toEqual(['milo']);
      expect(result.data.category).toBe('reference');
    }
  });

  test('accepts up to 5 slugs', () => {
    const result = shareWorkSchema.safeParse({
      slugs: ['milo', 'razer', 'msi', 'handshakes', 'compare-club'],
      category: 'pitch'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('pitch');
    }
  });

  test('rejects more than 5 slugs', () => {
    const result = shareWorkSchema.safeParse({
      slugs: ['milo', 'razer', 'msi', 'handshakes', 'compare-club', 'filmninja', 'sccc5x', 'sccc-kaki-says', 'sph-the-future-of-skills']
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty slug array', () => {
    const result = shareWorkSchema.safeParse({ slugs: [] });
    expect(result.success).toBe(false);
  });

  test('rejects unknown category values', () => {
    const result = shareWorkSchema.safeParse({ slugs: ['milo'], category: 'looks-cool' });
    expect(result.success).toBe(false);
  });

  test('strict mode rejects unknown keys', () => {
    const result = shareWorkSchema.safeParse({ slugs: ['milo'], evil: 'x' });
    expect(result.success).toBe(false);
  });

  test('JSON schema accepts the share_work positive fixture', () => {
    const valid = validateShareJsonSchema({ slugs: ['milo'], category: 'reference' });
    expect(valid).toBe(true);
  });
});

describe('sanitizeShareWork', () => {
  test('drops slugs that do not exist in the works file', () => {
    const result = sanitizeShareWork({ slugs: ['milo', 'made-up-slug'], category: 'reference' });
    expect(result.slugs).toEqual(['milo']);
  });

  test('deduplicates slugs and preserves order', () => {
    const result = sanitizeShareWork({ slugs: ['milo', 'milo', 'razer'], category: 'pitch' });
    expect(result.slugs).toEqual(['milo', 'razer']);
  });

  test('caps slugs at 5', () => {
    const result = sanitizeShareWork({
      slugs: [
        'milo',
        'razer',
        'msi',
        'handshakes',
        'compare-club',
        'filmninja',
        'sccc5x',
        'sccc-kaki-says',
        'sph-the-future-of-skills'
      ],
      category: 'reference'
    });
    expect(result.slugs.length).toBe(5);
  });

  test('returns slugs=[] when every slug is invalid', () => {
    const result = sanitizeShareWork({ slugs: ['nope-1', 'nope-2'], category: 'reference' });
    expect(result.slugs).toEqual([]);
  });

  test('defaults category to reference for unknown values', () => {
    const result = sanitizeShareWork({ slugs: ['milo'], category: 'gibberish' });
    expect(result.category).toBe('reference');
  });

  test('accepts mood and pitch categories', () => {
    expect(sanitizeShareWork({ slugs: ['milo'], category: 'mood' }).category).toBe('mood');
    expect(sanitizeShareWork({ slugs: ['milo'], category: 'pitch' }).category).toBe('pitch');
  });

  test('handles missing input', () => {
    expect(sanitizeShareWork(null).slugs).toEqual([]);
    expect(sanitizeShareWork(undefined).slugs).toEqual([]);
  });
});

describe('guardAgainstFabricatedBriefFields', () => {
  test('uses the complete trimmed first user answer as original projectScope', () => {
    const userMessage = '  We need a launch film for the new chair, aimed at young adults.  ';
    const guarded = guardAgainstFabricatedBriefFields(
      { ...positiveFixture, projectScope: 'launch film for the new chair' },
      createDefaultLeadDraft(),
      userMessage
    );

    expect(guarded.projectScope).toBe('We need a launch film for the new chair, aimed at young adults.');
  });

  test('does not let the model assert that a reference was added', () => {
    const guarded = guardAgainstFabricatedBriefFields(
      { ...positiveFixture, referencesStatus: 'added' },
      createDefaultLeadDraft(),
      'Here is my project'
    );
    expect(guarded.referencesStatus).toBe('');
  });
  test('preserves the first project statement and keeps generated wording separate', () => {
    const guarded = guardAgainstFabricatedBriefFields(
      {
        ...positiveFixture,
        projectScope: 'A polished launch-film summary',
        scopePolished: 'A polished launch-film summary'
      },
      { ...createDefaultLeadDraft(), projectScope: 'We need a film for our chair launch' },
      'The audience is young adults'
    );

    expect(guarded.projectScope).toBe('We need a film for our chair launch');
    expect(guarded.scopePolished).toBe('A polished launch-film summary');
  });

  test.each(['Not sure yet', 'Skip', 'Prefer not to share'])(
    'preserves the stable non-answer literal %s',
    (literal) => {
      const guarded = guardAgainstFabricatedBriefFields(
        { ...positiveFixture, audience: literal, intendedOutputs: literal, budgetBand: literal },
        createDefaultLeadDraft(),
        literal
      );

      expect(guarded.audience).toBe(literal);
      expect(guarded.intendedOutputs).toBe(literal);
      expect(guarded.budgetBand).toBe(literal);
    }
  );
  test('strips a fabricated contactName that the user message did not contain', () => {
    const prior = createDefaultLeadDraft();
    const guarded = guardAgainstFabricatedBriefFields(
      {
        service: 'production',
        projectType: 'Video',
        projectScope: '30s animation',
        scopePolished: '',
        timelineBand: '',
        budgetBand: '',
        contactName: 'Whatever',
        contactCompany: '',
        contactEmail: ''
      },
      prior,
      'yes, an event video'
    );
    expect(guarded.contactName).toBe('');
  });

  test('keeps a contactName that the user message did contain as a phrase', () => {
    const prior = createDefaultLeadDraft();
    const guarded = guardAgainstFabricatedBriefFields(
      {
        service: '',
        projectType: '',
        projectScope: '',
        scopePolished: '',
        timelineBand: '',
        budgetBand: '',
        contactName: 'Jayden',
        contactCompany: '',
        contactEmail: ''
      },
      prior,
      'my name is Jayden, I have a 30s animation project'
    );
    expect(guarded.contactName).toBe('Jayden');
  });

  test('keeps a contactName that already exists in the prior draft (no fabrication check needed)', () => {
    const prior = { ...createDefaultLeadDraft(), contactName: 'Existing User' };
    const guarded = guardAgainstFabricatedBriefFields(
      {
        service: '',
        projectType: '',
        projectScope: '',
        scopePolished: '',
        timelineBand: '',
        budgetBand: '',
        contactName: 'Existing User',
        contactCompany: '',
        contactEmail: ''
      },
      prior,
      'just a follow-up'
    );
    expect(guarded.contactName).toBe('Existing User');
  });

  test('strips a fabricated contactEmail when the user message does not contain it', () => {
    const prior = createDefaultLeadDraft();
    const guarded = guardAgainstFabricatedBriefFields(
      {
        service: 'production',
        projectType: '',
        projectScope: '30s animation',
        scopePolished: '',
        timelineBand: '',
        budgetBand: '',
        contactName: '',
        contactCompany: '',
        contactEmail: 'fabricated@example.com'
      },
      prior,
      '30s animation'
    );
    expect(guarded.contactEmail).toBe('');
  });

  test('strips a fabricated contactCompany when the user message does not contain it', () => {
    const prior = createDefaultLeadDraft();
    const guarded = guardAgainstFabricatedBriefFields(
      {
        service: 'production',
        projectType: '',
        projectScope: '30s animation',
        scopePolished: '',
        timelineBand: '',
        budgetBand: '',
        contactName: '',
        contactCompany: 'Hallucinated Co',
        contactEmail: ''
      },
      prior,
      '30s animation'
    );
    expect(guarded.contactCompany).toBe('');
  });

  test('preserves non-name fields verbatim (no fabrication guard on scope, timeline, etc.)', () => {
    const prior = createDefaultLeadDraft();
    const guarded = guardAgainstFabricatedBriefFields(
      {
        service: 'production',
        projectType: 'Video',
        projectScope: '30s animation',
        scopePolished: '',
        timelineBand: '1-2-months',
        budgetBand: '20k-50k',
        contactName: '',
        contactCompany: '',
        contactEmail: ''
      },
      prior,
      '30s animation'
    );
    expect(guarded.projectScope).toBe('30s animation');
    expect(guarded.timelineBand).toBe('1-2-months');
    expect(guarded.budgetBand).toBe('20k-50k');
  });

  test('allows grounded additions to existing intended outputs', () => {
    const guarded = guardAgainstFabricatedBriefFields(
      { ...positiveFixture, intendedOutputs: 'Hero film, social cutdowns, and stills' },
      { ...createDefaultLeadDraft(), intendedOutputs: 'Hero film' },
      'Please also add social cutdowns and stills'
    );

    expect(guarded.intendedOutputs).toBe('Hero film, social cutdowns, and stills');
  });

  test('rejects unsupported additions to existing intended outputs', () => {
    const guarded = guardAgainstFabricatedBriefFields(
      { ...positiveFixture, intendedOutputs: 'Hero film and a television campaign' },
      { ...createDefaultLeadDraft(), intendedOutputs: 'Hero film' },
      'Keep the existing deliverable'
    );

    expect(guarded.intendedOutputs).toBe('Hero film');
  });
});
