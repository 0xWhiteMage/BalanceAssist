import { readFileSync } from 'node:fs';

function rowsFromDocument(document) {
  if (Array.isArray(document)) return document;
  if (!document || typeof document !== 'object') return null;
  for (const key of ['rows', 'result', 'data']) {
    if (Array.isArray(document[key])) return document[key];
  }
  if (document.type === 'row') {
    const row = document.row ?? document.record ?? document.data;
    return row && typeof row === 'object' && !Array.isArray(row) ? [row] : null;
  }
  if (!('level' in document) && !('message' in document) && !('msg' in document)) return [document];
  return null;
}

export function parseSupabaseQueryRows(source) {
  const input = source.trim();
  if (!input) throw new Error('Supabase query returned no JSON.');
  try {
    const rows = rowsFromDocument(JSON.parse(input));
    if (!rows) throw new Error('Supabase query JSON did not contain rows.');
    return rows;
  } catch {
    const rows = [];
    let foundResult = false;
    for (const line of input.split(/\r?\n/).filter(Boolean)) {
      const documentRows = rowsFromDocument(JSON.parse(line));
      if (!documentRows) continue;
      foundResult = true;
      rows.push(...documentRows);
    }
    if (!foundResult) throw new Error('Supabase query JSON did not contain rows.');
    return rows;
  }
}

export function readSupabaseQueryRows(path) {
  return parseSupabaseQueryRows(readFileSync(path, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const path = process.argv[2];
  if (!path) process.exit(1);
  process.stdout.write(JSON.stringify(readSupabaseQueryRows(path)));
}
