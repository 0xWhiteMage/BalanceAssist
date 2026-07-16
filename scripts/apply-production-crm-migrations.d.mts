type Migration = {
  version: string;
  filename: string;
  path: string;
};

export const crmMigrationVersions: string[];
export function selectCrmMigrations(migrations: Migration[]): Migration[];
export function applyProductionCrmMigrations(options?: {
  connectionString?: string;
  migrationsDir?: string;
  artifactPath?: string;
  dryRun?: boolean;
}): Promise<{ applied?: string[]; planned?: string[]; recordedVersions?: string[]; schemaVersion: string | undefined }>;
