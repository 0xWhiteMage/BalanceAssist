const BALANCE_CAREERS_URL = 'https://balancestudio.tv/careers';

const CAREERS_INTENT_PATTERNS = [
  /\b(careers?|jobs?|hiring|apply|recruit|employment|vacancy|vacancies|openings?|positions?|roles?|join\s+(the\s+)?team)\b/i,
  /\b(work\s+(for|at|with)\s+(balance|the\s+studio))\b/i,
  /\b(looking\s+for\s+(a\s+)?(job|position|role|career|opening))\b/i,
  /\b(get\s+hired|send\s+(my\s+)?cv|submit\s+(my\s+)?(cv|resume|application))\b/i,
  /\b(are\s+you\s+hiring|do\s+you\s+(have|need)\s+(any\s+)?(jobs?|openings?|positions?))\b/i,
  /\b(intern(?:ship|ships)?)\b/i,
];

export function isCareersIntent(text: string): boolean {
  return CAREERS_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function getCareersRedirect(): string {
  return BALANCE_CAREERS_URL;
}
