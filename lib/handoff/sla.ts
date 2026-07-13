export type HandoffSLA = {
  maxRetryAttempts: number;
  retryBackoffMs: number[];
  escalationThresholdMs: number;
};

const DEFAULT_SLA: HandoffSLA = {
  maxRetryAttempts: 4,
  retryBackoffMs: [300_000, 300_000, 300_000], // GitHub Actions schedules every five minutes.
  escalationThresholdMs: 900_000, // Three five-minute scheduler windows.
};

export function getRetryDelay(attempt: number, sla?: HandoffSLA): number {
  const config = sla ?? DEFAULT_SLA;
  const index = Math.min(attempt, config.retryBackoffMs.length - 1);
  return config.retryBackoffMs[index];
}

export function shouldEscalate(createdAt: string, sla?: HandoffSLA): boolean {
  const config = sla ?? DEFAULT_SLA;
  const elapsed = Date.now() - new Date(createdAt).getTime();
  return elapsed >= config.escalationThresholdMs;
}

export function getMaxRetries(sla?: HandoffSLA): number {
  return (sla ?? DEFAULT_SLA).maxRetryAttempts;
}
