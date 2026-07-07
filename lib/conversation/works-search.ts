import fs from 'node:fs';
import path from 'node:path';

export type WorkEntry = {
  title: string;
  slug: string;
  url: string;
  year: number | null;
  clients: string;
  service_categories: string;
  description: string;
  image_url: string;
  any_quote: string | null;
};

let CACHED: WorkEntry[] | null = null;

function loadWorks(): WorkEntry[] {
  if (CACHED) return CACHED;
  try {
    const file = path.join(process.cwd(), 'docs', 'balance-works.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { works: WorkEntry[] };
    CACHED = json.works;
  } catch {
    CACHED = [];
  }
  return CACHED;
}

export function searchWorks(query: string, limit = 8): WorkEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  const works = loadWorks();
  const scored = works.map((w) => {
    let score = 0;
    const haystack = [
      w.title,
      w.clients,
      w.service_categories,
      w.description
    ]
      .join(' ')
      .toLowerCase();
    for (const t of tokens) {
      if (haystack.includes(t)) score += 1;
      if (w.title.toLowerCase().includes(t)) score += 3;
      if (w.clients.toLowerCase().includes(t)) score += 4;
      if (w.service_categories.toLowerCase().includes(t)) score += 2;
    }
    return { w, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.w);
}

export function listAllWorks(): WorkEntry[] {
  return loadWorks();
}