export const orphanedPrivateAttachmentCleanup045MigrationVersion: string;
export function selectOrphanedPrivateAttachmentCleanup045Migration(
  migrations: Array<{ version: string; filename: string; path: string }>
): { version: string; filename: string; path: string };
export function applyProductionOrphanedPrivateAttachmentCleanup045(options?: {
  migrationsDir?: string;
  artifactPath?: string;
  dryRun?: boolean;
}): Promise<{ planned: string[]; schemaVersion: string }>;
