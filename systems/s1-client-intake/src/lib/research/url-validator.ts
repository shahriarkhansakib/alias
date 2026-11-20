import dns from "dns/promises";
import net from "net";
import { SourceValidationStatus } from "./types";

export interface UrlValidationResult {
  original_url: string;
  final_url: string;
  http_status: number | null;
  validation_status: SourceValidationStatus;
  title: string;
  publisher: string;
  domain: string;
  published_date: string | null;
  accessed_date: string;
  content_excerpt: string;
  redirect_chain: string[];
  error_message?: string;
}

/**
 * Checks if an IP address belongs to private, loopback, link-local, multicast, or cloud metadata ranges.
 */
export function isPrivateOrRestrictedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private)
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata e.g. 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private 172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 100.64.0.0/10 (Shared address space / Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    // 198.18.0.0/15 (Network benchmark tests)
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (Reserved / Future use)
    if (parts[0] >= 240) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Loopback ::1 or unspecified ::
    if (lower === "::1" || lower === "::") return true;
    // Unique local address fc00::/7 (fc00:: to fdff::)
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    // Link-local unicast fe80::/10 (fe80:: to febf::)
    if (
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb")
    )
      return true;
    // Multicast ff00::/8
    if (lower.startsWith("ff")) return true;
    // IPv4-mapped IPv6 address (e.g. ::ffff:192.168.1.1 or ::ffff:127.0.0.1)
    if (lower.includes("::ffff:")) {
      const v4 = lower.split("::ffff:")[1];
      if (net.isIP(v4)) return isPrivateOrRestrictedIp(v4);
    }
    return false;
  }

  return true;
}

/**
 * Validates a URL against SSRF attacks (blocks private IP ranges, cloud metadata, local hosts, and unsupported protocols).
 */
export async function isSafeUrl(
  rawUrl: string,
  options?: { skipDnsLookup?: boolean }
): Promise<{ safe: boolean; reason?: string }> {
  try {
    const parsed = new URL(rawUrl);

    // Only HTTP and HTTPS
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and cloud metadata domain names explicitly
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname === "metadata.google.internal" ||
      hostname === "instance-data"
    ) {
      return { safe: false, reason: `Forbidden hostname: ${hostname}` };
    }

    // Direct IP check
    if (net.isIP(hostname)) {
      if (isPrivateOrRestrictedIp(hostname)) {
        return { safe: false, reason: `Restricted IP address: ${hostname}` };
      }
      return { safe: true };
    }

    if (options?.skipDnsLookup) {
      return { safe: true };
    }

    // Resolve DNS and check all resolved IPs - Fail closed on resolution failure
    try {
      const lookupResults = await dns.lookup(hostname, { all: true });
      if (!lookupResults || lookupResults.length === 0) {
        return { safe: false, reason: `Could not resolve hostname: ${hostname}` };
      }

      for (const entry of lookupResults) {
        if (isPrivateOrRestrictedIp(entry.address)) {
          return { safe: false, reason: `Hostname resolves to restricted IP: ${entry.address}` };
        }
      }
    } catch (dnsErr: any) {
      // DNS resolution failure fails closed
      return { safe: false, reason: `DNS resolution failed: ${dnsErr.message}` };
    }

    return { safe: true };
  } catch (err: any) {
    return { safe: false, reason: `Malformed URL: ${err.message}` };
  }
}

/**
 * Normalizes a URL cleanly without changing its destination.
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    let trimmed = rawUrl.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      trimmed = "https://" + trimmed;
    }

    const parsed = new URL(trimmed);
    parsed.hostname = parsed.hostname.toLowerCase();

    // Remove default ports
    if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }

    // Normalize pathname (remove trailing slash except for root "/")
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // Strip tracking parameters (utm_*, fbclid, gclid, ref) but keep functional search params
    const cleanParams = new URLSearchParams();
    parsed.searchParams.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (!lower.startsWith("utm_") && lower !== "fbclid" && lower !== "gclid" && lower !== "ref_src") {
        cleanParams.append(key, val);
      }
    });

    const searchString = cleanParams.toString();
    parsed.search = searchString ? `?${searchString}` : "";
    parsed.hash = ""; // strip fragments

    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Extracts page title, domain, publication date, and clean text excerpt from HTML.
 */
export function extractPageMetadata(html: string, url: string): {
  title: string;
  domain: string;
  publisher: string;
  published_date: string | null;
  excerpt: string;
} {
  let domain = "";
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    domain = "unknown";
  }

  // Extract Title
  let title = "";
  const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (ogTitleMatch && ogTitleMatch[1]?.trim()) {
    title = ogTitleMatch[1].trim();
  } else if (titleTagMatch && titleTagMatch[1]?.trim()) {
    title = titleTagMatch[1].replace(/\s+/g, " ").trim();
  } else {
    title = `${domain.toUpperCase()} Content Page`;
  }

  // Clean HTML entities from title
  title = title
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Extract Publisher / Site Name
  let publisher = "";
  const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogSiteName && ogSiteName[1]?.trim()) {
    publisher = ogSiteName[1].trim();
  } else {
    // Derive pretty name from domain
    publisher = domain.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Extract Publication Date
  let published_date: string | null = null;
  const datePatterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];

  for (const pat of datePatterns) {
    const match = html.match(pat);
    if (match && match[1]?.trim()) {
      const rawDate = match[1].trim();
      try {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          published_date = d.toISOString().split("T")[0];
          break;
        }
      } catch {
        // continue
      }
    }
  }

  // Extract Clean Text Excerpt
  const cleanText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Try finding og:description or meta description if body is dense, filtering out disclaimers
  const metaDescMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const isDisclaimer = (t: string) => {
    const l = t.toLowerCase();
    return (
      l.includes("fair use disclaimer") ||
      l.includes("copyrighted materials without specific authorization") ||
      l.includes("please enable cookies") ||
      l.includes("attention required") ||
      l.includes("just a moment")
    );
  };

  let excerpt = "";
  if (metaDescMatch && metaDescMatch[1]?.trim().length > 30 && !isDisclaimer(metaDescMatch[1])) {
    excerpt = metaDescMatch[1].trim();
  } else if (ogDescMatch && ogDescMatch[1]?.trim().length > 30 && !isDisclaimer(ogDescMatch[1])) {
    excerpt = ogDescMatch[1].trim();
  } else {
    // Extract substantive sentences/paragraphs from cleanText
    const paragraphs = cleanText
      .split(/(?<=[.!?])\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 30 && !isDisclaimer(p));

    if (paragraphs.length > 0) {
      excerpt = paragraphs.slice(0, 3).join(" ").substring(0, 320);
    } else {
      excerpt = cleanText.substring(0, 300);
    }
  }

  // Unescape common HTML entities
  excerpt = excerpt
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  return { title, domain, publisher, published_date, excerpt };
}

/**
 * Detects boilerplate text, disclaimers, challenge pages, and insufficient excerpt text.
 */
export function isBoilerplateOrInsufficientContent(text: string): boolean {
  if (!text || text.trim().length < 35) return true;
  const lower = text.toLowerCase();
  const boilerplateMarkers = [
    "fair use disclaimer",
    "copyrighted materials without specific authorization",
    "please enable cookies and reload the page",
    "attention required! | cloudflare",
    "just a moment...",
    "javascript is required",
    "this page could not be found",
    "access is restricted or blocked",
    "error 404",
  ];
  return boilerplateMarkers.some((m) => lower.includes(m));
}

/**
 * Determines whether the returned HTML is a soft 404 or an error/challenge page.
 */
export function isSoftErrorOrChallengePage(html: string, httpStatus: number): boolean {
  if (httpStatus >= 400) return true;

  const lower = html.toLowerCase();
  const errorIndicators = [
    "<title>404 not found",
    "<title>page not found",
    "<title>403 forbidden",
    "<title>access denied",
    "<title>just a moment...", // Cloudflare challenge
    "<title>attention required! | cloudflare",
    "<h1>404 - page not found",
    "<h1>error 404",
    "this page could not be found",
    "the requested url was not found",
    "please enable cookies and reload the page",
  ];

  return errorIndicators.some((indicator) => lower.includes(indicator));
}

/**
 * Validates a single source URL with safe redirect following, SSRF defense, timeouts, retries,
 * Content-Type validation, 2MB size limit, and content extraction.
 */
export async function validateSourceUrl(
  rawUrl: string,
  options: {
    maxRedirects?: number;
    timeoutMs?: number;
    maxRetries?: number;
    fetchFn?: typeof fetch;
    skipDnsLookup?: boolean;
  } = {}
): Promise<UrlValidationResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxRetries = options.maxRetries ?? 1;
  const customFetch = options.fetchFn ?? fetch;
  const skipDns = Boolean(options.fetchFn || options.skipDnsLookup);

  const normalizedOriginal = normalizeUrl(rawUrl);
  const accessed_date = new Date().toISOString().split("T")[0];

  let currentUrl = normalizedOriginal;
  const redirect_chain: string[] = [normalizedOriginal];
  let redirectsFollowed = 0;

  // Initial SSRF safety verification
  const initialSafety = await isSafeUrl(currentUrl, { skipDnsLookup: skipDns });
  if (!initialSafety.safe) {
    return {
      original_url: rawUrl,
      final_url: currentUrl,
      http_status: null,
      validation_status: "REJECTED",
      title: "Blocked URL",
      publisher: "Security Filter",
      domain: "blocked",
      published_date: null,
      accessed_date,
      content_excerpt: `URL was rejected by security policy: ${initialSafety.reason || "SSRF Protection"}`,
      redirect_chain,
      error_message: initialSafety.reason,
    };
  }

  // Redirect loop
  while (redirectsFollowed <= maxRedirects) {
    let attempt = 0;
    let lastError: any = null;
    let response: Response | null = null;

    while (attempt <= maxRetries) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        response = await customFetch(currentUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (Compatible; AI Research Verifier)",
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
            "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
          },
          redirect: "manual",
          signal: controller.signal,
        });

        clearTimeout(timer);

        // If 429 or 5xx, wait and retry once
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          attempt++;
          await new Promise((res) => setTimeout(res, 1200 * attempt));
          continue;
        }

        break;
      } catch (err: any) {
        lastError = err;
        attempt++;
        if (attempt <= maxRetries) {
          await new Promise((res) => setTimeout(res, 1000));
        }
      }
    }

    if (!response) {
      const isTimeout = lastError?.name === "AbortError" || lastError?.message?.includes("aborted");
      return {
        original_url: rawUrl,
        final_url: currentUrl,
        http_status: null,
        validation_status: isTimeout ? "TEMPORARILY_UNAVAILABLE" : "BROKEN",
        title: "Connection Failed",
        publisher: "Network",
        domain: new URL(currentUrl).hostname,
        published_date: null,
        accessed_date,
        content_excerpt: `Failed to connect: ${lastError?.message || "Network error"}`,
        redirect_chain,
        error_message: lastError?.message,
      };
    }

    const status = response.status;

    // Handle Redirects (301, 302, 303, 307, 308)
    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          original_url: rawUrl,
          final_url: currentUrl,
          http_status: status,
          validation_status: "BROKEN",
          title: "Redirect Failed",
          publisher: "HTTP Server",
          domain: new URL(currentUrl).hostname,
          published_date: null,
          accessed_date,
          content_excerpt: "HTTP redirect response with missing Location header.",
          redirect_chain,
          error_message: "Missing Location header on redirect",
        };
      }

      const nextUrl = normalizeUrl(new URL(location, currentUrl).toString());
      redirect_chain.push(nextUrl);
      redirectsFollowed++;

      // Verify safety of redirect destination against SSRF!
      const redirectSafety = await isSafeUrl(nextUrl, { skipDnsLookup: skipDns });
      if (!redirectSafety.safe) {
        return {
          original_url: rawUrl,
          final_url: nextUrl,
          http_status: status,
          validation_status: "REJECTED",
          title: "Blocked Redirect Destination",
          publisher: "Security Filter",
          domain: new URL(nextUrl).hostname,
          published_date: null,
          accessed_date,
          content_excerpt: `Redirect destination rejected: ${redirectSafety.reason}`,
          redirect_chain,
          error_message: redirectSafety.reason,
        };
      }

      currentUrl = nextUrl;
      continue;
    }

    // Handle 404 / 410 Gone
    if (status === 404 || status === 410) {
      return {
        original_url: rawUrl,
        final_url: currentUrl,
        http_status: status,
        validation_status: "BROKEN",
        title: "Page Not Found",
        publisher: new URL(currentUrl).hostname,
        domain: new URL(currentUrl).hostname,
        published_date: null,
        accessed_date,
        content_excerpt: `The requested page returned HTTP ${status}.`,
        redirect_chain,
        error_message: `HTTP ${status}`,
      };
    }

    // Handle 403 / 401 / Cloudflare challenge
    if (status === 403 || status === 401) {
      return {
        original_url: rawUrl,
        final_url: currentUrl,
        http_status: status,
        validation_status: "ACCESS_RESTRICTED",
        title: "Access Restricted / Protected",
        publisher: new URL(currentUrl).hostname,
        domain: new URL(currentUrl).hostname,
        published_date: null,
        accessed_date,
        content_excerpt: `Access is restricted or blocked by security policy (HTTP ${status}).`,
        redirect_chain,
        error_message: `HTTP ${status}`,
      };
    }

    // Handle 429 / 5xx
    if (status === 429 || status >= 500) {
      return {
        original_url: rawUrl,
        final_url: currentUrl,
        http_status: status,
        validation_status: "TEMPORARILY_UNAVAILABLE",
        title: "Server Temporarily Unavailable",
        publisher: new URL(currentUrl).hostname,
        domain: new URL(currentUrl).hostname,
        published_date: null,
        accessed_date,
        content_excerpt: `Server returned HTTP ${status}. Retries exhausted.`,
        redirect_chain,
        error_message: `HTTP ${status}`,
      };
    }

    // Success HTTP 200..299: Verify Content-Type and 2MB Body Size Limits
    if (status >= 200 && status < 300) {
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      const isHtmlOrText =
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml+xml") ||
        contentType.includes("text/plain") ||
        contentType.includes("application/xml");

      if (!isHtmlOrText) {
        return {
          original_url: rawUrl,
          final_url: currentUrl,
          http_status: status,
          validation_status: "REJECTED",
          title: "Unsupported Non-HTML Content",
          publisher: new URL(currentUrl).hostname,
          domain: new URL(currentUrl).hostname,
          published_date: null,
          accessed_date,
          content_excerpt: `Rejected: Response is binary/non-HTML (${contentType || "unknown"}).`,
          redirect_chain,
          error_message: `Unsupported Content-Type: ${contentType}`,
        };
      }

      // Check Content-Length if present (2MB limit = 2,097,152 bytes)
      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader) {
        const bytes = parseInt(contentLengthHeader, 10);
        if (!isNaN(bytes) && bytes > 2 * 1024 * 1024) {
          return {
            original_url: rawUrl,
            final_url: currentUrl,
            http_status: status,
            validation_status: "REJECTED",
            title: "Oversized Content Blocked",
            publisher: new URL(currentUrl).hostname,
            domain: new URL(currentUrl).hostname,
            published_date: null,
            accessed_date,
            content_excerpt: `Rejected: Content length (${Math.round(bytes / 1024)} KB) exceeds 2MB limit.`,
            redirect_chain,
            error_message: "Response body exceeds 2MB limit",
          };
        }
      }

      let html = "";
      try {
        const fullText = await response.text();
        html = fullText.slice(0, 2 * 1024 * 1024); // Cap reading at 2MB
      } catch (readErr: any) {
        html = "";
      }

      if (isSoftErrorOrChallengePage(html, status)) {
        return {
          original_url: rawUrl,
          final_url: currentUrl,
          http_status: status,
          validation_status: html.toLowerCase().includes("cloudflare") ? "ACCESS_RESTRICTED" : "BROKEN",
          title: "Error or Verification Page",
          publisher: new URL(currentUrl).hostname,
          domain: new URL(currentUrl).hostname,
          published_date: null,
          accessed_date,
          content_excerpt: "Page returned 200 OK but content is an error, captcha, or soft 404.",
          redirect_chain,
        };
      }

      const meta = extractPageMetadata(html, currentUrl);
      const isRedirected = redirect_chain.length > 1;
      const isInsufficient = isBoilerplateOrInsufficientContent(meta.excerpt);

      return {
        original_url: rawUrl,
        final_url: currentUrl,
        http_status: status,
        validation_status: isInsufficient
          ? "SEARCH_RESULT_ONLY"
          : isRedirected
          ? "REDIRECTED_AND_VERIFIED"
          : "VERIFIED",
        title: meta.title,
        publisher: meta.publisher,
        domain: meta.domain,
        published_date: meta.published_date,
        accessed_date,
        content_excerpt: meta.excerpt,
        redirect_chain,
      };
    }

    // Any other unhandled status
    return {
      original_url: rawUrl,
      final_url: currentUrl,
      http_status: status,
      validation_status: "BROKEN",
      title: `HTTP ${status}`,
      publisher: new URL(currentUrl).hostname,
      domain: new URL(currentUrl).hostname,
      published_date: null,
      accessed_date,
      content_excerpt: `Unexpected HTTP status ${status}.`,
      redirect_chain,
      error_message: `HTTP ${status}`,
    };
  }

  // Exceeded max redirects
  return {
    original_url: rawUrl,
    final_url: currentUrl,
    http_status: null,
    validation_status: "BROKEN",
    title: "Redirect Loop Exceeded",
    publisher: "HTTP Client",
    domain: new URL(currentUrl).hostname,
    published_date: null,
    accessed_date,
    content_excerpt: `Exceeded maximum redirect limit of ${maxRedirects} hops.`,
    redirect_chain,
    error_message: "Too many redirects",
  };
}
