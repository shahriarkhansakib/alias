export interface UrlValidationResult {
  isValid: boolean;
  error?: string;
  normalizedUrl?: string;
}

/**
 * Validates a destination URL:
 * - Must be a valid URL string
 * - Protocol must be http: or https: (no javascript:, data:, file:, etc.)
 * - Must not contain embedded credentials (username/password)
 * - Must not target localhost, loopback, or private RFC1918/link-local addresses
 * - Never makes an outbound HTTP request from the server (SSRF prevention)
 */
export function validateDestinationUrl(inputUrl: unknown): UrlValidationResult {
  if (typeof inputUrl !== 'string' || !inputUrl.trim()) {
    return { isValid: false, error: 'Destination URL is required.' };
  }

  const trimmed = inputUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (_e) {
    return { isValid: false, error: 'Destination URL must be a valid, well-formed URL.' };
  }

  // Protocol check: only http and https are allowed
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Invalid protocol '${parsed.protocol}'. Only http: and https: protocols are permitted.`,
    };
  }

  // Reject embedded credentials (e.g. https://user:pass@host)
  if (parsed.username || parsed.password) {
    return {
      isValid: false,
      error: 'Embedded user credentials in destination URLs are prohibited for security.',
    };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // Reject localhost and local names
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return {
      isValid: false,
      error: 'Localhost and internal local network destinations are not permitted.',
    };
  }

  // Check IPv4 private and link-local ranges
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipMatch = hostname.match(ipv4Regex);
  if (ipMatch) {
    const octet1 = parseInt(ipMatch[1], 10);
    const octet2 = parseInt(ipMatch[2], 10);

    // 127.0.0.0/8 (Loopback)
    if (octet1 === 127) {
      return { isValid: false, error: 'Loopback IP addresses are not permitted.' };
    }
    // 10.0.0.0/8 (Private)
    if (octet1 === 10) {
      return { isValid: false, error: 'Private network addresses (RFC 1918) are not permitted.' };
    }
    // 172.16.0.0/12 (Private)
    if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) {
      return { isValid: false, error: 'Private network addresses (RFC 1918) are not permitted.' };
    }
    // 192.168.0.0/16 (Private)
    if (octet1 === 192 && octet2 === 168) {
      return { isValid: false, error: 'Private network addresses (RFC 1918) are not permitted.' };
    }
    // 169.254.0.0/16 (Link-local)
    if (octet1 === 169 && octet2 === 254) {
      return { isValid: false, error: 'Link-local addresses are not permitted.' };
    }
    // 0.0.0.0/8
    if (octet1 === 0) {
      return { isValid: false, error: 'Invalid destination IP address.' };
    }
  }

  // Check IPv6 private/link-local formats
  if (
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80') ||
    hostname === '[::1]'
  ) {
    return {
      isValid: false,
      error: 'Private or local IPv6 addresses are not permitted.',
    };
  }

  return {
    isValid: true,
    normalizedUrl: parsed.toString(),
  };
}
