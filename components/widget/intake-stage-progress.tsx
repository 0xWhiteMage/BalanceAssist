'use client';

import { brandTokens } from '@/lib/brand-tokens';
import { INTAKE_STAGES, type IntakeStageId } from '@/lib/conversation/intake-stage';

export function IntakeStageProgress({ currentStageId }: { currentStageId: IntakeStageId }) {
  const currentIndex = INTAKE_STAGES.findIndex((stage) => stage.id === currentStageId);
  const currentStage = INTAKE_STAGES[currentIndex] ?? INTAKE_STAGES[0];
  const stageNumber = currentIndex >= 0 ? currentIndex + 1 : 1;

  return (
    <section
      data-testid="intake-stage-progress"
      className="balance-widget-wrap balance-widget-motion"
      style={{ padding: '10px 14px', borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`, flexShrink: 0 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, fontSize: 11 }}>
        <strong style={{ color: brandTokens.colors.lightText }}>{currentStage.label}</strong>
        <span style={{ color: brandTokens.colors.warmGold, flexShrink: 0 }}>Stage {stageNumber} of {INTAKE_STAGES.length}</span>
      </div>
      <ol
        aria-label="Intake stages"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', margin: 0, paddingLeft: 18, color: brandTokens.colors.mutedText, fontSize: 10, lineHeight: 1.4 }}
      >
        {INTAKE_STAGES.map((stage) => {
          const current = stage.id === currentStage.id;
          return (
            <li key={stage.id} aria-current={current ? 'step' : undefined}>
              <span style={{ color: current ? brandTokens.colors.warmGold : undefined }}>{stage.label}</span>
              {current && <span> (Current)</span>}
            </li>
          );
        })}
      </ol>
      <span
        role="status"
        aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
      >
        Stage {stageNumber} of {INTAKE_STAGES.length}: {currentStage.label}
      </span>
    </section>
  );
}
