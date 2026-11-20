import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import Artifact2 from "../src/models/Artifact2";

async function audit() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const doc = await Artifact2.findOne().sort({ createdAt: -1 });
  if (!doc) {
    console.log("No Artifact2 found");
    return;
  }
  console.log("=== LATEST ARTIFACT2 AUDIT RECORD ===");
  console.log("Campaign ID:", doc.campaignId?.toString());
  console.log("Research Status:", doc.research_status);
  console.log("Business Name:", doc.business_name);
  console.log("Industry:", doc.industry);
  console.log("Total Findings:", doc.findings?.length);
  console.log("Total Sources:", doc.sources?.length);
  console.log("Total Competitors:", doc.competitors?.length);

  console.log("\n================ FINDINGS DETAIL ================");
  for (const f of doc.findings || []) {
    console.log(`\n[${f.finding_id}] Category: ${f.category}`);
    console.log(`  Title: ${f.title}`);
    console.log(`  Claim: ${f.claim}`);
    console.log(`  Supporting Sources: ${JSON.stringify(f.supporting_source_ids)}`);
    console.log(`  Evidence Status: ${f.evidence_status}`);
    console.log(`  Confidence: ${f.confidence}`);
    console.log(`  Evidence Excerpt: "${f.evidence_excerpt?.slice(0, 150)}..."`);
  }

  console.log("\n================ SOURCES DETAIL ================");
  for (const s of doc.sources || []) {
    console.log(`\n[${s.source_id}] Status: ${s.validation_status} (HTTP ${s.http_status})`);
    console.log(`  Title: ${s.title}`);
    console.log(`  Publisher: ${s.publisher}`);
    console.log(`  URL: ${s.final_url || s.original_url}`);
    console.log(`  Supported Findings: ${JSON.stringify(s.supported_finding_ids)}`);
    console.log(`  Excerpt: "${s.evidence_excerpt?.slice(0, 150)}..."`);
  }

  console.log("\n================ COMPETITORS DETAIL ================");
  for (const c of doc.competitors || []) {
    console.log(`\nCompetitor: ${c.name}`);
    console.log(`  Website: ${c.website} (Status: ${c.validation_status})`);
    console.log(`  Products: ${c.products}`);
    console.log(`  Pricing: ${c.pricing}`);
    console.log(`  Positioning: ${c.positioning}`);
    console.log(`  Offers: ${c.offers}`);
    console.log(`  Strengths: ${JSON.stringify(c.strengths)}`);
    console.log(`  Weaknesses: ${JSON.stringify(c.weaknesses)}`);
  }

  await mongoose.disconnect();
}

audit().catch(console.error);
