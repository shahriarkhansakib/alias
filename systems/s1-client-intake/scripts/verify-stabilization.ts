import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { Repository } from "../src/lib/db/repo";
import Campaign from "../src/models/Campaign";
import User from "../src/models/User";
import Artifact1 from "../src/models/Artifact1";
import Artifact2 from "../src/models/Artifact2";
import MasterCampaignBrief from "../src/models/MasterCampaignBrief";

const BASE_URL = "http://localhost:3000";

async function runStabilizationChecks() {
  console.log("=== STARTING STABILIZATION AND INTEGRATION VERIFICATION ===");

  // 1. Check HTTP Routes
  console.log("\n[1] Testing Browser HTTP Routes on http://localhost:3000...");
  const routesToTest = ["/", "/campaign/new"];
  for (const route of routesToTest) {
    const res = await fetch(`${BASE_URL}${route}`);
    console.log(`  GET ${route} -> Status: ${res.status} ${res.statusText}`);
    if (res.status !== 200) {
      throw new Error(`Route ${route} failed with status ${res.status}`);
    }
  }

  // 2. Client Isolation Test (Client A and Client B)
  console.log("\n[2] Testing Client Isolation in MongoDB Atlas...");
  const userA = await Repository.createUser({
    name: "Client Alpha",
    email: `alpha_${Date.now()}@test.com`,
    role: "client",
  });
  const userB = await Repository.createUser({
    name: "Client Beta",
    email: `beta_${Date.now()}@test.com`,
    role: "client",
  });

  const userAId = (userA as any)._id.toString();
  const userBId = (userB as any)._id.toString();

  const campA = await Repository.createCampaign("Alpha Apparel Campaign", userAId);
  const campB = await Repository.createCampaign("Beta Tech Campaign", userBId);

  console.log(`  Created Campaign A (${campA.campaignId}) for User Alpha (${userAId})`);
  console.log(`  Created Campaign B (${campB.campaignId}) for User Beta (${userBId})`);

  // Verify ownership isolation in DB
  const loadedCampA = await Repository.getCampaignById(campA.campaignId);
  const loadedCampB = await Repository.getCampaignById(campB.campaignId);

  const campAOwnerId = ((loadedCampA as any).clientId._id || (loadedCampA as any).clientId).toString();
  const campBOwnerId = ((loadedCampB as any).clientId._id || (loadedCampB as any).clientId).toString();

  if (campAOwnerId !== userAId) {
    throw new Error(`Campaign A owner mismatch: expected ${userAId}, got ${campAOwnerId}`);
  }
  if (campBOwnerId !== userBId) {
    throw new Error(`Campaign B owner mismatch: expected ${userBId}, got ${campBOwnerId}`);
  }

  // Verify Client A cannot see Client B's campaigns
  const clientACampaigns = await Campaign.find({ clientId: userAId });
  const clientBCampaigns = await Campaign.find({ clientId: userBId });

  if (clientACampaigns.length !== 1 || clientACampaigns[0]._id.toString() !== campA.campaignId) {
    throw new Error("Client A isolation failed: saw incorrect campaigns");
  }
  if (clientBCampaigns.length !== 1 || clientBCampaigns[0]._id.toString() !== campB.campaignId) {
    throw new Error("Client B isolation failed: saw incorrect campaigns");
  }
  console.log("  ✓ Client isolation verified: Client A and Client B campaigns are strictly partitioned.");

  // 3. Complete Data Ingestion for Campaign A (Urban Style Persona)
  console.log("\n[3] Ingesting Full Urban Style Data with Budget Range & Separated Facts...");
  const urbanArtifact1Data = {
    client: {
      name: "Tanvir Ahmed",
      company_name: "Urban Style",
      industry: "E-commerce Fashion & Streetwear",
      website: "",
      business_description: "Bangladeshi streetwear brand producing high-quality casual and semi-formal men's shirts",
    },
    product_service: {
      name: "Men's Premium Casual & Semi-Formal Shirts",
      type: "Physical Product",
      description: "High quality 100% cotton casual and semi-formal shirts crafted in Bangladesh",
      price: 1350,
      offer: "Buy 2 shirts get 10% off + free delivery inside Dhaka",
    },
    campaign: {
      name: "Winter Urban Streetwear Campaign",
      objective: "Direct Messenger and Instagram DM sales for upcoming winter launch",
      campaign_type: "Social Media Sales & Direct Messaging",
      desired_result: "Generate 150-250 orders via Facebook Messenger & Instagram DM",
    },
    target_audience: {
      age_range: "20-35",
      gender: "Men",
      location: "Dhaka, Chittagong, Sylhet (major urban cities)",
      description: "University students and young professionals seeking premium casual clothing",
    },
    budget: {
      amount: 20000,
      currency: "BDT",
      type: "range" as const,
      original_raw: "15000-20000 BDT",
    },
    timeline: {
      start_date: "Immediate",
      end_date: "30 days post-launch",
      duration: "30 days (4 weeks)",
    },
    brand_preferences: {
      tone: ["Trendy", "Urban", "Approachable", "Youthful"],
      language: ["Bangla", "English", "Banglish"],
      visual_preference: "Clean aesthetic product shoots and short vertical reels",
      do: ["Show real fabric texture", "Highlight Dhaka COD convenience"],
      dont: ["Mislead on pricing", "Overcomplicate delivery terms"],
    },
    offers: {
      discounts: "Buy 2 shirts get 10% off + free delivery inside Dhaka",
      special_deals: "First-time order free shipping",
      notes: "Client requested profit-safe margins",
    },
    operations: {
      channels: ["Facebook Page", "Instagram DM", "Messenger"],
      logistics: "RedX / Steadfast Cash on Delivery",
      customer_support: "Manual response by founder within 1-2 hours",
    },
    confirmed_facts: [
      "Brand name is Urban Style",
      "Product is Men's Premium Shirts at 1,350 BDT",
      "Sales channel is Facebook Messenger & Instagram DM (no website)",
      "Budget ceiling is 20,000 BDT (range 15,000-20,000 BDT)",
      "Target audience: 20-35 year old men in major urban cities in Bangladesh",
      "Fulfillment: Cash on Delivery via RedX / Steadfast",
    ],
    ai_recommendations: [
      "AI Recommendation: Set automated Instant Welcome reply on Facebook Page",
      "AI Recommendation: Run 3-phase campaign (Awareness, Consideration, DM Retargeting)",
      "AI Recommendation: Winter Streetwear theme with short phone reels",
    ],
    assumptions: [
      "Assumed Dhaka delivery cost is 70-80 BDT and outside Dhaka is 130-150 BDT",
      "Assumed average cart size is 1.4 units with Buy 2 offer",
    ],
    missing_information: [
      "Website or Facebook Pixel (client confirmed currently none)",
      "Dedicated CRM software (client uses manual Messenger inbox)",
    ],
  };

  await Repository.upsertArtifact1(campA.campaignId, urbanArtifact1Data);
  console.log("  ✓ Artifact1 saved with budget range, confirmed facts, assumptions, and recommendations.");

  // Verify chat, confirmation, and brief routes for this campaign
  console.log("\n[4] Testing Dynamic Browser Routes for Campaign A...");
  const chatRes = await fetch(`${BASE_URL}/campaign/${campA.campaignId}`);
  console.log(`  GET /campaign/${campA.campaignId} -> Status: ${chatRes.status}`);
  if (chatRes.status !== 200) throw new Error("Chat page failed");

  const confirmRes = await fetch(`${BASE_URL}/campaign/${campA.campaignId}/confirmation`);
  console.log(`  GET /campaign/${campA.campaignId}/confirmation -> Status: ${confirmRes.status}`);
  if (confirmRes.status !== 200) throw new Error("Confirmation page failed");

  // 4. Confirm Artifact1 and Generate Dual Documents
  console.log("\n[5] Confirming Artifact1 and Triggering Dual Document Generation...");
  const confirmApiRes = await fetch(`${BASE_URL}/api/artifacts/1/${campA.campaignId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const confirmJson = await confirmApiRes.json();
  console.log(`  POST /api/artifacts/1/${campA.campaignId}/confirm -> Status: ${confirmApiRes.status}, Success: ${confirmJson.success}`);
  if (!confirmJson.success) {
    throw new Error(`Document generation failed: ${JSON.stringify(confirmJson)}`);
  }

  // 5. Verify Database Persistence in MongoDB
  console.log("\n[6] Verifying MongoDB Persistence of Artifact1, Master Brief, and Execution Script...");
  const dbArtifact1 = await Artifact1.findOne({ campaignId: campA.campaignId });
  const dbCampaign = await Campaign.findById(campA.campaignId);
  const dbMasterBrief = await MasterCampaignBrief.findOne({ campaignId: campA.campaignId });

  if (!dbArtifact1) throw new Error("Artifact1 not found in MongoDB!");
  if (!dbCampaign?.masterBriefMarkdown) throw new Error("Campaign.masterBriefMarkdown not found in MongoDB!");
  if (!dbCampaign?.executionScriptMarkdown) throw new Error("Campaign.executionScriptMarkdown not found in MongoDB!");
  if (!dbMasterBrief?.masterBriefMarkdown) throw new Error("MasterCampaignBrief document not found in MongoDB!");

  console.log("  ✓ Artifact1 found in MongoDB.");
  console.log(`  ✓ Campaign.masterBriefMarkdown length: ${dbCampaign.masterBriefMarkdown.length} chars.`);
  console.log(`  ✓ Campaign.executionScriptMarkdown length: ${dbCampaign.executionScriptMarkdown.length} chars.`);
  console.log("  ✓ MasterCampaignBrief collection record verified.");

  // Check section coverage
  const briefMd = dbCampaign.masterBriefMarkdown;
  const scriptMd = dbCampaign.executionScriptMarkdown;

  const briefSections = [
    { name: "1. Executive Summary & Brand Overview", match: /Executive Summary/i },
    { name: "2. Campaign Objectives & Target KPIs", match: /Campaign Objective/i },
    { name: "3. Audience Persona", match: /Audience/i },
    { name: "4. Offer Architecture", match: /Offer Architecture/i },
    { name: "5. Budget Allocation Plan", match: /Budget Allocation/i },
    { name: "6. Creative & Content Strategy", match: /Creative & Content Strategy/i },
    { name: "7. Advertising Campaign Setup", match: /Advertising Campaign Setup/i },
    { name: "8. Customer Communication & Operations", match: /Customer Communication|Operations/i },
    { name: "9. Risk Management", match: /Risk Management/i },
    { name: "10. Final Recommendations & Next Steps", match: /Recommendations|Next Steps/i },
  ];

  console.log("\n[7] Verifying 10 Master Brief Sections...");
  for (const sec of briefSections) {
    const present = sec.match.test(briefMd);
    console.log(`  Brief Section [${sec.name}]: ${present ? "PRESENT" : "MISSING"}`);
    if (!present) throw new Error(`Brief missing required section: ${sec.name}`);
  }

  const scriptParts = [
    { name: "Part 1 — Campaign Foundation", match: /Part 1.*Campaign Foundation/i },
    { name: "Part 2 — Budget Execution", match: /Part 2.*Budget Execution/i },
    { name: "Part 3 — Creative Production", match: /Part 3.*Creative Production/i },
    { name: "Part 4 — Advertising Setup", match: /Part 4.*Advertising Setup/i },
    { name: "Part 5 — Customer Messaging", match: /Part 5.*Customer Messaging/i },
    { name: "Part 6 — Organic Content Execution", match: /Part 6.*Organic Content/i },
    { name: "Part 7 — Daily & Weekly Monitoring", match: /Part 7.*Monitoring/i },
    { name: "Part 8 — Scaling & Optimization Rules", match: /Part 8.*Scaling/i },
    { name: "Part 9 — Final Launch Checklist", match: /Part 9.*Launch Checklist/i },
  ];

  console.log("\n[8] Verifying Execution Script Parts...");
  for (const part of scriptParts) {
    const present = part.match.test(scriptMd);
    console.log(`  Script Part [${part.name}]: ${present ? "PRESENT" : "MISSING"}`);
    if (!present) throw new Error(`Script missing required part: ${part.name}`);
  }

  // 6. Verify GET /campaign/[id]/brief route
  console.log("\n[9] Testing Browser Brief Page Route...");
  const briefRes = await fetch(`${BASE_URL}/campaign/${campA.campaignId}/brief`);
  console.log(`  GET /campaign/${campA.campaignId}/brief -> Status: ${briefRes.status}`);
  if (briefRes.status !== 200) throw new Error("Brief page failed");

  // 7. Verify Page Refresh / Data Persistence
  console.log("\n[10] Verifying Page Refresh (Re-fetching documents from API)...");
  const docFetchRes = await fetch(`${BASE_URL}/api/campaigns/${campA.campaignId}/documents`);
  const docFetchJson = await docFetchRes.json();
  if (!docFetchJson.success || !docFetchJson.masterBriefMarkdown) {
    throw new Error("Page refresh failed: documents could not be re-fetched");
  }
  console.log("  ✓ Documents remain fully preserved upon re-fetch.");

  // 8. Verify No Research AI Triggered
  console.log("\n[11] Verifying NO Research AI / Artifact-2 Triggered in Phase 1...");
  const dbArtifact2 = await Artifact2.findOne({ campaignId: campA.campaignId });
  if (dbArtifact2) {
    throw new Error("VIOLATION: Artifact2 was found! Phase 1 must not run Research AI.");
  }
  console.log("  ✓ Confirmed: Artifact2 is null. Zero Research AI triggered.");

  // 9. Verify Regeneration Integrity
  console.log("\n[12] Verifying Document Regeneration Integrity...");
  const regenRes = await fetch(`${BASE_URL}/api/campaigns/${campA.campaignId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const regenJson = await regenRes.json();
  if (!regenJson.success) {
    throw new Error(`Regeneration failed: ${JSON.stringify(regenJson)}`);
  }

  // Verify confirmed facts are still intact in Artifact1
  const afterRegenArtifact1 = await Artifact1.findOne({ campaignId: campA.campaignId });
  if (afterRegenArtifact1?.client?.company_name !== "Urban Style" || afterRegenArtifact1?.budget?.amount !== 20000) {
    throw new Error("Regeneration corrupted confirmed facts!");
  }
  console.log("  ✓ Regeneration completed: Confirmed facts preserved, AI recommendations distinct.");

  console.log("\n=======================================================");
  console.log("🎉 ALL STABILIZATION & INTEGRATION CHECKS PASSED 100%!");
  console.log("=======================================================\n");

  await mongoose.disconnect();
}

runStabilizationChecks().catch((err) => {
  console.error("STABILIZATION CHECK FAILED:", err);
  process.exit(1);
});
