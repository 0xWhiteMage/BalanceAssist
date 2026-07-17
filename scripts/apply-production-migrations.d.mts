export function assertExpandOnlyMigration(source: string, filename: string): void;
export function assertReviewedCleanupMigrationsRecorded(recordedVersions: string[]): void;
export function assertReviewedCrmMigrationsRecorded(recordedVersions: string[]): void;
export function assertReviewedTrustControlsMigrationRecorded(recordedVersions: string[]): void;
export function assertReviewedFinalReviewMigrationRecorded(recordedVersions: string[]): void;
export function assertReviewedSessionControlsMigrationRecorded(recordedVersions: string[]): void;
export function assertReviewedTrustFeedbackMigrationRecorded(recordedVersions: string[]): void;
export function selectOrdinaryProductionMigrations(migrations: Array<{ version: string; filename: string; path: string }>): Array<{ version: string; filename: string; path: string }>;
export function applyProductionMigrations(connectionString?: string): Promise<{ applied: string[]; schemaVersion: string | undefined }>;
