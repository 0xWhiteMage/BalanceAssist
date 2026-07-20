export const productionProjectRef: string;
export const cleanupBackupProjectRef: string;
export const cleanupBackupProvider: string;
export const cleanupBackupBucket: string;

export function normalizeSessionPoolerUrl(value: string): string;
export function assertProductionDatabaseUrl(value: string): void;
export function buildBackupAuditReference(manifest: {
  createdAt: string;
  provider: string;
  backupId: string;
  releaseSha: string;
}): string;

export function createProductionCleanupBackup(): Promise<{
  version: number;
  createdAt: string;
  provider: string;
  backupId: string;
  releaseSha: string;
  sourceProjectRef: string;
  targetProjectRef: string;
  publicSchema: { tables: number; rows: number; dumpSha256: string };
  storage: { objects: number; bytes: number; aggregateSha256: string };
  sealed: boolean;
}>;
export function sealProductionCleanupBackupTarget(): Promise<void>;
