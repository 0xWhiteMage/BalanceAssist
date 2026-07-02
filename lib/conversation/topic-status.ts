import type { QualificationStatus } from '@/lib/qualification/next-step';

export type TopicStatus = 'new' | 'waiting' | 'qualified' | 'needs_review' | 'misfit' | 'unqualified';

export const TOPIC_STATUS_EMOJI: Record<TopicStatus, string> = {
  new: '🆕',
  waiting: '⏳',
  qualified: '✅',
  needs_review: '⏳',
  misfit: '🚫',
  unqualified: '❌'
};

export const TOPIC_STATUS_COLOR: Record<TopicStatus, number> = {
  new: 7322096,
  waiting: 16766590,
  qualified: 9367192,
  needs_review: 16766590,
  misfit: 16478047,
  unqualified: 16478047
};

export function topicStatusFromQualification(
  status: QualificationStatus
): TopicStatus {
  switch (status) {
    case 'qualified':
      return 'qualified';
    case 'needs_review':
      return 'needs_review';
    case 'misfit':
      return 'misfit';
    case 'unqualified':
      return 'unqualified';
  }
}

export function buildTopicName(
  name: string | null | undefined,
  company: string | null | undefined,
  shortId: string,
  status: TopicStatus = 'new'
): string {
  const parts: string[] = [TOPIC_STATUS_EMOJI[status]];
  if (name?.trim() && company?.trim()) {
    parts.push(`${name.trim()} / ${company.trim()}`);
  } else if (name?.trim()) {
    parts.push(name.trim());
  } else if (company?.trim()) {
    parts.push(company.trim());
  } else {
    parts.push('New inquiry');
  }
  parts.push(`(${shortId})`);
  return parts.join(' ').slice(0, 128);
}