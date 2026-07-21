const DEFAULT_ORIGINS = [
  'https://balancestudio.tv',
  'https://www.balancestudio.tv',
  'https://balance-assist.vercel.app'
];

function getVercelDeploymentOrigins(): string[] {
  const names = process.env.VERCEL_ENV === 'preview'
    ? ['VERCEL_URL', 'VERCEL_BRANCH_URL']
    : ['VERCEL_URL'];

  return names.flatMap((name) => {
    const hostname = process.env[name]?.trim().toLowerCase();
    if (!hostname || !/^[a-z0-9.-]+$/.test(hostname) || !hostname.endsWith('.vercel.app')) return [];
    return [`https://${hostname}`];
  });
}

export function getAllowedOrigins(): string[] {
  const custom = process.env.ALLOWED_ORIGINS;

  if (custom) {
    const parsed = custom
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    return [...new Set([...DEFAULT_ORIGINS, ...parsed, ...getVercelDeploymentOrigins()])];
  }

  return [...new Set([...DEFAULT_ORIGINS, ...getVercelDeploymentOrigins()])];
}

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;

  const allowed = getAllowedOrigins();

  if (allowed.includes(origin)) return true;

  if (
    process.env.NODE_ENV === 'development' &&
    /^https?:\/\/localhost(:\d+)?$/.test(origin)
  ) {
    return true;
  }

  return false;
}

export function requireTrustedOrigin(origin: string | null): string {
  if (!isAllowedOrigin(origin)) {
    throw new Error(`Untrusted origin: ${origin}`);
  }

  return origin!;
}
