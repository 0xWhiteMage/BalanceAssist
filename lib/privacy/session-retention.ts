export const TEMPORARY_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

export function temporaryDraftExpiry(activityAt = new Date()): Date {
  return new Date(activityAt.getTime() + TEMPORARY_DRAFT_RETENTION_MS);
}
