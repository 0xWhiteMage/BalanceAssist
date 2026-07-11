export type TrustGateResult = { passed: boolean; reason?: string };

export function requireConsentBeforeSend(consent: boolean, action: string): TrustGateResult {
  if (!consent) {
    return { passed: false, reason: `Consent required for ${action}` };
  }
  return { passed: true };
}

export function requireCapabilityForAction(capabilityValid: boolean, action: string): TrustGateResult {
  if (!capabilityValid) {
    return { passed: false, reason: `Valid capability required for ${action}` };
  }
  return { passed: true };
}

export function validateDeliveryState(delivered: boolean, queued: boolean, retryable: boolean): TrustGateResult {
  if (delivered) return { passed: true };
  if (queued) return { passed: true };
  if (retryable) return { passed: true };
  return { passed: false, reason: 'Delivery state invalid: not delivered, queued, or retryable' };
}

export function requireAdminConfig(config: Record<string, string | undefined>): TrustGateResult {
  const missing = Object.entries(config)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    return { passed: false, reason: `Missing required admin config keys: ${missing.join(', ')}` };
  }
  return { passed: true };
}
