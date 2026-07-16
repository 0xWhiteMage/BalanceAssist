'use client';

import { Card } from '@/components/ui/card';
import { brandTokens } from '@/lib/brand-tokens';

export type WelcomeAction = {
  id: string;
  title: string;
  description: string;
  onSelect?: () => void;
};

export const defaultWelcomeActions: WelcomeAction[] = [
  {
    id: 'project-brief',
    title: 'Build a brief with AI',
    description: 'Create a non-confidential, high-level project brief.'
  },
  {
    id: 'services',
    title: 'Ask about services',
    description: 'Learn how we can help.'
  },
  {
    id: 'share-brief',
    title: 'Share a deck or brief',
    description: 'Upload files or share a link.'
  },
  {
    id: 'human-handoff',
    title: 'Talk to the team without AI',
    description: 'Send a message directly to the Balance team.'
  }
];

type WelcomeActionsProps = {
  actions?: WelcomeAction[];
};

export function WelcomeActions({ actions = defaultWelcomeActions }: WelcomeActionsProps) {
  return (
    <div className="space-y-3">
      {actions.map((action) => {
        const isInteractive = Boolean(action.onSelect);

        return (
          <Card
            className={`${isInteractive ? 'cursor-pointer hover:border-white/30' : ''} p-4 transition-colors`.trim()}
            key={action.id}
            onClick={action.onSelect}
            onKeyDown={(event) => {
              if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                action.onSelect?.();
              }
            }}
            role={isInteractive ? 'button' : undefined}
            tabIndex={isInteractive ? 0 : undefined}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white">{action.title}</p>
            <p className="mt-2 text-sm leading-6 text-white/70">{action.description}</p>
          </Card>
        );
      })}
    </div>
  );
}
