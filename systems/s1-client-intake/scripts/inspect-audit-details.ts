import fs from "fs";
import path from "path";

const dumpPath = path.resolve(process.cwd(), "scripts/audit-results-dump.json");
const raw = fs.readFileSync(dumpPath, "utf-8");
const campaigns = JSON.parse(raw);

campaigns.forEach((camp: any, idx: number) => {
  console.log(`================================================================================`);
  console.log(`CAMPAIGN ${idx + 1}: ${camp.name}`);
  console.log(`Company: ${camp.company} | Industry: ${camp.industry} | Location: ${camp.location}`);
  console.log(`Campaign ID: ${camp.campaignId} | Client ID: ${camp.clientId}`);
  console.log(`Execution Time: ${camp.durationMs}ms | Research Status: ${camp.dossier.research_status}`);
  console.log(`================================================================================`);

  const profile = camp.dossier.campaign_profile;
  console.log(`\n[1] CAMPAIGN PROFILE & QUERIES:`);
  console.log(`  Archetype / Model Hint: ${profile?.business_model_hint}`);
  console.log(`  Research Depth: ${profile?.research_depth}`);
  console.log(`  Selected Categories (${profile?.selected_categories?.length}):`);
  profile?.selected_categories?.forEach((cat: string, cIdx: number) => {
    console.log(`    - ${cat}`);
  });
  console.log(`  Generated Queries (${profile?.generated_queries?.length}):`);
  profile?.generated_queries?.forEach((q: string, qIdx: number) => {
    console.log(`    ${qIdx + 1}. "${q}"`);
  });

  const sp = camp.dossier.search_provider_status;
  console.log(`\n[2] SEARCH PROVIDER STATUS:`);
  console.log(`  Active Provider: ${sp?.active_provider}`);
  console.log(`  Live Search Available: ${sp?.is_live_search_available}`);
  console.log(`  Missing Credentials: ${sp?.missing_credentials?.join(", ") || "None"}`);
  console.log(`  Provider Notes: ${sp?.provider_notes}`);

  console.log(`\n[3] RETRIEVED SOURCES (${camp.dossier.sources?.length}):`);
  camp.dossier.sources?.forEach((s: any, sIdx: number) => {
    console.log(`  Source ${sIdx + 1} [${s.source_id}]:`);
    console.log(`    Original URL: ${s.original_url}`);
    console.log(`    Final URL: ${s.final_url}`);
    console.log(`    HTTP Status: ${s.http_status}`);
    console.log(`    Validation Status: ${s.validation_status}`);
    console.log(`    Title: ${s.title}`);
    console.log(`    Publisher: ${s.publisher}`);
    console.log(`    Source Tier: ${s.source_tier}`);
    console.log(`    Excerpt: "${s.evidence_excerpt?.slice(0, 300)}..."\n`);
  });

  console.log(`[4] FINDINGS & EVIDENCE VERIFICATION (${camp.dossier.findings?.length}):`);
  camp.dossier.findings?.forEach((f: any, fIdx: number) => {
    console.log(`  Finding ${fIdx + 1} [${f.finding_id}]:`);
    console.log(`    Category: ${f.category}`);
    console.log(`    Claim: "${f.claim}"`);
    console.log(`    Finding Nature: ${f.finding_nature}`);
    console.log(`    Evidence Status: ${f.evidence_status} (Confidence: ${f.confidence})`);
    console.log(`    Supporting Sources: ${f.supporting_source_ids?.join(", ") || "None"}`);
    console.log(`    Evidence Evaluation: ${f.evidence_evaluation}`);
    console.log(`    Evidence Excerpt: "${f.evidence_excerpt?.slice(0, 250)}..."`);
    console.log(`    Limitations: ${f.limitations}\n`);
  });

  console.log(`[5] COMPETITOR RESEARCH (${camp.dossier.competitors?.length}):`);
  camp.dossier.competitors?.forEach((c: any, cIdx: number) => {
    console.log(`  Competitor ${cIdx + 1}: ${c.name}`);
    console.log(`    Website: "${c.website}" (Official Domain: ${c.is_official_domain})`);
    console.log(`    Notes: ${c.notes}`);
    console.log(`    Strengths: ${c.strengths?.join(", ") || "N/A"}`);
    console.log(`    Weaknesses: ${c.weaknesses?.join(", ") || "N/A"}`);
    console.log(`    Positioning: ${c.market_positioning || "N/A"}\n`);
  });

  console.log(`[6] DOSSIER LIMITATIONS & CAVEATS (${camp.dossier.limitations?.length}):`);
  camp.dossier.limitations?.forEach((lim: string, lIdx: number) => {
    console.log(`  - ${lim}`);
  });
  console.log(`\n\n`);
});
