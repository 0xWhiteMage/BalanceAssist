type Migration = {
  version: string;
  filename: string;
  path: string;
};

export const trustControlsMigrationVersion: string;
export function selectTrustControlsMigration(migrations: Migration[]): Migration;
export function applyProductionTrustControlsMigrations(options?: {
  connectionString?: string;
  migrationsDir?: string;
  artifactPath?: string;
  dryRun?: boolean;
}): Promise<{ applied?: string[]; planned?: string[]; recordedVersions?: string[]; schemaVersion: string }>;
