'use client';

import { EssentialsStep } from '@/components/onboarding/essentials-step';
import { SummaryPanel } from '@/components/onboarding/summary-panel';
import { WelcomeActions } from '@/components/onboarding/welcome-actions';
import { FileReviewCards } from '@/components/uploads/file-review-cards';
import { UploadDropzone } from '@/components/uploads/upload-dropzone';
import { UploadList } from '@/components/uploads/upload-list';
import { WidgetShell } from '@/components/widget/widget-shell';
import { createDemoLeadDraft } from '@/lib/onboarding/default-state';

const onboardingDraft = createDemoLeadDraft();

const summaryDraft = {
  ...createDemoLeadDraft(),
  projectScope: 'Brand launch campaign with hero film, cutdowns, and social assets.',
  contactName: 'Jane Lee',
  contactEmail: 'jane@example.com'
};

const demoUploads = [
  { id: '1', name: 'Brand_Deck_2026.pdf', status: 'uploaded' as const, meta: '6.4 MB, PDF' },
  { id: '2', name: 'Campaign_brief.pdf', status: 'reading' as const, meta: '2.1 MB, PDF' },
  { id: '3', name: 'Budget_notes.xlsx', status: 'needs_human_review' as const, meta: '42 KB, XLSX' }
];

export function ReferenceBoard() {
  return (
    <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <WidgetShell>
        <WelcomeActions
          actions={[
            {
              id: 'project-brief',
              title: 'Start your project brief',
              description: 'Answer a few guided questions.',
              onSelect: () => undefined
            },
            {
              id: 'services',
              title: 'Ask about services',
              description: 'Learn how we can help.',
              onSelect: () => undefined
            },
            {
              id: 'share-brief',
              title: 'Share a deck or brief',
              description: 'Upload files or share a link.',
              onSelect: () => undefined
            },
            {
              id: 'human-handoff',
              title: 'Talk to a human',
              description: 'Connect with our team.',
              onSelect: () => undefined
            }
          ]}
        />
      </WidgetShell>
      <div className="grid gap-6">
        <EssentialsStep draft={onboardingDraft} />
        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="grid gap-6">
            <UploadDropzone />
            <UploadList uploads={demoUploads} />
          </div>
          <div className="grid gap-6">
            <FileReviewCards
              inferredSummary="You appear to be planning a premium product launch campaign with multiple deliverables and a need for human review on the budget sheet."
              sourceSummary="The uploaded deck references a regional launch, key campaign milestones, and required cutdowns for multiple channels."
            />
            <SummaryPanel draft={summaryDraft} />
          </div>
        </div>
      </div>
    </section>
  );
}
