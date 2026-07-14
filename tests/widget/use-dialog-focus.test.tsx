// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useDialogFocus } from '@/components/widget/use-dialog-focus';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ active: open, dialogRef, onDismiss: () => setOpen(false) });

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <button type="button">Background</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Test dialog">
          <button type="button">First</button>
          <button type="button">Last</button>
        </div>
      )}
    </div>
  );
}

describe('useDialogFocus', () => {
  test('traps focus, dismisses on Escape, restores the opener, and inerts sibling content', () => {
    render(<DialogHarness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    const background = screen.getByRole('button', { name: 'Background' });

    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog');
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(document.activeElement).toBe(first);
    expect(background.closest('button')).toHaveAttribute('inert');

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(background).not.toHaveAttribute('inert');
  });
});
