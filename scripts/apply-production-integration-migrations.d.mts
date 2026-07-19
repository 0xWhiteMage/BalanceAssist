export const integrationMigrationVersions: string[];
export function selectIntegrationMigrations(migrations: Array<{ version: string; filename: string; path: string }>): Array<{ version: string; filename: string; path: string }>;
export function applyProductionIntegrationMigrations(options?: {
  connectionString?: string;
  migrationsDir?: string;
  artifactPath?: string;
  dryRun?: boolean;
}): Promise<{ planned?: string[]; applied?: string[]; schemaVersion?: string }>;
