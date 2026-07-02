'use client';

import { Card } from '@/components/ui/card';
import { brandTokens } from '@/lib/brand-tokens';
import { essentialFields, type EssentialFieldKey } from '@/lib/onboarding/flow-config';
import { getEssentialsProgress, isEssentialFieldComplete } from '@/lib/onboarding/progress';
import type { LeadDraft } from '@/lib/onboarding/types';

type EssentialsStepProps = {
  draft: LeadDraft;
  onChange?: (field: EssentialFieldKey, value: string) => void;
};

const inputBaseStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: `1px solid ${brandTokens.colors.subtleBorder}`,
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  color: brandTokens.colors.lightText,
  fontFamily: brandTokens.typography.ui,
  fontSize: '13px',
  lineHeight: '1.5',
  outline: 'none',
  transition: 'border-color 0.15s ease'
} as const;

export function EssentialsStep({ draft, onChange }: EssentialsStepProps) {
  const progress = getEssentialsProgress(draft);
  const isInteractive = Boolean(onChange);

  return (
    <Card className="p-5">
      <p
        className="text-xs font-medium uppercase tracking-[0.28em]"
        style={{ color: brandTokens.colors.warmGold }}
      >
        {progress.completed} of {progress.total} essentials captured
      </p>
      <div
        className="mt-5 space-y-5 border-t pt-5"
        style={{ borderColor: brandTokens.colors.subtleBorder }}
      >
        {essentialFields.map((field) => {
          const isComplete = isEssentialFieldComplete(field, draft);

          if (field.options) {
            const currentValue = draft[field.fields[0]];

            return (
              <div key={field.key}>
                <div className="flex items-center justify-between">
                  <label
                    className="text-sm font-semibold uppercase tracking-[0.12em] text-white"
                    htmlFor={`field-${field.key}`}
                  >
                    {field.label}
                  </label>
                  <span
                    className="text-base"
                    style={{ color: isComplete ? brandTokens.colors.warmGold : 'transparent' }}
                  >
                    &#10003;
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/60">{field.helper}</p>
                <div className="relative mt-3">
                  <select
                    id={`field-${field.key}`}
                    value={currentValue}
                    disabled={!isInteractive}
                    onChange={(e) => onChange?.(field.fields[0], e.target.value)}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = brandTokens.colors.warmGold;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = brandTokens.colors.subtleBorder;
                    }}
                    style={{
                      ...inputBaseStyle,
                      appearance: 'none',
                      cursor: isInteractive ? 'pointer' : 'default',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='${encodeURIComponent(brandTokens.colors.warmGold)}' d='M6 8L0 0h12z'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 14px center',
                      paddingRight: '36px'
                    }}
                  >
                    <option value="">Select an option...</option>
                    {field.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          }

          if (field.subfields) {
            return (
              <div key={field.key}>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold uppercase tracking-[0.12em] text-white">
                    {field.label}
                  </label>
                  <span
                    className="text-base"
                    style={{ color: isComplete ? brandTokens.colors.warmGold : 'transparent' }}
                  >
                    &#10003;
                  </span>
                </div>
                <p className="mt-1 text-xs text-white/60">{field.helper}</p>
                <div className="mt-3 space-y-2">
                  {field.subfields.map((subfield) => {
                    const currentValue = draft[subfield.key];

                    if (subfield.input === 'textarea') {
                      return (
                        <textarea
                          key={subfield.key}
                          value={currentValue}
                          placeholder={subfield.placeholder}
                          disabled={!isInteractive}
                          rows={3}
                          onChange={(e) => onChange?.(subfield.key, e.target.value)}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = brandTokens.colors.warmGold;
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = brandTokens.colors.subtleBorder;
                          }}
                          style={{
                            ...inputBaseStyle,
                            resize: 'vertical',
                            minHeight: '72px'
                          }}
                        />
                      );
                    }

                    return (
                      <input
                        key={subfield.key}
                        type={subfield.input === 'email' ? 'email' : 'text'}
                        value={currentValue}
                        placeholder={subfield.placeholder}
                        disabled={!isInteractive}
                        onChange={(e) => onChange?.(subfield.key, e.target.value)}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = brandTokens.colors.warmGold;
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = brandTokens.colors.subtleBorder;
                        }}
                        style={inputBaseStyle}
                      />
                    );
                  })}
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>
    </Card>
  );
}
