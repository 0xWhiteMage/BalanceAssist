type Migration = {
  version: string;
  filename: string;
  path: string;
};

export const cleanupMigrationVersions: string[];
export function selectCleanupMigrations(migrations: Migration[]): Migration[];
export function applyProductionCleanupMigrations(options?: {
  connectionString?: string;
  migrationsDir?: string;
  artifactPath?: string;
  dryRun?: boolean;
}): Promise<{ applied?: string[]; planned?: string[]; recordedVersions?: string[]; schemaVersion: string | undefined }>;
