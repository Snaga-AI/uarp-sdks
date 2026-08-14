/**
 * Keep secrets out of the recorded run.
 *
 * The probe writes every request and response it makes so a human can audit the
 * findings afterwards. That log therefore passes through here first: the API
 * key must never reach disk, and a report meant to be forwarded to a backend
 * team should not carry the tenant's personal data with it.
 */

/** Property names whose values are replaced wholesale. */
const SECRET_KEYS = [
  'authorization',
  'api_key',
  'apikey',
  'secret',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
  'signing_key',
  'credential',
  'credentials',
  'session_key',
  'cookie',
  'set-cookie',
];

/** Property names replaced because they identify a person, not because of risk. */
const PERSONAL_KEYS = ['email', 'phone', 'phone_number', 'address', 'ip', 'ip_address', 'full_name'];

const KEY_PATTERN = /uarp_[a-z0-9]{6,}_[a-z0-9]{8,}/gi;
const BEARER_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

export interface RedactOptions {
  /** Extra literals to remove, e.g. the key actually in use. */
  literals?: string[];
  /** Mask names and e-mail addresses as well as secrets. Default true. */
  personal?: boolean;
}

/** Replace every known secret shape in a string. */
export function redactText(text: string, options: RedactOptions = {}): string {
  let out = text;
  for (const literal of options.literals ?? []) {
    if (literal.length >= 8) out = out.split(literal).join('<redacted>');
  }
  return out
    .replace(KEY_PATTERN, '<redacted-api-key>')
    .replace(BEARER_PATTERN, '$1<redacted>')
    .replace(JWT_PATTERN, '<redacted-jwt>');
}

function shouldMask(key: string, personal: boolean): 'secret' | 'personal' | undefined {
  const lower = key.toLowerCase();
  if (SECRET_KEYS.some((candidate) => lower === candidate || lower.endsWith(`_${candidate}`))) return 'secret';
  if (personal && PERSONAL_KEYS.some((candidate) => lower === candidate || lower.endsWith(`_${candidate}`))) {
    return 'personal';
  }
  return undefined;
}

/** Deep-copy a value with secret and personal fields masked. */
export function redactValue(value: unknown, options: RedactOptions = {}): unknown {
  const personal = options.personal !== false;
  const walk = (node: unknown, key: string): unknown => {
    const masked = shouldMask(key, personal);
    if (masked === 'secret') return '<redacted>';
    if (masked === 'personal') return '<masked>';
    if (Array.isArray(node)) return node.map((item) => walk(item, key));
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(node)) out[childKey] = walk(child, childKey);
      return out;
    }
    if (typeof node === 'string') return redactText(node, options);
    return node;
  };
  return walk(value, '');
}

/** Headers with the credential removed, for the audit log. */
export function redactHeaders(headers: Record<string, string>, options: RedactOptions = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = shouldMask(name, options.personal !== false) ? '<redacted>' : redactText(value, options);
  }
  return out;
}

/**
 * Last line of defence: assert nothing secret survived.
 *
 * Called on the finished report before it is written, because a report that
 * leaks the key is worse than no report.
 */
export function assertClean(text: string, literals: string[]): void {
  for (const literal of literals) {
    if (literal.length >= 8 && text.includes(literal)) {
      throw new Error('refusing to write output: it still contains the API key');
    }
  }
  const leak = KEY_PATTERN.exec(text);
  KEY_PATTERN.lastIndex = 0;
  if (leak) throw new Error(`refusing to write output: it contains something shaped like an API key (${leak[0].slice(0, 12)}...)`);
}
