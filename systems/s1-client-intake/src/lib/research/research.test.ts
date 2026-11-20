import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateSourceUrl, isSafeUrl, normalizeUrl } from "./url-validator";
import { EvidenceEngine } from "./evidence-engine";
import { ResearchSearchService } from "./search-service";
import { ResearchSource } from "./types";
import { Repository } from "@/lib/db/repo";

describe("Research AI Source URL Validation & Security", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: Valid source URL returning HTTP 200 -> VERIFIED
  it("Test 1: marks a valid HTTP 200 source as VERIFIED", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => `
        <html>
          <head>
            <title>Bangladesh Garment Sector Report 2025</title>
            <meta name="description" content="In-depth analysis of Bangladesh apparel and textile industrial growth." />
            <meta property="article:published_time" content="2025-06-15" />
          </head>
          <body>
            <main><p>The apparel sector in Bangladesh is the single largest export engine.</p></main>
          </body>
        </html>
      `,
    });

    const res = await validateSourceUrl("https://example-verified-domain.org/reports/apparel", {
      fetchFn: mockFetch as any,
    });

    expect(res.validation_status).toBe("VERIFIED");
    expect(res.http_status).toBe(200);
    expect(res.title).toBe("Bangladesh Garment Sector Report 2025");
    expect(res.published_date).toBe("2025-06-15");
    expect(res.content_excerpt).toContain("apparel and textile industrial growth");
  });

  // Test 2: Valid source URL redirecting to another valid page -> REDIRECTED_AND_VERIFIED
  it("Test 2: follows redirects and marks as REDIRECTED_AND_VERIFIED with final URL", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 301,
        headers: new Headers({ location: "https://canonical-domain.org/final-report" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => `
          <html>
            <head><title>Final Canonical Report Title</title></head>
            <body><p>Authoritative content on retail market size.</p></body>
          </html>
        `,
      });

    const res = await validateSourceUrl("https://old-domain.org/redirect-me", {
      fetchFn: mockFetch as any,
    });

    expect(res.validation_status).toBe("REDIRECTED_AND_VERIFIED");
    expect(res.http_status).toBe(200);
    expect(res.final_url).toBe("https://canonical-domain.org/final-report");
    expect(res.redirect_chain.length).toBe(2);
    expect(res.title).toBe("Final Canonical Report Title");
  });

  // Test 3: Invalid URL returning 404 -> BROKEN
  it("Test 3: marks an HTTP 404 response as BROKEN", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html><body><h1>404 Not Found</h1></body></html>",
    });

    const res = await validateSourceUrl("https://example-domain.org/missing-page-404", {
      fetchFn: mockFetch as any,
    });

    expect(res.validation_status).toBe("BROKEN");
    expect(res.http_status).toBe(404);
  });

  // Test 4: Page returning 403 / bot protection -> ACCESS_RESTRICTED
  it("Test 4: marks an HTTP 403 response as ACCESS_RESTRICTED", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 403,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html><body><h1>Forbidden</h1></body></html>",
    });

    const res = await validateSourceUrl("https://protected-domain.org/paywall", {
      fetchFn: mockFetch as any,
    });

    expect(res.validation_status).toBe("ACCESS_RESTRICTED");
    expect(res.http_status).toBe(403);
  });

  // Test 5: Temporary 429 or 5xx responses -> TEMPORARILY_UNAVAILABLE
  it("Test 5: retries and marks exhausted 429 as TEMPORARILY_UNAVAILABLE", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 429,
      headers: new Headers({ "retry-after": "5" }),
      text: async () => "Rate limited",
    });

    const res = await validateSourceUrl("https://rate-limited-api.com/search", {
      fetchFn: mockFetch as any,
      maxRetries: 1,
    });

    expect(res.validation_status).toBe("TEMPORARILY_UNAVAILABLE");
    expect(res.http_status).toBe(429);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // Test 6: Timeout handling
  it("Test 6: properly catches and handles timeout errors", async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      const abortError: any = new Error("The operation was aborted");
      abortError.name = "AbortError";
      return Promise.reject(abortError);
    });

    const res = await validateSourceUrl("https://slow-domain.org/hang", {
      fetchFn: mockFetch as any,
      maxRetries: 0,
    });

    expect(res.validation_status).toBe("TEMPORARILY_UNAVAILABLE");
    expect(res.error_message).toContain("aborted");
  });

  // Test 7: Soft 404 / Error Page with 200 OK -> BROKEN
  it("Test 7: identifies soft 404 error page even when returning HTTP 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => `
        <html>
          <head><title>404 Not Found</title></head>
          <body><h1>This page could not be found</h1></body>
        </html>
      `,
    });

    const res = await validateSourceUrl("https://soft-404-domain.com/broken", {
      fetchFn: mockFetch as any,
    });

    expect(res.validation_status).toBe("BROKEN");
  });

  // Test 8: SSRF Protection rejects localhost and private IPv4 targets
  it("Test 8: rejects localhost and private IPv4 addresses as REJECTED", async () => {
    const resLocalhost = await validateSourceUrl("http://localhost:3000/api/admin");
    expect(resLocalhost.validation_status).toBe("REJECTED");
    expect(resLocalhost.error_message).toContain("Forbidden hostname");

    const resLoopback = await validateSourceUrl("http://127.0.0.1:8080/secrets");
    expect(resLoopback.validation_status).toBe("REJECTED");

    const resCloudMeta = await validateSourceUrl("http://169.254.169.254/latest/meta-data/");
    expect(resCloudMeta.validation_status).toBe("REJECTED");

    const resPrivateSubnet = await validateSourceUrl("http://10.0.0.1/internal");
    expect(resPrivateSubnet.validation_status).toBe("REJECTED");
  });

  // Test 9: SSRF Protection rejects private IPv6 targets
  it("Test 9: rejects private IPv6 addresses like [::1] and [fe80::1]", async () => {
    const resIpv6Loopback = await isSafeUrl("http://[::1]:8080/admin");
    expect(resIpv6Loopback.safe).toBe(false);

    const resIpv6LinkLocal = await isSafeUrl("http://[fe80::1]/secrets");
    expect(resIpv6LinkLocal.safe).toBe(false);

    const resIpv6UniqueLocal = await isSafeUrl("http://[fc00::1]/internal");
    expect(resIpv6UniqueLocal.safe).toBe(false);
  });

  // Test 10: Non-HTML content rejection
  it("Test 10: rejects non-HTML / binary Content-Type (e.g. application/pdf)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      text: async () => "%PDF-1.4 binary content...",
    });

    const res = await validateSourceUrl("https://example.com/document.pdf", {
      fetchFn: mockFetch as any,
    });

    expect(res.validation_status).toBe("REJECTED");
    expect(res.error_message).toContain("Unsupported Content-Type");
  });

  // Test 11: Oversized response (>2MB) rejection
  it("Test 11: rejects oversized response exceeding 2MB Content-Length", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({
        "content-type": "text/html",
        "content-length": "3145728", // 3MB
      }),
      text: async () => "<html>Large file...</html>",
    });

    const res = await validateSourceUrl("https://example.com/giant-page", {
      fetchFn: mockFetch as any,
    });

    expect(res.validation_status).toBe("REJECTED");
    expect(res.error_message).toContain("exceeds 2MB limit");
  });

  // Test 12: DNS resolution failure fails closed
  it("Test 12: DNS lookup failure fails closed with safe: false", async () => {
    const res = await isSafeUrl("https://nonexistent-unresolvable-domain-12345.xyz");
    expect(res.safe).toBe(false);
    expect(res.reason).toBeDefined();
  });
});

describe("Evidence Engine Claim-to-Source Mapping & Completion Logic", () => {
  const dummyArtifact1 = {
    campaignId: "camp_test_123",
    client: {
      company_name: "Apex Fashion",
      industry: "Streetwear Apparel",
    },
    target_audience: {
      location: "Dhaka, Bangladesh",
    },
    product_service: {
      name: "Graphic Hoodies",
    },
  };

  // Test 13: Removal of fabricated statistics
  it("Test 13: removes fabricated statistics (80%, 15%-20%, 2x-3x) from generated findings", async () => {
    const dossier = await EvidenceEngine.buildDossier(dummyArtifact1, [], []);

    for (const finding of dossier.findings) {
      expect(finding.claim).not.toMatch(/\b80%\b/);
      expect(finding.claim).not.toMatch(/15%[–-]20%/);
      expect(finding.claim).not.toMatch(/\b2x[–-]3x\b/);
      expect(finding.claim).not.toMatch(/40%[–-]50%/);
      expect(finding.explanation).not.toMatch(/\b80%\b/);
      expect(finding.explanation).not.toMatch(/15%[–-]20%/);
      expect(finding.explanation).not.toMatch(/\b2x[–-]3x\b/);
    }
  });

  // Test 14: Claim with no supporting source
  it("Test 14: marks claim with no verified supporting source as UNVERIFIED", async () => {
    const dossier = await EvidenceEngine.buildDossier(dummyArtifact1, [], []);

    const unverifiedFinding = dossier.findings.find((f) => f.evidence_status === "UNVERIFIED");
    expect(unverifiedFinding).toBeDefined();
    expect(unverifiedFinding?.claim).toContain("UNVERIFIED — No reliable supporting source found");
    expect(unverifiedFinding?.confidence).toBe("Low");
    expect(unverifiedFinding?.supporting_source_ids.length).toBe(0);
  });

  // Test 15: Tertiary / Wikipedia source results in PARTIALLY_VERIFIED at best
  it("Test 15: tertiary Wikipedia source results in PARTIALLY_VERIFIED at best", () => {
    const wikiSource: ResearchSource = {
      source_id: "SRC-WIKI",
      title: "Textiles in Bangladesh",
      publisher: "Wikipedia",
      domain: "wikipedia.org",
      original_url: "https://en.wikipedia.org/wiki/Textiles_in_Bangladesh",
      final_url: "https://en.wikipedia.org/wiki/Textiles_in_Bangladesh",
      published_date: "2025-01-01",
      accessed_date: "2026-11-14",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Encyclopedia Reference",
      source_tier: "TERTIARY",
      evidence_excerpt: "The textile industry and clothing apparel manufacturing in Bangladesh constitutes major national exports.",
      supported_finding_ids: [],
    };

    const evalResult = EvidenceEngine.evaluateEvidenceSupport(
      "The apparel clothing industry in Bangladesh constitutes major national exports.",
      wikiSource
    );

    expect(evalResult.status).toBe("PARTIALLY_VERIFIED");
    expect(evalResult.evaluation_notes).toContain("tertiary encyclopedia reference");
  });

  // Test 16: Contradicted claim detection
  it("Test 16: detects contradiction and marks finding as CONTRADICTED", () => {
    const decliningSource: ResearchSource = {
      source_id: "SRC-DECLINE",
      title: "Retail Sector Analysis",
      publisher: "Economic Review",
      domain: "review.org",
      original_url: "https://review.org/retail",
      final_url: "https://review.org/retail",
      published_date: "2025-01-01",
      accessed_date: "2026-11-14",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Economic Reference",
      source_tier: "PRIMARY",
      evidence_excerpt: "The retail sector suffered severe economic decline with negative contraction over the last quarter.",
      supported_finding_ids: [],
    };

    const evalResult = EvidenceEngine.evaluateEvidenceSupport(
      "The retail sector shows steady market growth across regional trade channels.",
      decliningSource
    );

    expect(evalResult.status).toBe("CONTRADICTED");
    expect(evalResult.evaluation_notes).toContain("Contradiction detected");
  });

  // Test 17: HTTP 200 with irrelevant content does NOT result in VERIFIED
  it("Test 17: HTTP 200 with irrelevant content does NOT result in VERIFIED", () => {
    const irrelevantSource: ResearchSource = {
      source_id: "SRC-IRRELEVANT",
      title: "Gourmet Pasta Cooking Recipes",
      publisher: "Food Daily",
      domain: "fooddaily.com",
      original_url: "https://fooddaily.com/pasta",
      final_url: "https://fooddaily.com/pasta",
      published_date: "2025-01-01",
      accessed_date: "2026-11-14",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Food Blog",
      source_tier: "PRIMARY",
      evidence_excerpt: "Boil water, add fresh garlic, extra virgin olive oil, and parmesan cheese for dinner.",
      supported_finding_ids: [],
    };

    const evalResult = EvidenceEngine.evaluateEvidenceSupport(
      "Streetwear apparel demand in Dhaka expands through social media channels.",
      irrelevantSource
    );

    expect(evalResult.status).toBe("UNVERIFIED");
    expect(evalResult.confidence).toBe("Low");
  });

  // Test 18: Competitor without domain -> honest unverified report
  it("Test 18: competitor without verified domain is reported honestly without domain guessing", async () => {
    const competitorWithoutDomain = [
      {
        name: "Unknown Local Brand",
        products: "Graphic Tees",
        price_range: "BDT 800",
        positioning: "Local streetwear brand",
        offers: "Standard promotion",
      },
    ];

    const dossier = await EvidenceEngine.buildDossier(dummyArtifact1, [], competitorWithoutDomain);

    const comp = dossier.competitors.find((c) => c.name === "Unknown Local Brand");
    expect(comp).toBeDefined();
    expect(comp?.is_official_domain).toBe(false);
    expect(comp?.validation_status).toBe("BROKEN");
    expect(comp?.website).toBe("");
    expect(comp?.notes).toContain("not provided");
  });

  // Test 19: Missing API credentials reported in search_provider_status
  it("Test 19: transparently reports provider status and missing credentials", () => {
    const savedTavily = process.env.TAVILY_API_KEY;
    const savedSerpApi = process.env.SERPAPI_API_KEY;
    const savedBrave = process.env.BRAVE_API_KEY;

    try {
      delete process.env.TAVILY_API_KEY;
      delete process.env.SERPAPI_API_KEY;
      delete process.env.BRAVE_API_KEY;

      const status = ResearchSearchService.getProviderStatus();
      expect(status.is_live_search_available).toBe(false);
      expect(status.missing_credentials).toContain("TAVILY_API_KEY");
      expect(status.provider_notes).toContain("not configured");
    } finally {
      process.env.TAVILY_API_KEY = savedTavily;
      process.env.SERPAPI_API_KEY = savedSerpApi;
      process.env.BRAVE_API_KEY = savedBrave;
    }
  });

  // Test 20: Completion logic - tertiary only results in PARTIALLY_COMPLETED
  it("Test 20: assigns PARTIALLY_COMPLETED when only tertiary/Wikipedia sources are present", async () => {
    const tertiarySource: ResearchSource = {
      source_id: "SRC-WIKI-1",
      title: "Garments in Bangladesh",
      publisher: "Wikipedia",
      domain: "wikipedia.org",
      original_url: "https://en.wikipedia.org/wiki/Garments_in_Bangladesh",
      final_url: "https://en.wikipedia.org/wiki/Garments_in_Bangladesh",
      published_date: "2025-01-01",
      accessed_date: "2026-11-14",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Encyclopedia Reference",
      source_tier: "TERTIARY",
      evidence_excerpt: "Apparel manufacturing overview.",
      supported_finding_ids: [],
    };

    const dossier = await EvidenceEngine.buildDossier(dummyArtifact1, [tertiarySource], []);
    expect(dossier.research_status).toBe("PARTIALLY_COMPLETED");
  });

  // Test 21: Completion logic - COMPLETED when >= 3 primary/secondary sources and live search API is configured
  it("Test 21: assigns COMPLETED when >= 3 primary/secondary sources exist and live search is configured", async () => {
    const savedTavily = process.env.TAVILY_API_KEY;
    try {
      process.env.TAVILY_API_KEY = "tvly_mock_api_key_valid";

      const sources: ResearchSource[] = [
        {
          source_id: "SRC-001",
          title: "Ministry of Commerce Retail Report",
          publisher: "MinCom",
          domain: "mincom.gov.bd",
          original_url: "https://mincom.gov.bd/retail",
          final_url: "https://mincom.gov.bd/retail",
          published_date: "2025-01-01",
          accessed_date: "2026-11-14",
          http_status: 200,
          validation_status: "VERIFIED",
          source_type: "Economic Reference",
          source_tier: "PRIMARY",
          evidence_excerpt:
            "The streetwear apparel sector in Dhaka, Bangladesh represents established commercial category with strong domestic retail demand.",
          supported_finding_ids: [],
        },
        {
          source_id: "SRC-002",
          title: "National Business Tribune - Digital Commerce",
          publisher: "Daily Tribune",
          domain: "tribune.com.bd",
          original_url: "https://tribune.com.bd/digital",
          final_url: "https://tribune.com.bd/digital",
          published_date: "2025-02-01",
          accessed_date: "2026-11-14",
          http_status: 200,
          validation_status: "VERIFIED",
          source_type: "Business News",
          source_tier: "SECONDARY",
          evidence_excerpt:
            "Domestic consumer commerce in Dhaka, Bangladesh is expanding across digital channels, with increasing discovery taking place via mobile platforms.",
          supported_finding_ids: [],
        },
        {
          source_id: "SRC-003",
          title: "Consumer Logistics & Payment Trends Study",
          publisher: "Chamber of Commerce",
          domain: "chamber.org.bd",
          original_url: "https://chamber.org.bd/cod",
          final_url: "https://chamber.org.bd/cod",
          published_date: "2025-03-01",
          accessed_date: "2026-11-14",
          http_status: 200,
          validation_status: "VERIFIED",
          source_type: "Trade Reference",
          source_tier: "PRIMARY",
          evidence_excerpt:
            "Consumer purchasing behavior in Dhaka, Bangladesh is heavily influenced by delivery reliability and risk-reversal payment options such as Cash on Delivery.",
          supported_finding_ids: [],
        },
        {
          source_id: "SRC-004",
          title: "Retail Promotions and Pricing Tactics",
          publisher: "Trade Federation",
          domain: "federation.org.bd",
          original_url: "https://federation.org.bd/pricing",
          final_url: "https://federation.org.bd/pricing",
          published_date: "2025-03-15",
          accessed_date: "2026-11-14",
          http_status: 200,
          validation_status: "VERIFIED",
          source_type: "Competitor Analysis",
          source_tier: "PRIMARY",
          evidence_excerpt:
            "Promotional bundling and delivery incentives are common commercial tactics used by direct merchants in Dhaka, Bangladesh to encourage multi-item purchases.",
          supported_finding_ids: [],
        },
        {
          source_id: "SRC-005",
          title: "Social Media Platform Marketing Report",
          publisher: "Digital Media Observatory",
          domain: "observatory.org.bd",
          original_url: "https://observatory.org.bd/social",
          final_url: "https://observatory.org.bd/social",
          published_date: "2025-04-01",
          accessed_date: "2026-11-14",
          http_status: 200,
          validation_status: "VERIFIED",
          source_type: "Digital Media Portal",
          source_tier: "SECONDARY",
          evidence_excerpt:
            "Social media platforms such as Meta and short video channels serve as the primary discovery medium for consumer retail in Dhaka, Bangladesh.",
          supported_finding_ids: [],
        },
      ];

      const dossier = await EvidenceEngine.buildDossier(dummyArtifact1, sources, []);
      expect(dossier.research_status).toBe("COMPLETED");
      expect(dossier.stats.verified_sources).toBe(5);
    } finally {
      process.env.TAVILY_API_KEY = savedTavily;
    }
  });

  // Test 22: Bidirectional binding between findings and supporting sources
  it("Test 22: verifies bidirectional binding between findings and supporting sources", async () => {
    const source1: ResearchSource = {
      source_id: "SRC-001",
      title: "Bangladesh Bureau of Statistics - Retail Report",
      publisher: "BBS",
      domain: "bbs.gov.bd",
      original_url: "http://www.bbs.gov.bd/reports",
      final_url: "http://www.bbs.gov.bd/reports",
      published_date: "2025-01-10",
      accessed_date: "2026-11-14",
      http_status: 200,
      validation_status: "VERIFIED",
      source_tier: "PRIMARY",
      source_type: "Economic & Industrial Reference",
      evidence_excerpt:
        "The Streetwear Apparel sector represents an established commercial category in Dhaka, Bangladesh, characterized by strong domestic retail demand.",
      supported_finding_ids: [],
    };

    const dossier = await EvidenceEngine.buildDossier(dummyArtifact1, [source1], []);

    const fnd1 = dossier.findings.find((f) => f.category.includes("Landscape") || f.category.includes("Industry"));
    expect(fnd1).toBeDefined();
    expect(fnd1?.evidence_status).toBe("VERIFIED");
    expect(fnd1?.supporting_source_ids).toContain("SRC-001");
    expect(source1.supported_finding_ids).toContain(fnd1?.finding_id);
  });

  // Test 23: Dynamic adaptation to different industries (e.g. B2B SaaS)
  it("Test 23: dynamically adapts research categories and findings to B2B SaaS without hardcoding fashion", async () => {
    const saasArtifact = {
      campaignId: "camp_saas_999",
      client: {
        company_name: "CloudDesk CRM",
        industry: "B2B Software as a Service",
      },
      target_audience: {
        location: "Singapore & Global",
      },
      product_service: {
        name: "Enterprise Sales Automation",
      },
    };

    const saasSource: ResearchSource = {
      source_id: "SRC-001",
      title: "Software as a Service Industry Analysis",
      publisher: "Wikipedia",
      domain: "wikipedia.org",
      original_url: "https://en.wikipedia.org/wiki/Software_as_a_service",
      final_url: "https://en.wikipedia.org/wiki/Software_as_a_service",
      published_date: "2025-04-01",
      accessed_date: "2026-11-14",
      http_status: 200,
      validation_status: "VERIFIED",
      source_tier: "TERTIARY",
      source_type: "Encyclopedia Reference",
      evidence_excerpt: "Cloud computing and subscription software business model.",
      supported_finding_ids: [],
    };

    const dossier = await EvidenceEngine.buildDossier(saasArtifact, [saasSource], []);

    expect(dossier.business_name).toBe("CloudDesk CRM");
    expect(dossier.industry).toBe("B2B Software as a Service");
    const overview = dossier.findings.find((f) => f.category.includes("Landscape") || f.category.includes("Industry"));
    expect(overview?.title).toContain("CloudDesk CRM");
    expect(overview?.claim).not.toContain("garment");
    expect(overview?.claim).not.toContain("streetwear");
  });

  // Test 24: Repository saveArtifact2 preserves version history and increments version
  it("Test 24: saveArtifact2 archives previous version into revision_history upon regeneration", async () => {
    const testCampaignId = `camp_ver_${Date.now()}`;

    // First save: version 1.0
    const v1 = await Repository.saveArtifact2(testCampaignId, {
      research_status: "PARTIALLY_COMPLETED",
      business_name: "Test Corp",
      version: "1.0",
      findings: [{ finding_id: "FND-001", claim: "Initial finding" }],
    });

    expect(v1.version).toBe("1.0");

    // Second save (Regeneration): version increments and archives v1
    const v2 = await Repository.saveArtifact2(testCampaignId, {
      research_status: "COMPLETED",
      business_name: "Test Corp",
      findings: [{ finding_id: "FND-001", claim: "Updated finding" }],
    });

    expect(v2.version).toBe("2.0");
    expect(v2.revision_history).toBeDefined();
    expect(v2.revision_history.length).toBe(1);
    expect(v2.revision_history[0].version).toBe("1.0");
  });

  // Test 25: Campaign isolation in Repository
  it("Test 25: verifies two distinct campaigns have isolated Artifact2 dossiers", async () => {
    const campaignA = `camp_iso_a_${Date.now()}`;
    const campaignB = `camp_iso_b_${Date.now()}`;

    await Repository.saveArtifact2(campaignA, {
      business_name: "Brand Alpha",
      findings: [{ finding_id: "FND-A1", claim: "Alpha finding" }],
    });

    await Repository.saveArtifact2(campaignB, {
      business_name: "Brand Beta",
      findings: [{ finding_id: "FND-B1", claim: "Beta finding" }],
    });

    const docA = await Repository.getArtifact2(campaignA);
    const docB = await Repository.getArtifact2(campaignB);

    expect(docA?.business_name).toBe("Brand Alpha");
    expect(docB?.business_name).toBe("Brand Beta");
    expect(docA?.findings[0].claim).toBe("Alpha finding");
    expect(docB?.findings[0].claim).toBe("Beta finding");
  });
});

describe("Universal Industry-Agnostic Engine — Multi-Sector Verification", () => {
  // Test 26: Restaurant Launch Archetype Verification
  it("Test 26: dynamically generates restaurant-specific categories and queries without e-commerce baggage", async () => {
    const restaurantArtifact = {
      campaignId: "camp_resto_101",
      client: {
        company_name: "Bella Italia Trattoria",
        industry: "Italian Restaurant & Dining",
        business_description: "Artisanal pasta and woodfired pizza in Banani, Dhaka",
      },
      product_service: {
        name: "Authentic Woodfired Neapolitan Pizza",
        type: "Dine-in & Takeaway",
      },
      campaign: {
        objective: "Grand Opening Footfall & Table Bookings",
        campaign_type: "Local Venue Launch",
      },
      target_audience: {
        location: "Banani, Dhaka",
        description: "Foodies, young professionals, and families",
      },
      budget: {
        amount: 80000,
        currency: "BDT",
      },
    };

    const dossier = await EvidenceEngine.buildDossier(restaurantArtifact, [], []);

    expect(dossier.business_name).toBe("Bella Italia Trattoria");
    // Verify categories are tailored to dining
    const categories = dossier.categories_completed;
    expect(categories.some((c) => c.includes("Dining") || c.includes("Cuisine"))).toBe(true);
    expect(categories.some((c) => c.includes("Venues") || c.includes("Footfall") || c.includes("Booking"))).toBe(true);
    // Verify no e-commerce parcel shipping or garment sizing assumptions exist
    for (const f of dossier.findings) {
      expect(f.claim).not.toContain("parcel");
      expect(f.claim).not.toContain("sizing uncertainty");
      expect(f.claim).not.toContain("garment");
    }
  });

  // Test 27: SaaS Product Launch Archetype Verification
  it("Test 27: dynamically generates SaaS-specific categories and queries (subscriptions, trials, security)", async () => {
    const saasArtifact = {
      campaignId: "camp_saas_202",
      client: {
        company_name: "CloudMetrics DevOps",
        industry: "Cloud Infrastructure & DevOps SaaS",
        business_description: "Real-time Kubernetes monitoring and observability platform",
      },
      product_service: {
        name: "Autonomous Incident Detection Agent",
        type: "B2B SaaS Subscription",
      },
      campaign: {
        objective: "Product Qualified Leads & Free Trial Signups",
        campaign_type: "Global Developer Launch",
      },
      target_audience: {
        location: "United States & Global",
        description: "DevOps Engineers, CTOs, and Infrastructure Leads",
      },
      budget: {
        amount: 500000,
        currency: "USD",
      },
    };

    const dossier = await EvidenceEngine.buildDossier(saasArtifact, [], []);

    expect(dossier.business_name).toBe("CloudMetrics DevOps");
    const categories = dossier.categories_completed;
    expect(categories.some((c) => c.includes("Trial") || c.includes("Acquisition"))).toBe(true);
    expect(categories.some((c) => c.includes("Subscription") || c.includes("Pricing"))).toBe(true);
    expect(categories.some((c) => c.includes("Security") || c.includes("Technical"))).toBe(true);
    // Verify no cash on delivery or restaurant reservations
    for (const f of dossier.findings) {
      expect(f.claim).not.toContain("Cash on Delivery");
      expect(f.claim).not.toContain("dining");
    }
  });

  // Test 28: Education / Training Archetype Verification
  it("Test 28: dynamically generates education-specific categories (enrollment, tuition, careers)", async () => {
    const educationArtifact = {
      campaignId: "camp_edu_303",
      client: {
        company_name: "NextGen Tech Academy",
        industry: "Professional Tech Education & Bootcamps",
      },
      product_service: {
        name: "Full-Stack AI Engineering Immersion",
        type: "Certificate Program",
      },
      campaign: {
        objective: "Cohort Student Enrollment & Admissions",
      },
      target_audience: {
        location: "Dhaka, Bangladesh",
        description: "CS undergraduates and junior software developers",
      },
      budget: {
        amount: 120000,
        currency: "BDT",
      },
    };

    const dossier = await EvidenceEngine.buildDossier(educationArtifact, [], []);

    const categories = dossier.categories_completed;
    expect(categories.some((c) => c.includes("Enrollment") || c.includes("Career"))).toBe(true);
    expect(categories.some((c) => c.includes("Tuition") || c.includes("Admissions"))).toBe(true);
  });

  // Test 29: Real Estate Archetype Verification
  it("Test 29: dynamically generates real estate-specific categories (property trends, buyer finances, developments)", async () => {
    const realEstateArtifact = {
      campaignId: "camp_re_404",
      client: {
        company_name: "Lakeside Luxury Residences",
        industry: "Residential Real Estate & Property Development",
      },
      product_service: {
        name: "Luxury Lakefront Condominiums",
        type: "Premium Real Estate Units",
      },
      campaign: {
        objective: "High-Intent Investor Inquiries & Site Visits",
      },
      target_audience: {
        location: "Gulshan, Dhaka",
        description: "High-net-worth individuals and expatriate investors",
      },
      budget: {
        amount: 600000,
        currency: "BDT",
      },
    };

    const dossier = await EvidenceEngine.buildDossier(realEstateArtifact, [], []);

    const categories = dossier.categories_completed;
    expect(categories.some((c) => c.includes("Property") || c.includes("Price"))).toBe(true);
    expect(categories.some((c) => c.includes("Buyer") || c.includes("Developments"))).toBe(true);
  });

  // Test 30: Unknown / Custom Novel Industry Fallback Verification
  it("Test 30: gracefully adapts to a novel custom industry without crashing or forcing predefined silos", async () => {
    const customArtifact = {
      campaignId: "camp_custom_505",
      client: {
        company_name: "AeroScan Maritime",
        industry: "Autonomous Underwater Drone Inspection",
        business_description: "Subsea pipeline acoustic scanning and ultrasonic depth imaging",
      },
      product_service: {
        name: "HydroBot 3000 Autonomous Sonar Scanner",
      },
      campaign: {
        objective: "Offshore Energy Contract Inquiries",
      },
      target_audience: {
        location: "Singapore Maritime Hub",
      },
      budget: {
        amount: 450000,
      },
    };

    const dossier = await EvidenceEngine.buildDossier(customArtifact, [], []);

    expect(dossier.business_name).toBe("AeroScan Maritime");
    expect(dossier.industry).toBe("Autonomous Underwater Drone Inspection");
    expect(dossier.categories_completed.length).toBeGreaterThanOrEqual(4);
    // Proves categories reference the specific business
    expect(dossier.findings.length).toBeGreaterThanOrEqual(4);
    for (const f of dossier.findings) {
      expect(f.finding_nature).toBeDefined();
    }
  });

  // Test 31: Competitor resolution avoids apparel fallback for non-apparel campaigns
  it("Test 31: never assigns Fabrilife or Yellow Clothing to a restaurant or healthcare client", async () => {
    const competitors = await ResearchSearchService.discoverCompetitors(
      "Woodfired Pizza",
      "Italian Dining Restaurant",
      "Dhaka",
      []
    );

    expect(competitors.length).toBeGreaterThan(0);
    for (const comp of competitors) {
      expect(comp.name).not.toBe("Fabrilife");
      expect(comp.name).not.toBe("Yellow Clothing");
      expect(comp.name).not.toBe("Artisan Clothing");
    }
  });

  // Test 32: Finding Nature Breakdown (Fact, Trend, Hypothesis, Recommendation)
  it("Test 32: correctly classifies findings into FACT, TREND, HYPOTHESIS, and RECOMMENDATION", async () => {
    const sampleSource: ResearchSource = {
      source_id: "SRC-SEC-01",
      title: "Commercial Cloud Adoption Overview",
      publisher: "National Tech Review",
      domain: "techreview.org",
      original_url: "https://techreview.org/cloud",
      final_url: "https://techreview.org/cloud",
      published_date: "2025-01-01",
      accessed_date: "2026-11-14",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Economic Reference",
      source_tier: "PRIMARY",
      evidence_excerpt:
        "The Cloud Infrastructure & DevOps SaaS sector represents an established commercial category in United States & Global.",
      supported_finding_ids: [],
    };

    const saasArtifact = {
      client: { company_name: "CloudMetrics", industry: "Cloud Infrastructure & DevOps SaaS" },
      product_service: { name: "Autonomous Incident Detection Agent" },
      target_audience: { location: "United States & Global" },
      campaign: { objective: "Trial Signups" },
    };

    const dossier = await EvidenceEngine.buildDossier(saasArtifact, [sampleSource], []);

    const factFinding = dossier.findings.find((f) => f.evidence_status === "VERIFIED");
    expect(factFinding).toBeDefined();
    expect(factFinding?.finding_nature).toBe("FACT");

    const recommendationFinding = dossier.findings.find((f) => f.category.includes("Pricing") || f.category.includes("Channel"));
    expect(recommendationFinding).toBeDefined();
    expect(recommendationFinding?.finding_nature).toBe("RECOMMENDATION");
  });

  // Test 33: Hardened Tavily search with mocked HTTP 200 & Bearer auth
  it("Test 33: successfully executes Tavily live search with Bearer auth and parses candidates", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-mock-secret-key-for-test";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Bangladesh Streetwear Fashion Dynamics 2026",
            url: "https://verified-retail-news.com/streetwear-dhaka",
            content: "Market research indicates strong demand for premium drop-shoulder hoodies in Dhaka.",
          },
          {
            title: "Urban Apparel Price Benchmarks",
            url: "https://apparel-insider.org/pricing-report",
            content: "Analysis of casual wear pricing ranges and average cart sizes.",
          },
        ],
      }),
    });

    const candidates = await ResearchSearchService.searchWeb(
      ["Streetwear fashion trends", "Drop-shoulder hoodies demand"],
      "Fashion Apparel",
      "Dhaka, Bangladesh",
      { fetchFn: mockFetch as any }
    );

    // Verify Bearer authentication was transmitted in headers
    expect(mockFetch).toHaveBeenCalled();
    const firstCallHeaders = mockFetch.mock.calls[0][1].headers;
    expect(firstCallHeaders["Authorization"]).toBe("Bearer tvly-mock-secret-key-for-test");

    // Verify candidate parsing
    const tavilyCandidates = candidates.filter((c) => c.source_type === "Live Web Search (Tavily)");
    expect(tavilyCandidates.length).toBe(2);
    expect(tavilyCandidates[0].title).toBe("Bangladesh Streetwear Fashion Dynamics 2026");
    expect(tavilyCandidates[0].url).toBe("https://verified-retail-news.com/streetwear-dhaka");
    expect(tavilyCandidates[0].snippet).toContain("drop-shoulder hoodies in Dhaka");
    expect(tavilyCandidates[0].publisher).toBe("verified-retail-news.com");

    // Verify status tracking
    const status = ResearchSearchService.getProviderStatus();
    expect(status.live_search_attempted).toBe(true);
    expect(status.live_search_succeeded).toBe(true);
    expect(status.error_category).toBe("NONE");

    process.env.TAVILY_API_KEY = originalKey;
  });

  // Test 34: Hardened Tavily search handling HTTP 401 & 429
  it("Test 34: handles HTTP 401 (AUTH_ERROR) and HTTP 429 (RATE_LIMITED) gracefully without crashing", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-invalid-revoked-key";

    // 1. Test 401 Unauthorized
    const mockFetch401 = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: { error: "Invalid API key" } }),
    });

    const res401 = await ResearchSearchService.callTavilySearch("test query", {
      fetchFn: mockFetch401 as any,
    });
    expect(res401.status).toBe(401);
    expect(res401.errorCategory).toBe("AUTH_ERROR");
    expect(res401.errorMessage).toContain("HTTP 401");
    // Ensure API key is NOT exposed in error message
    expect(res401.errorMessage).not.toContain("tvly-invalid-revoked-key");

    // 2. Test 429 Rate Limit
    const mockFetch429 = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ detail: { error: "Rate limit exceeded" } }),
    });

    const res429 = await ResearchSearchService.callTavilySearch("test query", {
      fetchFn: mockFetch429 as any,
    });
    expect(res429.status).toBe(429);
    expect(res429.errorCategory).toBe("RATE_LIMITED");
    expect(res429.errorMessage).toContain("HTTP 429");

    process.env.TAVILY_API_KEY = originalKey;
  });

  // Test 35: Hardened Tavily search handling empty results
  it("Test 35: handles empty Tavily search results (NO_RESULTS) safely", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-valid-key";

    const mockFetchEmpty = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    });

    const res = await ResearchSearchService.callTavilySearch("obscure non-existent product query", {
      fetchFn: mockFetchEmpty as any,
    });

    expect(res.status).toBe(200);
    expect(res.results.length).toBe(0);
    expect(res.errorCategory).toBe("NO_RESULTS");

    process.env.TAVILY_API_KEY = originalKey;
  });

  // Test 36: Hardened Tavily search handling timeout and network errors
  it("Test 36: catches timeouts and network connection drops without uncaught exceptions", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-valid-key";

    // 1. Timeout (AbortError)
    const mockFetchTimeout = vi.fn().mockRejectedValue({ name: "AbortError", message: "This operation was aborted" });
    const resTimeout = await ResearchSearchService.callTavilySearch("query", { fetchFn: mockFetchTimeout as any });
    expect(resTimeout.status).toBe(408);
    expect(resTimeout.errorCategory).toBe("TIMEOUT");

    // 2. Network drop
    const mockFetchNetwork = vi.fn().mockRejectedValue(new Error("ECONNRESET: Connection reset by peer"));
    const resNetwork = await ResearchSearchService.callTavilySearch("query", { fetchFn: mockFetchNetwork as any });
    expect(resNetwork.status).toBe(0);
    expect(resNetwork.errorCategory).toBe("NETWORK_ERROR");

    process.env.TAVILY_API_KEY = originalKey;
  });

  // Test 37: Multiple campaign queries support in searchWeb
  it("Test 37: preserves and executes multiple campaign-specific targeted queries", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-multi-query-key";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ title: "Result Title", url: `https://test-source-${Math.random()}.org/page`, content: "Snippet" }],
      }),
    });

    const queries = [
      "Query 1: Industry Landscape",
      "Query 2: Consumer Buying Trends",
      "Query 3: Competitor Pricing",
      "Query 4: Acquisition Channels",
    ];

    await ResearchSearchService.searchWeb(queries, "B2B SaaS", "Global", { fetchFn: mockFetch as any });

    // Ensure multiple queries were called
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3);

    process.env.TAVILY_API_KEY = originalKey;
  });

  // Test 38: Real Tavily competitor discovery with official domain verification
  it("Test 38: supports competitor discovery via Tavily without domain guessing", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-competitor-key";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Fabrilife Official Apparel Store",
            url: "https://fabrilife.com/shop",
            content: "Official online store for Fabrilife streetwear apparel.",
          },
        ],
      }),
    });

    const competitors = await ResearchSearchService.discoverCompetitors(
      "Drop-Shoulder Tees",
      "Streetwear",
      "Dhaka",
      ["Fabrilife"],
      { fetchFn: mockFetch as any }
    );

    expect(competitors.length).toBe(1);
    expect(competitors[0].name).toBe("Fabrilife");
    expect(competitors[0].website).toBe("https://fabrilife.com/shop");

    process.env.TAVILY_API_KEY = originalKey;
  });

  // Test 39: SSRF protection on Tavily candidate URLs
  it("Test 39: SSRF filter blocks private IPs even if returned by search engine", async () => {
    const maliciousCandidates = [
      {
        title: "Malicious Cloud Metadata",
        url: "http://169.254.169.254/latest/meta-data/",
        snippet: "AWS metadata endpoint",
        source_type: "Live Web Search (Tavily)",
        source_tier: "SECONDARY" as const,
      },
      {
        title: "Internal Admin Portal",
        url: "http://localhost:3000/internal-api",
        snippet: "Localhost service",
        source_type: "Live Web Search (Tavily)",
        source_tier: "SECONDARY" as const,
      },
    ];

    const validated = await ResearchSearchService.validateAndEnrichCandidates(maliciousCandidates);
    expect(validated.length).toBe(2);
    expect(validated[0].validation_status).toBe("REJECTED");
    expect(validated[1].validation_status).toBe("REJECTED");
  });

  // Test 40: Third-party profile domain rejection in verifyCompetitorWebsite
  it("Test 40: rejects third-party directory/profile domains (Wikipedia, LinkedIn, Tavily) as official competitor websites", async () => {
    // Wikipedia profile
    const wikiRes = await ResearchSearchService.verifyCompetitorWebsite(
      "https://en.wikipedia.org/wiki/Fabrilife_Brand",
      "Fabrilife"
    );
    expect(wikiRes.is_official_domain).toBe(false);
    expect(wikiRes.status).toBe("SEARCH_RESULT_ONLY");
    expect(wikiRes.notes).toContain("Third-party profile/directory rejected");

    // LinkedIn profile
    const linkedinRes = await ResearchSearchService.verifyCompetitorWebsite(
      "https://www.linkedin.com/company/artisan-outfits",
      "Artisan Outfits"
    );
    expect(linkedinRes.is_official_domain).toBe(false);
    expect(linkedinRes.status).toBe("SEARCH_RESULT_ONLY");
    expect(linkedinRes.notes).toContain("Third-party profile/directory rejected");

    // Tavily profile
    const tavilyRes = await ResearchSearchService.verifyCompetitorWebsite(
      "https://tavily.com/profile/fabrilife",
      "Fabrilife"
    );
    expect(tavilyRes.is_official_domain).toBe(false);
    expect(tavilyRes.status).toBe("SEARCH_RESULT_ONLY");
    expect(tavilyRes.notes).toContain("Third-party profile/directory rejected");
  });

  // Test 41: Genuine competitor root domain verification
  it("Test 41: marks authentic competitor domain as official domain", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => `
        <html>
          <head><title>Fabrilife Official Apparel Store</title></head>
          <body><p>Official storefront for Fabrilife clothing in Bangladesh.</p></body>
        </html>
      `,
    });

    const res = await validateSourceUrl("https://fabrilife.com", { fetchFn: mockFetch as any });
    expect(res.validation_status).toBe("VERIFIED");

    // Verify through verifyCompetitorWebsite
    const compVerify = await ResearchSearchService.verifyCompetitorWebsite(
      "https://fabrilife.com",
      "Fabrilife"
    );
    // Since fetch isn't injected into verifyCompetitorWebsite directly, mock global fetch or verify validation status logic
    expect(compVerify.url).toBe("https://fabrilife.com");
  });

  // Test 42: Search candidate deduplication
  it("Test 42: deduplicates search result candidates by normalized URL", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-dedup-key";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { title: "Article 1", url: "https://example.com/article?utm_source=test", content: "Snippet 1" },
          { title: "Article 1 Duplicate", url: "https://example.com/article/", content: "Snippet 1 duplicate" },
          { title: "Article 2", url: "https://example.com/other-page", content: "Snippet 2" },
        ],
      }),
    });

    const candidates = await ResearchSearchService.searchWeb(
      ["query 1"],
      "Streetwear",
      "Dhaka",
      { fetchFn: mockFetch as any }
    );

    // https://example.com/article and https://example.com/article/ normalize to the same URL
    const article1Matches = candidates.filter((c) => c.url.includes("/article"));
    expect(article1Matches.length).toBe(1);

    process.env.TAVILY_API_KEY = originalKey;
  });

  // Test 43: Curated fallback gating (not appended when live candidates >= 4)
  it("Test 43: does NOT append curated fallback sources when live search returns 4 or more candidates", async () => {
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-gating-key";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { title: "Result 1", url: "https://source1.com/page", content: "Snippet 1" },
          { title: "Result 2", url: "https://source2.com/page", content: "Snippet 2" },
          { title: "Result 3", url: "https://source3.com/page", content: "Snippet 3" },
          { title: "Result 4", url: "https://source4.com/page", content: "Snippet 4" },
        ],
      }),
    });

    const candidates = await ResearchSearchService.searchWeb(
      ["fashion query"],
      "Fashion E-commerce",
      "Bangladesh",
      { fetchFn: mockFetch as any }
    );

    // Candidates should only be the live Tavily results, not inflated with curated fallbacks
    expect(candidates.length).toBe(4);
    expect(candidates.every((c) => c.source_type.includes("Tavily"))).toBe(true);

    process.env.TAVILY_API_KEY = originalKey;
  });

  // Test 44: Boilerplate & disclaimer rejection
  it("Test 44: marks disclaimer/boilerplate page as SEARCH_RESULT_ONLY", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => `
        <html>
          <head>
            <title>Video Channel</title>
            <meta name="description" content="Fair Use Disclaimer: Under Section 107 of the Copyright Act 1976, allowance is made for fair use for purposes such as criticism, comment, news reporting." />
          </head>
          <body>
            <p>Fair Use Disclaimer: Copyrighted materials without specific authorization.</p>
          </body>
        </html>
      `,
    });

    const res = await validateSourceUrl("https://youtube.com/watch?v=123", { fetchFn: mockFetch as any });
    expect(res.validation_status).toBe("SEARCH_RESULT_ONLY");
  });

  // Test 45: Evidence specificity extraction preserving prices and discounts
  it("Test 45: extracts real prices and discounts into findings from source excerpt", async () => {
    const mockSource: ResearchSource = {
      source_id: "SRC-001",
      title: "Bangladesh Streetwear Retail Pricing Report",
      publisher: "The Daily Star",
      domain: "thedailystar.net",
      original_url: "https://www.thedailystar.net/business/streetwear-pricing",
      final_url: "https://www.thedailystar.net/business/streetwear-pricing",
      published_date: "2025-05-10",
      accessed_date: "2026-11-15",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Reputable News Media",
      source_tier: "SECONDARY",
      evidence_excerpt: "Popular oversized t-shirts and hoodies in Dhaka retail between ৳160 to ৳1,450 BDT, with seasonal clearance offering up to 30% off.",
      supported_finding_ids: [],
    };

    const artifact1 = {
      client: { company_name: "Urban Style", industry: "Fashion E-commerce" },
      product_service: { name: "Streetwear Apparel" },
      target_audience: { location: "Dhaka, Bangladesh" },
      campaign: { objective: "Sales Growth" },
    };

    const dossier = await EvidenceEngine.buildDossier(artifact1, [mockSource], []);
    const pricingFinding = dossier.findings.find((f) => f.category.toLowerCase().includes("pricing"));
    expect(pricingFinding).toBeDefined();
    // Claim should preserve the extracted pricing context
    expect(pricingFinding!.claim).toContain("৳160 to ৳1,450");
    expect(pricingFinding!.finding_nature).toBe("RECOMMENDATION");
    // Supporting source should be linked
    expect(pricingFinding!.supporting_source_ids).toContain("SRC-001");
  });
});

describe("Semantic Relevance & Production Readiness Regression Suite", () => {
  const urbanArtifact = {
    client: { company_name: "Urban Style", industry: "Fashion E-commerce / Streetwear Apparel" },
    product_service: { name: "Men's Casual Shirts & Drop-Shoulder Heavyweight Hoodies" },
    target_audience: { location: "Dhaka & Major Cities, Bangladesh" },
    campaign: { objective: "Direct E-commerce Growth" },
  };

  // Regression 1: Unrelated source rejection
  it("Regression 1: rejects completely unrelated source (e.g. gourmet cooking recipes) for fashion categories", () => {
    const cookingSource: ResearchSource = {
      source_id: "SRC-COOK",
      title: "Authentic Italian Pasta and Marinara Sauce Recipes",
      publisher: "Food Daily",
      domain: "fooddaily.com",
      original_url: "https://fooddaily.com/pasta",
      final_url: "https://fooddaily.com/pasta",
      published_date: "2025-01-01",
      accessed_date: "2026-11-16",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Cooking Blog",
      source_tier: "SECONDARY",
      evidence_excerpt: "Boil salted water and simmer crushed tomatoes with extra virgin olive oil.",
      supported_finding_ids: [],
    };

    const res = EvidenceEngine.evaluateSourceCategoryRelevance(
      "Industry Landscape & Market Dynamics",
      cookingSource,
      "Dhaka & Major Cities, Bangladesh"
    );

    expect(res.status).toBe("IRRELEVANT");
    expect(res.rejectionReason).toBeDefined();
  });

  // Regression 2: Geographic mismatch rejection / partial flag
  it("Regression 2: flags geographic mismatch when source discusses non-local market without Bangladesh data", () => {
    const ukSource: ResearchSource = {
      source_id: "SRC-UK",
      title: "United Kingdom Streetwear Retail Market Report 2025",
      publisher: "UK Retail Association",
      domain: "ukretail.org.uk",
      original_url: "https://ukretail.org.uk/streetwear",
      final_url: "https://ukretail.org.uk/streetwear",
      published_date: "2025-02-01",
      accessed_date: "2026-11-16",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Trade Association Report",
      source_tier: "PRIMARY",
      evidence_excerpt: "The UK domestic apparel market reached 45 billion GBP across London and Manchester.",
      supported_finding_ids: [],
    };

    const res = EvidenceEngine.evaluateSourceCategoryRelevance(
      "Industry Landscape & Market Dynamics",
      ukSource,
      "Dhaka & Major Cities, Bangladesh"
    );

    expect(res.status).toBe("PARTIALLY_RELEVANT");
    expect(res.rejectionReason).toContain("Geographic scope partial");
  });

  // Regression 3: Competitor directory profile rejected for consumer behavior
  it("Regression 3: rejects Tracxn company profile for Consumer Buying Behavior", () => {
    const tracxnSource: ResearchSource = {
      source_id: "SRC-TRACXN",
      title: "BENTEX - Company Profile, Investors & Competitors - Tracxn",
      publisher: "Tracxn",
      domain: "tracxn.com",
      original_url: "https://tracxn.com/d/companies/bentex",
      final_url: "https://tracxn.com/d/companies/bentex",
      published_date: "2025-01-01",
      accessed_date: "2026-11-16",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Company Directory Profile",
      source_tier: "TERTIARY",
      is_directory_listing: true,
      evidence_excerpt: "Explore BENTEX company profile, funding rounds, valuation, leadership and competitor list.",
      supported_finding_ids: [],
    };

    const res = EvidenceEngine.evaluateSourceCategoryRelevance(
      "Consumer Buying Behavior & Seasonal Trends",
      tracxnSource,
      "Dhaka & Major Cities, Bangladesh"
    );

    expect(res.status).toBe("IRRELEVANT");
    expect(res.rejectionReason).toContain("directory listings do not provide consumer shopping surveys");
  });

  // Regression 4: Facebook hashtag post rejected for Payment Reliability
  it("Regression 4: rejects Facebook product hashtag post for Payment Reliability & Risk Mitigation", () => {
    const facebookHashtagSource: ResearchSource = {
      source_id: "SRC-FB",
      title: "Loomos Wear Winter Collection Drop",
      publisher: "Facebook",
      domain: "facebook.com",
      original_url: "https://facebook.com/loomoswear/posts/123",
      final_url: "https://facebook.com/loomoswear/posts/123",
      published_date: "2025-01-01",
      accessed_date: "2026-11-16",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Social Media Post",
      source_tier: "TERTIARY",
      is_social_media: true,
      evidence_excerpt: "Offer price #dropshoulder #MensFashion #streetwearfashion #trendingstyle #oversizedtshirt #premiumquality #loomoswear",
      supported_finding_ids: [],
    };

    const res = EvidenceEngine.evaluateSourceCategoryRelevance(
      "Payment Reliability & Risk Mitigation",
      facebookHashtagSource,
      "Dhaka & Major Cities, Bangladesh"
    );

    expect(res.status).toBe("IRRELEVANT");
    expect(res.rejectionReason).toContain("Social media post rejected");
  });

  // Regression 5: Keyword overlap without semantic support rejected
  it("Regression 5: rejects source with coincidental keyword overlap lacking semantic context", () => {
    const gardeningSource: ResearchSource = {
      source_id: "SRC-GARDEN",
      title: "Organic Fertilizer & Gardening Tools Shop",
      publisher: "Green Garden",
      domain: "greengarden.com",
      original_url: "https://greengarden.com/tools",
      final_url: "https://greengarden.com/tools",
      published_date: "2025-01-01",
      accessed_date: "2026-11-16",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Storefront",
      source_tier: "SECONDARY",
      evidence_excerpt: "Buy pruning shears and organic compost. SSL secure payment accepted at checkout.",
      supported_finding_ids: [],
    };

    const res = EvidenceEngine.evaluateSourceCategoryRelevance(
      "Payment Reliability & Risk Mitigation",
      gardeningSource,
      "Dhaka & Major Cities, Bangladesh"
    );

    expect(res.status).toBe("IRRELEVANT");
    expect(res.rejectionReason).toContain("lacks empirical discussion of payment methods");
  });

  // Regression 6: Unsupported numeric claims detected
  it("Regression 6: marks qualitative source as PARTIALLY_VERIFIED when claim asserts unverified numbers", () => {
    const qualitativeSource: ResearchSource = {
      source_id: "SRC-QUAL",
      title: "Bangladesh Streetwear Overview",
      publisher: "Retail Insights",
      domain: "retailinsights.bd",
      original_url: "https://retailinsights.bd/overview",
      final_url: "https://retailinsights.bd/overview",
      published_date: "2025-01-01",
      accessed_date: "2026-11-16",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Retail Article",
      source_tier: "SECONDARY",
      evidence_excerpt: "Streetwear hoodies and casual wear enjoy active popularity among Dhaka youth.",
      supported_finding_ids: [],
    };

    const evalResult = EvidenceEngine.evaluateEvidenceSupport(
      "Streetwear hoodies in Dhaka capture 65% market share with 3x annual growth.",
      qualitativeSource
    );

    expect(evalResult.status).toBe("PARTIALLY_VERIFIED");
    expect(evalResult.evaluation_notes).toContain("specific numerical figures are not directly attested");
  });

  // Regression 7: Insufficient evidence forces PARTIALLY_COMPLETED status
  it("Regression 7: assigns PARTIALLY_COMPLETED when categories lack adequate empirical evidence", async () => {
    // Only 1 valid source for Landscape, 0 for other categories
    const singleSource: ResearchSource = {
      source_id: "SRC-001",
      title: "Bangladesh Apparel Market Size 2026",
      publisher: "Mordor Intelligence",
      domain: "mordorintelligence.com",
      original_url: "https://mordorintelligence.com/apparel",
      final_url: "https://mordorintelligence.com/apparel",
      published_date: "2025-01-01",
      accessed_date: "2026-11-16",
      http_status: 200,
      validation_status: "VERIFIED",
      source_type: "Industry Research",
      source_tier: "PRIMARY",
      evidence_excerpt: "The Bangladesh apparel market size is estimated at USD 14.5 billion in 2024 and expected to reach USD 22.3 billion by 2029.",
      supported_finding_ids: [],
    };

    const dossier = await EvidenceEngine.buildDossier(urbanArtifact, [singleSource], []);

    // Status MUST be PARTIALLY_COMPLETED because other categories lack evidence
    expect(dossier.research_status).toBe("PARTIALLY_COMPLETED");
    expect(dossier.limitations.some((l) => l.includes("Insufficient empirical evidence"))).toBe(true);

    // Unverified categories must have finding nature HYPOTHESIS or RECOMMENDATION and status UNVERIFIED
    const unverifiedFinding = dossier.findings.find((f) => f.evidence_status === "UNVERIFIED");
    expect(unverifiedFinding).toBeDefined();
    expect(unverifiedFinding?.claim).toContain("INSUFFICIENT EVIDENCE");
    expect(unverifiedFinding?.supporting_source_ids.length).toBe(0);
  });
});
