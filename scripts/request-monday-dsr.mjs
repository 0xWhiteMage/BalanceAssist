const [crmRecordId, auditRef] = process.argv.slice(2);

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(crmRecordId ?? '') || !/^[A-Za-z0-9._:-]{3,200}$/.test(auditRef ?? '')) {
  throw new Error('Usage: node scripts/request-monday-dsr.mjs <opaque-crm-record-id> <approved-pii-free-case-reference>');
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/request_crm_deletion_by_record_id`, {
  method: 'POST',
  headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_crm_record_id: crmRecordId, p_audit_ref: auditRef }),
});
if (!response.ok || await response.json().catch(() => false) !== true) throw new Error('Monday DSR request was not accepted');
console.log('Monday DSR deletion request queued. Do not treat local deletion as complete until provider cleanup is verified.');
