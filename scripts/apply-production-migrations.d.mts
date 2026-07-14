export function assertExpandOnlyMigration(source: string, filename: string): void;
export function applyProductionMigrations(connectionString?: string): Promise<{ applied: string[]; schemaVersion: string | undefined }>;
