import { isIP } from 'node:net';
import { z } from 'zod';

import schema from '../../config/monday-crm-schema.json';

const sensitiveQueryParameterNames = new Set([
  'signature',
  'token',
  'secret',
  'credential',
  'password',
  'authorization',
  'auth',
  'api_key',
  'apikey',
  'access_key',
  'accesskey',
  'sig',
  'se',
  'x_amz_signature',
  'x_amz_credential',
  'x_amz_security_token',
  'x_goog_signature',
  'x_goog_credential',
  'x_ms_signature',
]);

function isSensitiveQueryParameter(name: string) {
  return sensitiveQueryParameterNames.has(name.toLowerCase().replace(/-/g, '_'));
}

function isReservedIpv4(value: string) {
  const [first, second, third] = value.split('.').map(Number);
  return (
    first === 0 ||
    first === 10 ||
    first === 100 && second >= 64 && second <= 127 ||
    first === 127 ||
    first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 ||
    first === 192 && (second === 0 || second === 168 || second === 18 || second === 19 || second === 88 && third === 99) ||
    first === 198 && (second === 18 || second === 19 || second === 51 && third === 100) ||
    first === 203 && second === 0 && third === 113 ||
    first >= 224
  );
}

function ipv6ToBigInt(value: string) {
  const address = value.replace(/^\[|\]$/g, '');
  const [before = '', after = ''] = address.split('::');
  const leading = before ? before.split(':') : [];
  const trailing = after ? after.split(':') : [];
  const missing = 8 - leading.length - trailing.length;
  return BigInt(`0x${[...leading, ...Array(missing).fill('0'), ...trailing]
    .map((segment) => segment.padStart(4, '0'))
    .join('')}`);
}

function ipv6InRange(value: bigint, network: string, prefixLength: number) {
  const shift = BigInt(128 - prefixLength);
  return value >> shift === ipv6ToBigInt(network) >> shift;
}

function embeddedIpv4(value: bigint) {
  const prefix = value >> 32n;
  if (prefix !== 0n && prefix !== 0xffffn) return null;

  const address = Number(value & 0xffffffffn);
  return [
    address >>> 24,
    address >>> 16 & 0xff,
    address >>> 8 & 0xff,
    address & 0xff,
  ].join('.');
}

function isReservedIpv6(value: string) {
  const address = ipv6ToBigInt(value);
  const ipv4 = embeddedIpv4(address);
  return (
    address === 0n ||
    address === 1n ||
    ipv6InRange(address, '100::', 64) ||
    ipv6InRange(address, 'fc00::', 7) ||
    ipv6InRange(address, 'fe80::', 10) ||
    ipv6InRange(address, 'ff00::', 8) ||
    ipv6InRange(address, '2001:2::', 48) ||
    ipv6InRange(address, '2001:db8::', 32) ||
    ipv4 !== null && isReservedIpv4(ipv4)
  );
}

function isReservedIpLiteral(hostname: string) {
  const address = hostname.replace(/^\[|\]$/g, '');
  const version = isIP(address);
  if (version === 4) return isReservedIpv4(address);
  if (version === 6) return isReservedIpv6(address);
  return false;
}

function normalizePublicReferenceUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Reference URL must be a valid URL');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const ipVersion = isIP(hostname.replace(/^\[|\]$/g, ''));
  if (url.hostname !== hostname) url.hostname = hostname;
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test') ||
    !ipVersion && !hostname.includes('.') ||
    isReservedIpLiteral(hostname) ||
    [...url.searchParams.keys()].some(isSensitiveQueryParameter)
  ) {
    throw new Error('Reference URL must be a normalized public HTTPS URL');
  }

  url.searchParams.sort();
  return url.toString();
}

export const publicReferenceUrlSchema = z.string()
  .superRefine((value, context) => {
    try {
      normalizePublicReferenceUrl(value);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid reference URL',
      });
    }
  })
  .transform(normalizePublicReferenceUrl);

export const approvedCrmSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  crmRecordId: z.string().uuid(),
  approvedRevision: z.number().int().positive(),
  approvedDraftVersion: z.number().int().nonnegative(),
  approvedAt: z.string().datetime(),
  producerTransferNoticeVersion: z.string().min(1),
  producerTransferRecordedAt: z.string().datetime(),
  contactName: z.string().max(500).nullable(),
  contactEmail: z.string().email().nullable(),
  company: z.string().max(500).nullable(),
  service: z.string().max(200).nullable(),
  projectType: z.string().max(500).nullable(),
  projectScope: z.string().max(4_000).nullable(),
  projectObjective: z.string().max(4_000).nullish().transform((value) => value ?? null),
  audience: z.string().max(4_000).nullish().transform((value) => value ?? null),
  intendedOutputs: z.string().max(4_000).nullish().transform((value) => value ?? null),
  scopePolished: z.string().max(4_000).nullish().transform((value) => value ?? null),
  referencesStatus: z.string().max(500).nullish().transform((value) => value ?? null),
  timeline: z.string().max(500).nullable(),
  budget: z.string().max(500).nullable(),
  qualificationStatus: z.enum(['qualified', 'needs_review', 'misfit', 'unqualified']),
  score: z.number().int().min(0),
  recommendedNextStep: z.enum(['schedule', 'manual_review', 'redirect', 'human_followup']),
  referenceLinks: z.array(z.object({
    url: publicReferenceUrlSchema,
    label: z.string().max(254).nullable(),
  })).max(20),
});

type ApprovedCrmSnapshot = z.output<typeof approvedCrmSnapshotSchema>;
type MondayColumnValues = Record<string, string | number | { email: string; text: string } | { text: string } | { index: number }>;

function labelValue(column: keyof typeof schema.statusLabelIds, value: string) {
  const labelId = (schema.statusLabelIds[column] as Record<string, unknown>)[value];
  if (typeof labelId !== 'number') {
    throw new Error(`Missing numeric Monday label ID for ${column}: ${value}`);
  }
  return { index: labelId };
}

function withoutUndefined(values: Record<string, MondayColumnValues[string] | undefined>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as MondayColumnValues;
}

function columnValues(snapshot: ApprovedCrmSnapshot) {
  const links = [...snapshot.referenceLinks]
    .sort((left, right) => left.url.localeCompare(right.url))
    .map(({ url, label }) => label ? `${url} | ${label}` : url)
    .join('\n');
  const projectDetails = [
    snapshot.projectScope && `Project scope: ${snapshot.projectScope}`,
    snapshot.projectObjective && `Objective: ${snapshot.projectObjective}`,
    snapshot.audience && `Audience: ${snapshot.audience}`,
    snapshot.intendedOutputs && `Outputs: ${snapshot.intendedOutputs}`,
    snapshot.scopePolished && `Brief summary: ${snapshot.scopePolished}`,
    snapshot.referencesStatus && `References: ${snapshot.referencesStatus}`,
  ].filter((value): value is string => Boolean(value)).join('\n\n');

  return withoutUndefined({
    [schema.columns.crm_record_id.id]: snapshot.crmRecordId,
    [schema.columns.contact_name.id]: snapshot.contactName ?? undefined,
    [schema.columns.contact_email.id]: snapshot.contactEmail
      ? { email: snapshot.contactEmail, text: snapshot.contactName ?? snapshot.contactEmail }
      : undefined,
    [schema.columns.company.id]: snapshot.company ?? undefined,
    [schema.columns.service.id]: snapshot.service ? labelValue('service', snapshot.service) : undefined,
    [schema.columns.project_type.id]: snapshot.projectType ?? undefined,
    [schema.columns.project_scope.id]: projectDetails ? { text: projectDetails.slice(0, 2_000) } : undefined,
    [schema.columns.timeline.id]: snapshot.timeline ?? undefined,
    [schema.columns.budget.id]: snapshot.budget ? labelValue('budget', snapshot.budget) : undefined,
    [schema.columns.qualification_status.id]: labelValue('qualification_status', snapshot.qualificationStatus),
    [schema.columns.lead_score.id]: snapshot.score,
    [schema.columns.recommended_next_step.id]: labelValue('recommended_next_step', snapshot.recommendedNextStep),
    [schema.columns.source_channel.id]: labelValue('source_channel', 'balance-assist'),
    [schema.columns.approved_at.id]: snapshot.approvedAt.slice(0, 10),
    [schema.columns.approved_revision.id]: snapshot.approvedRevision,
    [schema.columns.reference_links.id]: links || undefined,
  });
}

function itemName(snapshot: ApprovedCrmSnapshot) {
  const shortCrmId = snapshot.crmRecordId.slice(0, 8);
  const prefix = 'Balance Assist - ';
  const suffix = ` - ${shortCrmId}`;
  const subject = snapshot.service || snapshot.projectType;
  if (!subject) return `${prefix}${shortCrmId}`;
  return `${prefix}${subject.slice(0, 255 - prefix.length - suffix.length)}${suffix}`;
}

export function buildMondayCreatePayload(snapshotInput: unknown) {
  const snapshot = approvedCrmSnapshotSchema.parse(snapshotInput);
  return { itemName: itemName(snapshot), columnValues: columnValues(snapshot) };
}

export function buildMondayUpdatePayload(snapshotInput: unknown) {
  return columnValues(approvedCrmSnapshotSchema.parse(snapshotInput));
}
