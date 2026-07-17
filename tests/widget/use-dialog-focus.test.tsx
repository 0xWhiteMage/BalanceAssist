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

function FilteredDialogHarness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ active: open, dialogRef, onDismiss: () => setOpen(false) });

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Filtered dialog">
          <button type="button" hidden>Hidden</button>
          <button type="button" inert={true}>Inert</button>
          <button type="button" tabIndex={-1}>Programmatic only</button>
          <button type="button">First visible</button>
          <button type="button">Last visible</button>
        </div>
      )}
    </div>
  );
}

function NestedDialogHarness() {
  const [outerOpen, setOuterOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ active: outerOpen, dialogRef: outerRef, onDismiss: () => setOuterOpen(false) });
  useDialogFocus({ active: innerOpen, dialogRef: innerRef, onDismiss: () => setInnerOpen(false) });

  return (
    <main>
      <button type="button">Page background</button>
      <section>
        <button type="button" onClick={() => setOuterOpen(true)}>Open outer</button>
        {outerOpen && (
          <div ref={outerRef} role="dialog" aria-modal="true" aria-label="Outer dialog">
            <button type="button" onClick={() => setInnerOpen(true)}>Open inner</button>
            <button type="button">Outer action</button>
            {innerOpen && (
              <div ref={innerRef} role="dialog" aria-modal="true" aria-label="Inner dialog">
                <button type="button">Inner action</button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function IframeDialogHarness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ active: open, dialogRef, onDismiss: () => setOpen(false) });

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open calendar</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Calendar dialog">
          <button type="button">Back</button>
          <div style={{ display: 'none' }}><button type="button">Hidden by ancestor</button></div>
          <iframe title="Schedule a call" src="about:blank" />
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

  test('wraps only visible, enabled tab stops', () => {
    render(<FilteredDialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    const first = screen.getByRole('button', { name: 'First visible' });
    const last = screen.getByRole('button', { name: 'Last visible' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test('inerts page and outer dialog controls while a nested dialog is open, then restores them', () => {
    render(<NestedDialogHarness />);
    const pageBackground = screen.getByRole('button', { name: 'Page background' });
    const outerOpener = screen.getByRole('button', { name: 'Open outer' });

    fireEvent.click(outerOpener);
    expect(pageBackground.closest('[inert]')).not.toBeNull();
    expect(outerOpener.closest('[inert]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open inner' }));
    const outerAction = screen.getByRole('button', { name: 'Outer action' });
    expect(outerAction.closest('[inert]')).not.toBeNull();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Inner dialog' }), { key: 'Escape' });
    expect(outerAction.closest('[inert]')).toBeNull();
    expect(pageBackground.closest('[inert]')).not.toBeNull();

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Outer dialog' }), { key: 'Escape' });
    expect(pageBackground.closest('[inert]')).toBeNull();
    expect(outerOpener.closest('[inert]')).toBeNull();
  });

  test('includes an iframe in the focus loop and ignores controls hidden by an ancestor', () => {
    render(<IframeDialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));

    const back = screen.getByRole('button', { name: 'Back' });
    const frame = screen.getByTitle('Schedule a call');
    expect(document.activeElement).toBe(back);

    frame.focus();
    fireEvent.keyDown(frame, { key: 'Tab' });
    expect(document.activeElement).toBe(back);

    back.focus();
    fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(frame);
    expect(screen.getByText('Hidden by ancestor')).not.toHaveFocus();
  });
});
