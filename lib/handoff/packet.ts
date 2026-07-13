export type PacketAttachment = {
  originalName: string;
  status: string;
  mimeType?: string;
};

export type PacketLink = {
  url: string;
  kind?: string;
};

export type PacketInput = {
  sessionId: string;
  caseId: string;
  routingDestination: string;
  routingReasons: string[];
  qualificationStatus: string;
  score: number;
  draft: {
    service?: string;
    projectType?: string;
    projectScope?: string;
    timelineBand?: string;
    budgetBand?: string;
    contactName?: string;
    contactEmail?: string;
    contactCompany?: string;
  };
  attachments: PacketAttachment[];
  links: PacketLink[];
  consentScope: {
    aiAnalysis: boolean;
    producerShare: boolean;
  };
};

export type HandoffPacket = {
  sessionId: string;
  caseId: string;
  routing: {
    destination: string;
    reasons: string[];
  };
  confirmedFacts: string;
  unknowns: string[];
  attachments: PacketAttachment[];
  links: PacketLink[];
  consentScope: {
    aiAnalysis: boolean;
    producerShare: boolean;
  };
  summaryText: string;
};

function collectConfirmedFacts(draft: PacketInput['draft']): string {
  const facts: string[] = [];
  if (draft.service) facts.push(`Service: ${draft.service}`);
  if (draft.projectType) facts.push(`Project type: ${draft.projectType}`);
  if (draft.projectScope) facts.push(`Scope: ${draft.projectScope}`);
  if (draft.timelineBand) facts.push(`Timeline: ${draft.timelineBand}`);
  if (draft.budgetBand) facts.push(`Budget: ${draft.budgetBand}`);
  if (draft.contactName) facts.push(`Contact: ${draft.contactName}`);
  if (draft.contactEmail) facts.push(`Email: ${draft.contactEmail}`);
  if (draft.contactCompany) facts.push(`Company: ${draft.contactCompany}`);
  return facts.join('\n');
}

function collectUnknowns(draft: PacketInput['draft']): string[] {
  const unknowns: string[] = [];
  if (!draft.service) unknowns.push('service');
  if (!draft.projectScope?.trim()) unknowns.push('project scope');
  if (!draft.timelineBand?.trim()) unknowns.push('timeline');
  if (!draft.budgetBand?.trim()) unknowns.push('budget');
  if (!draft.contactName?.trim()) unknowns.push('contact name');
  if (!draft.contactEmail?.trim()) unknowns.push('contact email');
  return unknowns;
}

function buildSummaryText(packet: {
  caseId: string;
  routing: { destination: string; reasons: string[] };
  confirmedFacts: string;
  unknowns: string[];
  attachments: PacketAttachment[];
  links: PacketLink[];
  consentScope: { aiAnalysis: boolean; producerShare: boolean };
}): string {
  const lines: string[] = [
    `📋 Case ${packet.caseId}`,
    `Routing: ${packet.routing.destination}`,
  ];

  if (packet.routing.reasons.length > 0) {
    lines.push(`Reasons: ${packet.routing.reasons.join(', ')}`);
  }

  lines.push('', '--- Confirmed Facts ---', packet.confirmedFacts || '(none)');

  if (packet.unknowns.length > 0) {
    lines.push('', `Unknowns: ${packet.unknowns.join(', ')}`);
  }

  if (packet.attachments.length > 0) {
    const attachLines = packet.attachments.map(
      (a) => `• ${a.originalName} (${a.status})`
    );
    lines.push('', 'Attachments:', ...attachLines);
  }

  if (packet.links.length > 0) {
    const linkLines = packet.links.map((l) => `• ${l.kind ?? 'link'}: ${l.url}`);
    lines.push('', 'Links:', ...linkLines);
  }

  lines.push(
    '',
    `Consent: AI analysis=${packet.consentScope.aiAnalysis}, producer share=${packet.consentScope.producerShare}`
  );

  return lines.join('\n');
}

export function buildHandoffPacket(input: PacketInput): HandoffPacket {
  const confirmedFacts = collectConfirmedFacts(input.draft);
  const unknowns = collectUnknowns(input.draft);

  const packet = {
    sessionId: input.sessionId,
    caseId: input.caseId,
    routing: {
      destination: input.routingDestination,
      reasons: input.routingReasons,
    },
    confirmedFacts,
    unknowns,
    attachments: input.attachments,
    links: input.links,
    consentScope: input.consentScope,
    summaryText: '',
  };

  packet.summaryText = buildSummaryText(packet);
  return packet;
}
