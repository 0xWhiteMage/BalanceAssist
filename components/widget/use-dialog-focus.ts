'use client';

import { useEffect, useRef, type RefObject } from 'react';

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

const dialogStack: HTMLElement[] = [];

function isTopDialog(dialog: HTMLElement): boolean {
  return dialogStack[dialogStack.length - 1] === dialog;
}

export function useDialogFocus({
  active,
  dialogRef,
  onDismiss
}: {
  active: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = Array.from(dialog.parentElement?.children ?? []).filter((element) => !element.contains(dialog));
    dialogStack.push(dialog);
    siblings.forEach((element) => element.setAttribute('inert', ''));

    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    (focusables()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(dialog)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const elements = focusables();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = dialogStack.lastIndexOf(dialog);
      if (index >= 0) dialogStack.splice(index, 1);
      siblings.forEach((element) => element.removeAttribute('inert'));
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, dialogRef]);
}
