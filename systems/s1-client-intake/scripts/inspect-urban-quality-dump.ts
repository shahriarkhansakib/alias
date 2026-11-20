import fs from "fs";
import path from "path";

const dumpPath = path.resolve(process.cwd(), "scripts/urban-quality-audit-dump.json");
const dossier = JSON.parse(fs.readFileSync(dumpPath, "utf-8"));

console.log("================================================================================");
console.log("            DETAILED AUDIT INSPECTION OF URBAN STYLE RESEARCH DOSSIER           ");
console.log("================================================================================\n");

console.log("Provider Status:", dossier.search_provider_status);
console.log("Research Status:", dossier.research_status);
console.log("Stats:", dossier.stats);

console.log("\n================================================================================");
console.log(`1. ALL SOURCES AUDIT (Total: ${dossier.sources.length})`);
console.log("================================================================================");

dossier.sources.forEach((s: any, idx: number) => {
  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`SOURCE [${idx + 1}] ID: ${s.source_id}`);
  console.log(`Title: "${s.title}"`);
  console.log(`Publisher: ${s.publisher} | Domain: ${s.domain}`);
  console.log(`Source Type: ${s.source_type} | Tier: ${s.source_tier}`);
  console.log(`Original URL: ${s.original_url}`);
  console.log(`Final URL: ${s.final_url}`);
  console.log(`HTTP Status: ${s.http_status} | Validation: ${s.validation_status}`);
  console.log(`Redirect Chain: ${JSON.stringify(s.redirect_chain)}`);
  console.log(`Content Excerpt Length: ${s.evidence_excerpt?.length || 0} characters`);
  console.log(`Content Excerpt Sample: "${s.evidence_excerpt?.slice(0, 250)}..."`);
  console.log(`Supported Findings: ${s.supported_finding_ids?.join(", ") || "None"}`);
});

console.log("\n================================================================================");
console.log(`2. ALL FINDINGS AUDIT (Total: ${dossier.findings.length})`);
console.log("================================================================================");

dossier.findings.forEach((f: any, idx: number) => {
  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`FINDING [${idx + 1}] ID: ${f.finding_id}`);
  console.log(`Category: ${f.category}`);
  console.log(`Nature: ${f.finding_nature} | Evidence Status: ${f.evidence_status} | Confidence: ${f.confidence}`);
  console.log(`Claim: "${f.claim}"`);
  console.log(`Explanation: "${f.explanation}"`);
  console.log(`Evaluation: "${f.evidence_evaluation}"`);
  console.log(`Limitations: "${f.limitations}"`);
  console.log(`Supporting Source IDs: ${f.supporting_source_ids?.join(", ") || "None"}`);
  console.log(`Evidence Excerpt Mapped: "${f.evidence_excerpt?.slice(0, 250)}..."`);
});

console.log("\n================================================================================");
console.log(`3. ALL COMPETITORS AUDIT (Total: ${dossier.competitors.length})`);
console.log("================================================================================");

dossier.competitors.forEach((c: any, idx: number) => {
  console.log(`\nCompetitor [${idx + 1}]: ${c.name}`);
  console.log(`Website: "${c.website}" (Official Domain: ${c.is_official_domain})`);
  console.log(`Validation Status: ${c.validation_status}`);
  console.log(`Notes: ${c.notes || "None"}`);
  console.log(`Strengths: ${c.strengths?.join(", ") || "None"}`);
  console.log(`Weaknesses: ${c.weaknesses?.join(", ") || "None"}`);
});
