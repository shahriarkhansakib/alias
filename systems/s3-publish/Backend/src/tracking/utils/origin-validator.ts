export interface OriginValidationResult {
  isValid: boolean;
  origin?: string;
  error?: string;
}

/**
 * Validates and normalizes a website origin.
 * Origin format must be: protocol + hostname (+ optional non-standard port).
 * Protocol must be http: or https:.
 * Paths, query parameters, hashes, and embedded credentials are strictly rejected/stripped.
 *
 * NOTE: Origin validation acts as an allowlist, not cryptographic proof of website ownership.
 */
export function validateAndNormalizeOrigin(input: unknown): OriginValidationResult {
  if (typeof input !== 'string' || !input.trim()) {
    return { isValid: false, error: 'Website origin is required (e.g. https://techghorbd.vercel.app).' };
  }

  const trimmed = input.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (_e) {
    return {
      isValid: false,
      error: 'Invalid website origin format. Must be a valid URL with protocol (e.g. https://yourdomain.com).',
    };
  }

  // Protocol must be http or https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Invalid protocol '${parsed.protocol}'. Only http: and https: origins are allowed.`,
    };
  }

  // Disallow embedded user credentials
  if (parsed.username || parsed.password) {
    return {
      isValid: false,
      error: 'Website origin must not contain embedded user credentials.',
    };
  }

  // Disallow paths beyond '/'
  if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') {
    return {
      isValid: false,
      error: 'Website origin must be the root domain (no path, file, or subdirectory). Enter origin like https://example.com.',
    };
  }

  // Disallow search query parameters or hashes
  if (parsed.search || parsed.hash) {
    return {
      isValid: false,
      error: 'Website origin must not include query parameters or URL hashes.',
    };
  }

  // Exact normalized origin
  const normalizedOrigin = parsed.origin.toLowerCase();

  return {
    isValid: true,
    origin: normalizedOrigin,
  };
}
