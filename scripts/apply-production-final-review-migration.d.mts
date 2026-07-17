type Migration = {
  version: string;
  filename: string;
  path: string;
};

export const finalReviewMigrationVersion: string;
export function selectFinalReviewMigration(migrations: Migration[]): Migration;
export function applyProductionFinalReviewMigration(options?: {
  connectionString?: string;
  migrationsDir?: string;
  artifactPath?: string;
  dryRun?: boolean;
}): Promise<{ applied?: string[]; planned?: string[]; recordedVersions?: string[]; schemaVersion: string }>;
