import {
  ResearchSource,
  SourceValidationStatus,
  SourceTier,
  SearchProviderStatus,
  LiveSearchErrorCategory,
} from "./types";
import { validateSourceUrl, normalizeUrl } from "./url-validator";

export interface SearchResultCandidate {
  title: string;
  url: string;
  snippet: string;
  source_type: string;
  source_tier: SourceTier;
  publisher?: string;
}

export const THIRD_PARTY_OR_DIRECTORY_DOMAINS = [
  "wikipedia.org",
  "wikidata.org",
  "wikimedia.org",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tavily.com",
  "tracxn.com",
  "cbinsights.com",
  "crunchbase.com",
  "zoominfo.com",
  "pitchbook.com",
  "dnb.com",
  "yellowpages.com",
  "bloomberg.com",
  "reuters.com",
  "glassdoor.com",
  "indeed.com",
  "play.google.com",
  "apps.apple.com",
];

export function isThirdPartyOrDirectoryDomain(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== "string") return false;
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return THIRD_PARTY_OR_DIRECTORY_DOMAINS.some(
      (d) => host === d || host.endsWith("." + d)
    );
  } catch {
    return false;
  }
}

export class ResearchSearchService {
  private static lastExecutionStatus: SearchProviderStatus | null = null;

  static setLastExecutionStatus(status: SearchProviderStatus | null): void {
    this.lastExecutionStatus = status;
  }

  /**
   * Reports the real configuration and availability of external search providers.
   */
  static getProviderStatus(): SearchProviderStatus {
    if (this.lastExecutionStatus) {
      return this.lastExecutionStatus;
    }

    const missing: string[] = [];
    if (!process.env.TAVILY_API_KEY || process.env.TAVILY_API_KEY.trim().length < 5) {
      missing.push("TAVILY_API_KEY");
    }
    if (!process.env.SERPAPI_API_KEY || process.env.SERPAPI_API_KEY.trim().length < 5) {
      missing.push("SERPAPI_API_KEY");
    }
    if (!process.env.BRAVE_API_KEY || process.env.BRAVE_API_KEY.trim().length < 5) {
      missing.push("BRAVE_API_KEY");
    }

    const hasLiveSearch = missing.length < 3;
    let activeProvider = "Curated Knowledge & Encyclopedia Index (Fallback Mode)";
    if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim().length > 5) {
      activeProvider = "Tavily Live Web Search API";
    } else if (process.env.SERPAPI_API_KEY && process.env.SERPAPI_API_KEY.trim().length > 5) {
      activeProvider = "SerpApi Google Search Engine API";
    } else if (process.env.BRAVE_API_KEY && process.env.BRAVE_API_KEY.trim().length > 5) {
      activeProvider = "Brave Search API";
    }

    const providerNotes = hasLiveSearch
      ? `Live external search active via ${activeProvider}.`
      : "Live external search APIs (Tavily/SerpApi/Brave) are not configured. Using validated institutional references and public knowledge endpoints. Commercial statistics must be verified with primary trade sources.";

    return {
      active_provider: activeProvider,
      is_live_search_available: hasLiveSearch,
      missing_credentials: missing,
      provider_notes: providerNotes,
      live_search_attempted: false,
      live_search_succeeded: false,
      live_query_count: 0,
      live_results_count: 0,
      error_category: "NONE",
    };
  }

  /**
   * Hardened Tavily Search API client:
   * - Uses official endpoint https://api.tavily.com/search
   * - Bearer token authentication header + fallback body key
   * - 8-second timeout via AbortController
   * - Gracefully maps 401 (AUTH_ERROR), 402 (QUOTA_EXCEEDED), 429 (RATE_LIMITED), 500+ (SERVER_ERROR)
   * - Handles network errors, timeouts and empty results
   * - Never exposes API secrets in error messages or logs
   */
  static async callTavilySearch(
    query: string,
    options: {
      maxResults?: number;
      searchDepth?: "basic" | "advanced";
      timeoutMs?: number;
      fetchFn?: typeof fetch;
    } = {}
  ): Promise<{
    results: { title: string; url: string; content?: string }[];
    status: number;
    errorCategory: LiveSearchErrorCategory;
    errorMessage?: string;
  }> {
    const rawKey = process.env.TAVILY_API_KEY;
    if (!rawKey || rawKey.trim().length < 5) {
      return {
        results: [],
        status: 0,
        errorCategory: "AUTH_ERROR",
        errorMessage: "TAVILY_API_KEY is not configured.",
      };
    }

    const apiKey = rawKey.trim();
    const timeoutMs = options.timeoutMs ?? 8000;
    const customFetch = options.fetchFn ?? fetch;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await customFetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: options.searchDepth || "basic",
          max_results: options.maxResults ?? 4,
          include_answer: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 401) {
        return {
          results: [],
          status: 401,
          errorCategory: "AUTH_ERROR",
          errorMessage: "Tavily API authentication failed (HTTP 401). Invalid or revoked API credentials.",
        };
      }

      if (res.status === 402) {
        return {
          results: [],
          status: 402,
          errorCategory: "QUOTA_EXCEEDED",
          errorMessage: "Tavily API search quota or credit limit exhausted (HTTP 402).",
        };
      }

      if (res.status === 429) {
        return {
          results: [],
          status: 429,
          errorCategory: "RATE_LIMITED",
          errorMessage: "Tavily API rate limit exceeded (HTTP 429). Please retry shortly.",
        };
      }

      if (res.status >= 500) {
        return {
          results: [],
          status: res.status,
          errorCategory: "SERVER_ERROR",
          errorMessage: `Tavily upstream service error (HTTP ${res.status}).`,
        };
      }

      if (!res.ok) {
        return {
          results: [],
          status: res.status,
          errorCategory: "SERVER_ERROR",
          errorMessage: `Tavily API returned unexpected HTTP status ${res.status}.`,
        };
      }

      const data = await res.json().catch(() => ({}));
      const rawResults = Array.isArray(data.results) ? data.results : [];

      if (rawResults.length === 0) {
        return {
          results: [],
          status: 200,
          errorCategory: "NO_RESULTS",
          errorMessage: "Tavily returned zero results for this query.",
        };
      }

      const validItems = rawResults.filter(
        (r: any) => r && typeof r.url === "string" && r.url.startsWith("http")
      );

      return {
        results: validItems,
        status: 200,
        errorCategory: "NONE",
      };
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === "AbortError") {
        return {
          results: [],
          status: 408,
          errorCategory: "TIMEOUT",
          errorMessage: `Tavily search request timed out after ${timeoutMs}ms.`,
        };
      }
      return {
        results: [],
        status: 0,
        errorCategory: "NETWORK_ERROR",
        errorMessage: "Network connection to Tavily API failed.",
      };
    }
  }

  /**
   * Retrieves real search candidates dynamically based on the client's business, industry, and location.
   * Accepts a single query or an array of campaign-specific targeted queries.
   */
  static async searchWeb(
    queryOrQueries: string | string[],
    industry: string,
    location: string,
    options: { maxCandidates?: number; fetchFn?: typeof fetch; timeoutMs?: number } = {}
  ): Promise<SearchResultCandidate[]> {
    const candidates: SearchResultCandidate[] = [];
    const maxTotal = options.maxCandidates ?? 10;
    const queries = Array.isArray(queryOrQueries) ? queryOrQueries : [queryOrQueries];

    let tavilyAttempted = false;
    let tavilySucceeded = false;
    let queriesExecuted = 0;
    let lastErrorCat: LiveSearchErrorCategory = "NONE";
    let lastErrorMsg: string | undefined = undefined;

    // 1. Tavily API (if configured)
    if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim().length > 5) {
      tavilyAttempted = true;
      for (const q of queries.slice(0, 5)) {
        if (candidates.length >= maxTotal) break;
        queriesExecuted++;

        const searchQuery = q.trim();

        const tavilyRes = await this.callTavilySearch(searchQuery, {
          maxResults: 3,
          timeoutMs: options.timeoutMs ?? 8000,
          fetchFn: options.fetchFn,
        });

        if (tavilyRes.errorCategory !== "NONE" && tavilyRes.errorCategory !== "NO_RESULTS") {
          lastErrorCat = tavilyRes.errorCategory;
          lastErrorMsg = tavilyRes.errorMessage;
          // Halt further requests on auth or quota failure
          if (tavilyRes.status === 401 || tavilyRes.status === 402) {
            break;
          }
        }

        for (const item of tavilyRes.results) {
          if (item.url && item.title && !candidates.some((c) => normalizeUrl(c.url) === normalizeUrl(item.url))) {
            try {
              const parsed = new URL(item.url);
              const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();

              const isSocial = ["facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com", "pinterest.com", "youtube.com"].some(
                (d) => domain === d || domain.endsWith("." + d)
              );
              const isDirectory = THIRD_PARTY_OR_DIRECTORY_DOMAINS.some(
                (d) => domain === d || domain.endsWith("." + d)
              );

              let sourceTier: SourceTier = "SECONDARY";
              if (isSocial || isDirectory) {
                sourceTier = "TERTIARY";
              } else if (
                domain.endsWith(".gov.bd") ||
                domain.endsWith(".gov") ||
                domain.includes("worldbank") ||
                domain.includes("mordorintelligence") ||
                domain.includes("statista")
              ) {
                sourceTier = "PRIMARY";
              }

              candidates.push({
                title: item.title,
                url: item.url,
                snippet: item.content || "",
                source_type: "Live Web Search (Tavily)",
                source_tier: sourceTier,
                publisher: domain,
              });
            } catch {
              // Ignore malformed URL
            }
          }
        }
      }

      if (candidates.length > 0) {
        tavilySucceeded = true;
      }
    }

    // 2. SerpApi (if configured and more candidates needed)
    if (candidates.length < 4 && process.env.SERPAPI_API_KEY && process.env.SERPAPI_API_KEY.trim().length > 5) {
      for (const q of queries.slice(0, 2)) {
        if (candidates.length >= maxTotal) break;
        try {
          const fullQ = q.includes(industry) ? q : `${q} ${industry} ${location}`;
          const url = `https://serpapi.com/search.json?q=${encodeURIComponent(fullQ)}&api_key=${process.env.SERPAPI_API_KEY}`;
          const res = await (options.fetchFn ?? fetch)(url);
          if (res.ok) {
            const data = await res.json();
            for (const item of data.organic_results || []) {
              if (item.link && item.title && !candidates.some((c) => c.url === item.link)) {
                candidates.push({
                  title: item.title,
                  url: item.link,
                  snippet: item.snippet || "",
                  source_type: "Live Web Search (SerpApi)",
                  source_tier: "SECONDARY",
                  publisher: new URL(item.link).hostname,
                });
              }
            }
          }
        } catch (err: any) {
          console.warn("[SearchService] SerpApi search failed:", err.message);
        }
      }
    }

    // Record runtime provider execution status accurately
    if (tavilyAttempted) {
      if (tavilySucceeded) {
        this.lastExecutionStatus = {
          active_provider: "Tavily Live Web Search API",
          is_live_search_available: true,
          missing_credentials: [],
          provider_notes: `Live web search successfully executed via Tavily API (${candidates.length} candidates retrieved across ${queriesExecuted} queries).`,
          live_search_attempted: true,
          live_search_succeeded: true,
          live_query_count: queriesExecuted,
          live_results_count: candidates.length,
          error_category: "NONE",
        };
      } else {
        this.lastExecutionStatus = {
          active_provider: "Curated Knowledge & Encyclopedia Index (Fallback Mode)",
          is_live_search_available: false,
          missing_credentials: [],
          provider_notes: `Tavily live search attempted but encountered ${lastErrorCat}: ${lastErrorMsg || "zero results"}. Falling back to validated institutional references.`,
          live_search_attempted: true,
          live_search_succeeded: false,
          live_query_count: queriesExecuted,
          live_results_count: 0,
          error_category: lastErrorCat,
          error_message: lastErrorMsg,
        };
      }
    } else {
      this.lastExecutionStatus = {
        active_provider: "Curated Knowledge & Encyclopedia Index (Fallback Mode)",
        is_live_search_available: false,
        missing_credentials: ["TAVILY_API_KEY"],
        provider_notes: "Live external search APIs (Tavily/SerpApi/Brave) are not configured. Using validated institutional references and public knowledge endpoints. Commercial statistics must be verified with primary trade sources.",
        live_search_attempted: false,
        live_search_succeeded: false,
        live_query_count: 0,
        live_results_count: 0,
        error_category: "NONE",
      };
    }

    // 3. Wikipedia OpenSearch API (Tertiary Knowledge Base) - Only when candidates < 4
    if (candidates.length < 4) {
      try {
        const primaryQ = queries[0] || `${industry} in ${location}`;
        const searchTerms = [
          `${industry} in ${location}`,
          `${industry}`,
          primaryQ,
        ];

        for (const term of searchTerms) {
          if (candidates.length >= maxTotal || candidates.length >= 4) break;
          const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
            term
          )}&limit=3&namespace=0&format=json`;

          const res = await (options.fetchFn ?? fetch)(wikiUrl, {
            headers: { "User-Agent": "AI-Marketing-Research-Agent/1.0" },
          });

          if (res.ok) {
            const data = await res.json();
            const titles: string[] = data[1] || [];
            const descriptions: string[] = data[2] || [];
            const urls: string[] = data[3] || [];

            for (let i = 0; i < urls.length; i++) {
              if (urls[i] && !candidates.some((c) => normalizeUrl(c.url) === normalizeUrl(urls[i]))) {
                candidates.push({
                  title: titles[i] || `${term} Overview`,
                  url: urls[i],
                  snippet: descriptions[i] || `Encyclopedia entry for ${titles[i]} regarding ${industry}.`,
                  source_type: "Tertiary Reference (Wikipedia)",
                  source_tier: "TERTIARY",
                  publisher: "Wikimedia Foundation",
                });
              }
            }
          }
        }
      } catch (err: any) {
        console.warn("[SearchService] Wikipedia OpenSearch query failed:", err.message);
      }
    }

    // 4. Curated Official & Reputable Industry Intelligence Index - Only when candidates < 4
    if (candidates.length < 4) {
      const curatedRegistry = this.getCuratedVerifiedSources(industry, location);
      for (const item of curatedRegistry) {
        if (candidates.length >= maxTotal) break;
        if (!candidates.some((c) => normalizeUrl(c.url) === normalizeUrl(item.url))) {
          candidates.push(item);
        }
      }
    }

    // Deduplicate candidates by normalized URL
    const seenUrls = new Set<string>();
    const uniqueCandidates: SearchResultCandidate[] = [];

    for (const cand of candidates) {
      const norm = normalizeUrl(cand.url);
      if (seenUrls.has(norm)) continue;
      seenUrls.add(norm);
      uniqueCandidates.push(cand);
    }

    return uniqueCandidates;
  }

  /**
   * Adaptive official industry sources for high-authority verification.
   * Completely universal across any sector and geography.
   */
  private static getCuratedVerifiedSources(industry: string, location: string): SearchResultCandidate[] {
    const isBangladesh = location.toLowerCase().includes("bangladesh") || location.toLowerCase().includes("dhaka");
    const cleanInd = industry.replace(/[^\w\s]/g, " ").trim();

    const results: SearchResultCandidate[] = [];

    // 1. Dynamic Wikipedia Sector Article (Reliable verified portal / topic)
    const indLower = industry.toLowerCase();
    let wikiUrl = "https://en.wikipedia.org/wiki/Retail";
    let wikiTitle = "Retail Industry Overview";
    if (indLower.includes("fashion") || indLower.includes("apparel") || indLower.includes("clothing") || indLower.includes("streetwear")) {
      wikiUrl = "https://en.wikipedia.org/wiki/Clothing";
      wikiTitle = "Clothing and Apparel Industry Overview";
    } else if (indLower.includes("food") || indLower.includes("restaurant") || indLower.includes("dining")) {
      wikiUrl = "https://en.wikipedia.org/wiki/Restaurant";
      wikiTitle = "Restaurant and Food Service Industry Overview";
    } else if (indLower.includes("saas") || indLower.includes("software")) {
      wikiUrl = "https://en.wikipedia.org/wiki/Software_as_a_service";
      wikiTitle = "Software as a Service (SaaS) Overview";
    } else if (indLower.includes("health") || indLower.includes("medical") || indLower.includes("clinic")) {
      wikiUrl = "https://en.wikipedia.org/wiki/Healthcare";
      wikiTitle = "Healthcare Industry Overview";
    } else if (indLower.includes("real estate") || indLower.includes("property")) {
      wikiUrl = "https://en.wikipedia.org/wiki/Real_estate";
      wikiTitle = "Real Estate Industry Overview";
    } else if (indLower.includes("ecommerce") || indLower.includes("e-commerce") || indLower.includes("commerce")) {
      wikiUrl = "https://en.wikipedia.org/wiki/E-commerce";
      wikiTitle = "E-commerce Industry Overview";
    }

    results.push({
      title: wikiTitle,
      url: wikiUrl,
      snippet: `Historical, operational, and macroeconomic overview of the ${cleanInd} sector.`,
      source_type: "Tertiary Reference (Wikipedia)",
      source_tier: "TERTIARY",
      publisher: "Wikipedia",
    });

    if (isBangladesh) {
      results.push(
        {
          title: "The Daily Star Business & Commerce News",
          url: "https://www.thedailystar.net/business",
          snippet: `Leading national English newspaper reporting domestic commerce trends, consumer spending, and market developments across Bangladesh.`,
          source_type: "Reputable News Media",
          source_tier: "SECONDARY",
          publisher: "The Daily Star",
        },
        {
          title: "Dhaka Tribune National Business Overview",
          url: "https://www.dhakatribune.com/business",
          snippet: `National daily coverage of Bangladeshi business growth, digital adoption, and commercial trends.`,
          source_type: "Reputable News Media",
          source_tier: "SECONDARY",
          publisher: "Dhaka Tribune",
        }
      );
    } else {
      // Global / Other regions
      results.push(
        {
          title: "World Bank Open Data",
          url: "https://data.worldbank.org",
          snippet: "Free and open access to global development data and country income indicators.",
          source_type: "International Statistical Database",
          source_tier: "PRIMARY",
          publisher: "World Bank",
        },
        {
          title: "International Trade Administration",
          url: "https://www.trade.gov",
          snippet: "Official international commercial trade guides and market intelligence.",
          source_type: "Government Trade Authority",
          source_tier: "PRIMARY",
          publisher: "Trade.gov",
        }
      );
    }

    return results;
  }

  /**
   * Universal competitor resolution without industry hardcoding.
   */
  static async discoverCompetitors(
    productName: string,
    industry: string,
    location: string,
    clientRefs: string[] = [],
    options: { fetchFn?: typeof fetch } = {}
  ): Promise<{ name: string; website?: string; products?: string; price_range?: string; positioning?: string; offers?: string }[]> {
    if (clientRefs && clientRefs.length > 0) {
      // If client supplied competitor brand names, search for their live official websites if Tavily is available
      const resolved: { name: string; website?: string; products?: string; price_range?: string; positioning?: string; offers?: string }[] = [];
      for (const name of clientRefs) {
        let website = "";
        if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim().length > 5) {
          try {
            // Targeted query with negative filters to exclude third-party profiles/directories
            const compQuery = `"${name}" official website store ${location} -site:wikipedia.org -site:tavily.com -site:linkedin.com -site:facebook.com`;
            const res = await this.callTavilySearch(compQuery, {
              maxResults: 5,
              timeoutMs: 6000,
              fetchFn: options.fetchFn,
            });

            // Extract brand keywords to match against domain
            const brandTokens = name
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, "")
              .split(/\s+/)
              .filter((w) => w.length >= 3 && !["clothing", "outfits", "style", "shop", "store"].includes(w));
            const primaryToken = brandTokens[0] || name.toLowerCase().replace(/[^a-z0-9]/g, "");

            for (const item of res.results) {
              if (!item?.url) continue;
              if (isThirdPartyOrDirectoryDomain(item.url)) continue;

              try {
                const parsedHost = new URL(item.url).hostname.toLowerCase();
                if (parsedHost.includes(primaryToken) || item.url.toLowerCase().includes(primaryToken)) {
                  website = item.url;
                  break;
                }
              } catch {
                // invalid url
              }
            }

            // Fallback to first non-third-party result if no token match found
            if (!website && res.results.length > 0) {
              const firstValid = res.results.find((r) => r?.url && !isThirdPartyOrDirectoryDomain(r.url));
              if (firstValid?.url) {
                website = firstValid.url;
              }
            }
          } catch {
            // Keep website empty on search failure
          }
        }
        resolved.push({
          name,
          website,
          products: productName,
          price_range: "Public catalog pricing",
          positioning: `Competitor in ${industry}`,
          offers: "Standard commercial promotions",
        });
      }
      return resolved;
    }

    // If client provided no competitor references, avoid defaulting to apparel/fashion brands!
    if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim().length > 5) {
      try {
        const query = `top ${productName} ${industry} competitors in ${location} -site:wikipedia.org -site:tavily.com -site:linkedin.com`;
        const res = await this.callTavilySearch(query, {
          maxResults: 5,
          timeoutMs: 8000,
          fetchFn: options.fetchFn,
        });

        if (res.results.length > 0) {
          const discovered: any[] = [];
          for (const item of res.results) {
            if (item.title && item.url && !isThirdPartyOrDirectoryDomain(item.url)) {
              try {
                const domain = new URL(item.url).hostname.replace(/^www\./, "");
                const brandName = item.title.split(/[-|–:]/)[0]?.trim() || domain;
                discovered.push({
                  name: brandName,
                  website: item.url,
                  products: productName,
                  price_range: "Public storefront pricing",
                  positioning: `Market competitor identified via live search`,
                  offers: "Observed commercial offerings",
                });
              } catch {
                // ignore invalid URL
              }
            }
          }
          if (discovered.length > 0) return discovered.slice(0, 3);
        }
      } catch (err: any) {
        console.warn("[SearchService] Competitor live search failed:", err.message);
      }
    }

    return [
      {
        name: `Direct Competitors in ${industry}`,
        website: "",
        products: productName,
        price_range: "Market catalog pricing",
        positioning: `Alternative market options for ${productName} in ${location}`,
        offers: "Commercial promotions",
      },
    ];
  }

  /**
   * Retrieves and validates a competitor's live website domain.
   * NEVER guesses domain names (e.g. competitorname.com). Only checks supplied or confirmed domains.
   */
  static async verifyCompetitorWebsite(rawUrl: string, competitorName: string): Promise<{
    url: string;
    final_url: string;
    http_status: number | null;
    status: SourceValidationStatus;
    is_official_domain: boolean;
    title: string;
    excerpt: string;
    notes?: string;
  }> {
    if (!rawUrl || rawUrl.trim().length === 0) {
      return {
        url: "",
        final_url: "",
        http_status: null,
        status: "BROKEN",
        is_official_domain: false,
        title: `${competitorName} (Domain Unverified)`,
        excerpt: "No verified website provided. Domain guessing is disabled to prevent routing to parked or expired domains.",
        notes: "Official website not provided by client or verified via search.",
      };
    }

    if (isThirdPartyOrDirectoryDomain(rawUrl)) {
      return {
        url: rawUrl,
        final_url: rawUrl,
        http_status: 200,
        status: "SEARCH_RESULT_ONLY",
        is_official_domain: false,
        title: `${competitorName} (Third-Party Directory / Profile)`,
        excerpt: `URL points to a third-party profile or directory, not the official ${competitorName} domain.`,
        notes: "Third-party profile/directory rejected as official website.",
      };
    }

    const validation = await validateSourceUrl(rawUrl, { timeoutMs: 6000, maxRetries: 1 });

    if (isThirdPartyOrDirectoryDomain(validation.final_url)) {
      return {
        url: rawUrl,
        final_url: validation.final_url,
        http_status: validation.http_status,
        status: "SEARCH_RESULT_ONLY",
        is_official_domain: false,
        title: `${competitorName} (Third-Party Directory / Profile)`,
        excerpt: `URL redirected to a third-party profile or directory (${validation.domain}).`,
        notes: "Third-party profile/directory rejected as official website.",
      };
    }

    // Detect domain parkers (e.g. HugeDomains, Sedo, GoDaddy parked)
    const isParkedDomain =
      validation.final_url.includes("hugedomains.com") ||
      validation.final_url.includes("sedoparking.com") ||
      validation.final_url.includes("dan.com") ||
      validation.title.toLowerCase().includes("buy this domain") ||
      validation.title.toLowerCase().includes("domain is for sale");

    const isOfficial =
      (validation.validation_status === "VERIFIED" || validation.validation_status === "REDIRECTED_AND_VERIFIED") &&
      !isParkedDomain;

    return {
      url: rawUrl,
      final_url: validation.final_url,
      http_status: validation.http_status,
      status: isParkedDomain ? "BROKEN" : validation.validation_status,
      is_official_domain: isOfficial,
      title: isParkedDomain ? `${competitorName} (Parked / Expired Domain)` : validation.title || `${competitorName} Official Site`,
      excerpt: isParkedDomain ? "URL redirected to a domain sales broker. Website is inactive." : validation.content_excerpt,
      notes: isParkedDomain ? "Redirected to third-party domain sales broker." : undefined,
    };
  }

  /**
   * Validates an entire array of search candidates, resolving redirect chains and assigning Source IDs.
   */
  static async validateAndEnrichCandidates(
    candidates: SearchResultCandidate[]
  ): Promise<ResearchSource[]> {
    const verifiedSources: ResearchSource[] = [];
    let counter = 1;

    for (const candidate of candidates) {
      const validation = await validateSourceUrl(candidate.url, { timeoutMs: 7000, maxRetries: 1 });

      const sourceId = `SRC-${String(counter).padStart(3, "0")}`;
      counter++;

      const domain = (validation.domain || "").toLowerCase();
      const isSocial = ["facebook.com", "instagram.com", "tiktok.com", "twitter.com", "x.com", "pinterest.com", "youtube.com"].some(
        (d) => domain === d || domain.endsWith("." + d)
      );
      const isDirectory = THIRD_PARTY_OR_DIRECTORY_DOMAINS.some(
        (d) => domain === d || domain.endsWith("." + d)
      );

      let finalTier = candidate.source_tier || "SECONDARY";
      let finalType = candidate.source_type || "Market Research Source";
      if (isSocial) {
        finalTier = "TERTIARY";
        finalType = "Social Media Post";
      } else if (isDirectory) {
        finalTier = "TERTIARY";
        finalType = "Company Directory Profile";
      }

      verifiedSources.push({
        source_id: sourceId,
        title: validation.title && validation.title !== "Connection Failed" ? validation.title : candidate.title,
        publisher: validation.publisher || candidate.publisher || validation.domain,
        domain: validation.domain,
        original_url: candidate.url,
        final_url: validation.final_url,
        published_date: validation.published_date,
        accessed_date: validation.accessed_date,
        http_status: validation.http_status,
        validation_status: validation.validation_status,
        source_type: finalType,
        source_tier: finalTier,
        is_social_media: isSocial,
        is_directory_listing: isDirectory,
        evidence_excerpt:
          validation.content_excerpt && validation.content_excerpt.length > 20
            ? validation.content_excerpt
            : candidate.snippet,
        supported_finding_ids: [],
        redirect_chain: validation.redirect_chain,
        content_snippet: validation.content_excerpt,
      });
    }

    return verifiedSources;
  }
}
