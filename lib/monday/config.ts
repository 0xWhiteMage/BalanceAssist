import schema from '../../config/monday-crm-schema.json';

export type MondayConfig = {
  token: string | null;
  boardId: string | null;
  apiVersion: '2026-07' | null;
  upsertEnabled: boolean;
  cleanupEnabled: boolean;
};

// The Task 1 runbook deliberately has no approval identifier while the exception is pending.
export const RUNBOOK_AUTH_APPROVAL_REF: string | null = null;

function parseFlag(value: string | undefined, name: string) {
  if (value === undefined) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be exactly true or false`);
}

export function getMondayConfig(
  environment: Record<string, string | undefined> = process.env,
  runbookAuthApprovalRef = RUNBOOK_AUTH_APPROVAL_REF,
): MondayConfig {
  const upsertEnabled = parseFlag(environment.MONDAY_UPSERT_ENABLED, 'MONDAY_UPSERT_ENABLED');
  const cleanupEnabled = parseFlag(environment.MONDAY_CLEANUP_ENABLED, 'MONDAY_CLEANUP_ENABLED');
  const token = environment.MONDAY_API_TOKEN?.trim() || null;
  const boardId = environment.MONDAY_BOARD_ID?.trim() || null;
  const apiVersion = environment.MONDAY_API_VERSION?.trim() || null;

  if (upsertEnabled || cleanupEnabled) {
    if (!token || boardId !== schema.boardId || apiVersion !== '2026-07' || environment.MONDAY_AUTH_MODE !== 'service_token') {
      throw new Error('Monday enabled lanes require a supported token, board ID, API version, and service-token mode');
    }
    if (!runbookAuthApprovalRef || environment.MONDAY_AUTH_APPROVAL_REF !== runbookAuthApprovalRef) {
      throw new Error('Monday enabled lanes require the runbook authentication approval reference');
    }
  }

  return {
    token,
    boardId,
    apiVersion: apiVersion === '2026-07' ? apiVersion : null,
    upsertEnabled,
    cleanupEnabled,
  };
}
