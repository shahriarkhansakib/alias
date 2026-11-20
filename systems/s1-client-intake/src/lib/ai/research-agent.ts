import { ResearchSearchService } from "@/lib/research/search-service";
import { EvidenceEngine } from "@/lib/research/evidence-engine";
import { CampaignContextAnalyzer } from "@/lib/research/campaign-analyzer";
import { ResearchDossier } from "@/lib/research/types";

export const ResearchAgent = {
  /**
   * Conducts universal, industry-agnostic external market research dynamically
   * based on the actual intake facts collected in Artifact 1.
   * Completely eliminates hardcoded fashion/apparel assumptions.
   */
  async conductResearch(artifact1: any): Promise<ResearchDossier> {
    // 1. Analyze campaign facts dynamically
    const context = CampaignContextAnalyzer.analyze(artifact1);
    console.log(
      `[ResearchAgent] Universal Research initiated for "${context.businessName}" in ${context.industry} (${context.location}). Depth: ${context.depth}, Categories: ${context.categories.length}`
    );

    // 2. Dynamic Web Search across campaign-specific targeted queries
    const candidates = await ResearchSearchService.searchWeb(
      context.searchQueries,
      context.industry,
      context.location
    );

    console.log(`[ResearchAgent] Retrieved ${candidates.length} search candidates across ${context.searchQueries.length} targeted queries.`);

    // 3. Validate URLs via HTTP GET, follow redirects, extract metadata and verify against SSRF
    const validatedSources = await ResearchSearchService.validateAndEnrichCandidates(candidates);

    const verifiedCount = validatedSources.filter(
      (s) => s.validation_status === "VERIFIED" || s.validation_status === "REDIRECTED_AND_VERIFIED"
    ).length;

    console.log(
      `[ResearchAgent] URL Validation completed. Verified: ${verifiedCount}/${validatedSources.length}`
    );

    // 4. Assemble Verified Competitors (Universal Resolution - Never hardcoded to apparel)
    const competitorRefs: string[] = Array.isArray(artifact1.client?.competitor_references)
      ? artifact1.client.competitor_references
      : [];

    const competitorsToVerify = await ResearchSearchService.discoverCompetitors(
      context.productName,
      context.industry,
      context.location,
      competitorRefs
    );

    // 5. Evidence Engine: Synthesize Findings, Link Evidence & Derive Completion Status
    const dossier = await EvidenceEngine.buildDossier(artifact1, validatedSources, competitorsToVerify);

    console.log(
      `[ResearchAgent] Universal Research Dossier compiled. Status: ${dossier.research_status}, Findings: ${dossier.findings.length}, Sources: ${dossier.sources.length}`
    );

    return dossier;
  },
};
