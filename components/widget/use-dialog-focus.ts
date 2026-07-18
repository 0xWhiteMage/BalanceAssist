'use client';

import { useEffect, useRef, type RefObject } from 'react';

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

const dialogStack: HTMLElement[] = [];
const inertClaims = new Map<HTMLElement, { count: number; alreadyInert: boolean }>();

function isTopDialog(dialog: HTMLElement): boolean {
  return dialogStack[dialogStack.length - 1] === dialog;
}

function isFocusable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(':disabled')) return false;
  if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return false;

  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function claimInert(element: HTMLElement) {
  const claim = inertClaims.get(element);
  if (claim) {
    claim.count += 1;
    return;
  }

  inertClaims.set(element, { count: 1, alreadyInert: element.hasAttribute('inert') });
  element.setAttribute('inert', '');
}

function releaseInert(element: HTMLElement) {
  const claim = inertClaims.get(element);
  if (!claim) return;
  if (claim.count > 1) {
    claim.count -= 1;
    return;
  }

  inertClaims.delete(element);
  if (!claim.alreadyInert) element.removeAttribute('inert');
}

function getBackgroundElements(dialog: HTMLElement): HTMLElement[] {
  const background = new Set<HTMLElement>();
  let current: HTMLElement | null = dialog;

  while (current?.parentElement) {
    const container: HTMLElement = current.parentElement;
    for (const sibling of container.children) {
      if (sibling !== current) background.add(sibling as HTMLElement);
    }
    current = container;
  }

  return [...background];
}

export function useDialogFocus({
  active,
  dialogRef,
  onDismiss,
  modal = true
}: {
  active: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  modal?: boolean;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backgroundElements = modal ? getBackgroundElements(dialog) : [];
    dialogStack.push(dialog);
    backgroundElements.forEach(claimInert);

    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(isFocusable);
    (focusables()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(dialog)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab' || !modal) return;

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
      backgroundElements.forEach(releaseInert);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, dialogRef, modal]);
}
