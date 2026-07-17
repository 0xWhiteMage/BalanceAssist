type MigrationLookupClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: { filename?: string } | null; error: unknown }>;
      };
    };
  };
};

export async function isConsent12CutoverActive(client: unknown): Promise<boolean> {
  const { data, error } = await (client as MigrationLookupClient)
    .from('schema_migrations')
    .select('filename')
    .eq('version', '060')
    .maybeSingle();
  return !error && data?.filename === '060_consent_1_2_cutover.sql';
}
