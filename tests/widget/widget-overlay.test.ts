import { describe, expect, test } from 'vitest';
import {
  formatMemoryInventory
} from '@/components/widget/widget-overlay';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

describe('temporary project memory inventory', () => {
  test('renders only canonical saved facts and private-link count', () => {
    const draft = { ...createDefaultLeadDraft(), projectScope: 'A launch film', contactEmail: 'producer@example.com' };
    expect(formatMemoryInventory(draft, 2)).toContain('Editable brief saved for this temporary session:\n- Project: A launch film\n- Contact email: producer@example.com\n- Private reference links: 2');
    expect(formatMemoryInventory(draft, 2)).toMatch(/does not inventory uploads/i);
  });

  test('states when canonical memory is empty', () => {
    expect(formatMemoryInventory(createDefaultLeadDraft(), 0)).toMatch(/editable brief is empty/i);
  });
});
