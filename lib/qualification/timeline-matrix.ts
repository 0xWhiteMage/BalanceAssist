import type { TimelineBandId } from '@/lib/onboarding/types';

type TimelineGuidance = {
  label: string;
  guidance: string;
};

const timelineMatrix: Record<TimelineBandId, TimelineGuidance> = {
  asap: {
    label: 'ASAP',
    guidance: 'Fast-turn requests may need a narrower scope or expedited team review.'
  },
  '1-2-months': {
    label: '1-2 months',
    guidance: 'A healthy window for many campaign, production, and post-production engagements.'
  },
  '3-plus-months': {
    label: '3+ months',
    guidance: 'Longer planning windows are a good fit for larger creative development and production workflows.'
  },
  flexible: {
    label: 'Flexible',
    guidance: 'A flexible timeline gives the team room to shape scope, sequencing, and resourcing well.'
  }
};

export function getTimelineGuidance(timelineBand: string) {
  if (!timelineBand) {
    return { label: 'Unknown', guidance: 'Timeline guidance is not available until a window is provided.' };
  }
  return (
    timelineMatrix[timelineBand as TimelineBandId] ?? {
      label: timelineBand,
      guidance: 'The team can confirm feasibility for this timeline.'
    }
  );
}
