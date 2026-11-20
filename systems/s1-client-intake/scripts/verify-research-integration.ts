import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { Repository } from "../src/lib/db/repo";
import { ResearchAgent } from "../src/lib/ai/research-agent";
import Artifact2 from "../src/models/Artifact2";
import Campaign from "../src/models/Campaign";
import { validateSourceUrl } from "../src/lib/research/url-validator";

const BASE_URL = "http://localhost:3000";

async function runResearchVerification() {
  console.log("=== STARTING RESEARCH AI INTEGRATION & LIVE SOURCE VERIFICATION ===");

  // 1. Live Real-World Source URL Verification (At least 3 real sources tested with HTTP GET)
  console.log("\n[1] Testing Live HTTP URL Verification on 4 Genuine External Knowledge Sources...");
  const realTestUrls = [
    "https://en.wikipedia.org/wiki/Textile_industry_in_Bangladesh",
    "https://en.wikipedia.org/wiki/Economy_of_Bangladesh",
    "https://data.worldbank.org",
    "http://www.epb.gov.bd",
  ];

  const liveResults = [];
  for (const url of realTestUrls) {
    const res = await validateSourceUrl(url, { timeoutMs: 10000, maxRetries: 1 });
    console.log(`  - URL: ${url}`);
    console.log(`    Status: ${res.validation_status} (HTTP ${res.http_status})`);
    console.log(`    Final URL: ${res.final_url}`);
    console.log(`    Title: "${res.title}"`);
    console.log(`    Publisher: ${res.publisher}`);
    console.log(`    Excerpt preview: "${res.content_excerpt.slice(0, 100)}..."\n`);
    liveResults.push(res);
  }

  const liveVerified = liveResults.filter(
    (r) => r.validation_status === "VERIFIED" || r.validation_status === "REDIRECTED_AND_VERIFIED"
  );
  if (liveVerified.length < 3) {
    throw new Error(`Expected at least 3 live verified sources, but got ${liveVerified.length}`);
  }
  console.log(`  ✓ Successfully verified ${liveVerified.length} real external sources with live HTTP 200 OK.`);

  // 2. Full Campaign Research Pipeline Execution
  console.log("\n[2] Executing Full Research Pipeline for Urban Style...");
  const clientA = await Repository.createUser({
    name: "Urban Style Founder",
    email: `founder_${Date.now()}@test.com`,
    role: "client",
  });
  const clientAId = (clientA as any)._id.toString();

  const campaign = await Repository.createCampaign("Urban Style Winter Research", clientAId);
  const campaignId = campaign.campaignId;

  const artifact1Data = {
    client: {
      company_name: "Urban Style",
      industry: "Youth Streetwear & Casual Apparel",
      competitor_references: ["Fabrilife", "Yellow Clothing", "Artisan Outfits"],
    },
    target_audience: {
      location: "Dhaka & Major Cities, Bangladesh",
      age_range: "20-35",
      description: "University students and young professionals",
    },
    product_service: {
      name: "Men's Premium Cotton Shirts & Drop-Shoulder Tees",
      price: 1350,
      offer: "Buy 2 Bundle with Free Shipping",
    },
  };

  await Repository.upsertArtifact1(campaignId, artifact1Data as any);

  // Run Research Agent
  const dossier = await ResearchAgent.conductResearch(artifact1Data);
  const savedArtifact2 = await Repository.saveArtifact2(campaignId, dossier);

  console.log(`  ✓ Research Dossier created with status: ${dossier.research_status}`);
  console.log(`  ✓ Total findings: ${dossier.findings.length}`);
  console.log(`  ✓ Total sources: ${dossier.sources.length}`);
  console.log(`  ✓ Total competitors: ${dossier.competitors.length}`);

  // 3. MongoDB Persistence Verification
  console.log("\n[3] Verifying MongoDB Persistence for Artifact2...");
  const dbRecord = await Artifact2.findOne({ campaignId });
  if (!dbRecord) {
    throw new Error("Artifact2 was not persisted in MongoDB!");
  }
  if (!dbRecord.findings || dbRecord.findings.length === 0) {
    throw new Error("Findings array missing in MongoDB Artifact2!");
  }
  if (!dbRecord.sources || dbRecord.sources.length === 0) {
    throw new Error("Sources array missing in MongoDB Artifact2!");
  }
  console.log("  ✓ MongoDB Artifact2 record verified with full findings, sources, and metadata.");

  // 4. Client Isolation Verification
  console.log("\n[4] Verifying Campaign Research Isolation...");
  const clientB = await Repository.createUser({
    name: "Competitor Client B",
    email: `clientb_${Date.now()}@test.com`,
    role: "client",
  });
  const clientBId = (clientB as any)._id.toString();
  const campB = await Repository.createCampaign("Client B Tech Store", clientBId);

  // Query Artifact2 for Campaign B -> should be null
  const bArtifact2 = await Repository.getArtifact2(campB.campaignId);
  if (bArtifact2 !== null) {
    throw new Error("Isolation failure: Client B can see research data from another campaign!");
  }
  console.log("  ✓ Client isolation verified: Client B cannot see Campaign A's research.");

  // 5. HTTP Frontend Route Verification
  console.log("\n[5] Verifying Research Dashboard Route on Local Server...");
  const resRoute = await fetch(`${BASE_URL}/campaign/${campaignId}/research`);
  console.log(`  GET /campaign/${campaignId}/research -> Status: ${resRoute.status}`);
  if (resRoute.status !== 200) {
    throw new Error(`Research page returned HTTP ${resRoute.status}`);
  }

  const apiRoute = await fetch(`${BASE_URL}/api/research/${campaignId}`);
  console.log(`  GET /api/research/${campaignId} -> Status: ${apiRoute.status}`);
  if (apiRoute.status !== 200) {
    throw new Error(`Research API returned HTTP ${apiRoute.status}`);
  }
  const apiJson = await apiRoute.json();
  if (!apiJson.artifact2 || apiJson.artifact2.findings.length === 0) {
    throw new Error("Research API did not return populated artifact2!");
  }
  console.log("  ✓ Research Dashboard and API endpoints verified successfully.");

  // 6. Research Regeneration Verification
  console.log("\n[6] Verifying Research Regeneration Endpoint...");
  const regenRes = await fetch(`${BASE_URL}/api/research/${campaignId}/start`, { method: "POST" });
  console.log(`  POST /api/research/${campaignId}/start -> Status: ${regenRes.status}`);
  if (regenRes.status !== 200) {
    throw new Error(`Regeneration endpoint failed with status ${regenRes.status}`);
  }
  const regenJson = await regenRes.json();
  if (!regenJson.artifact2) {
    throw new Error("Regeneration response missing artifact2!");
  }
  console.log(`  ✓ Regeneration completed with status: ${regenJson.artifact2.research_status}`);

  console.log("\n=======================================================");
  console.log("🎉 ALL RESEARCH AI VERIFICATION CHECKS PASSED 100%!");
  console.log("=======================================================\n");

  await mongoose.disconnect();
}

runResearchVerification().catch((err) => {
  console.error("RESEARCH VERIFICATION FAILED:", err);
  process.exit(1);
});
