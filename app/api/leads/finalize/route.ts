import { finalizeLeadPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, finalizeLeadPayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, qualificationStatus, score, recommendedNextStep, leadDraft } = parsed.data;

  if (hasSupabaseServerConfig()) {
    const supabase = createServerSupabaseClient();

    if (supabase) {
      const { error } = await supabase.from('leads').insert({
        session_id: sessionId,
        qualification_status: qualificationStatus,
        score: score ?? null,
        recommended_next_step: recommendedNextStep ?? null,
        lead_draft: leadDraft ?? null,
        contact_name: leadDraft?.contactName ?? null,
        contact_email: leadDraft?.contactEmail ?? null
      });

      if (!error) {
        await supabase
          .from('sessions')
          .update({ status: qualificationStatus === 'qualified' ? 'completed' : 'escalated' })
          .eq('id', sessionId);
      }

      return jsonWithCors({
        ok: true,
        sessionId,
        qualificationStatus
      });
    }
  }

  return jsonWithCors({
    ok: true,
    sessionId,
    qualificationStatus
  });
}