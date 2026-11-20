import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { Repository } from "../src/lib/db/repo";
import { ResearchAgent } from "../src/lib/ai/research-agent";
import Artifact2 from "../src/models/Artifact2";
import Campaign from "../src/models/Campaign";
import { ResearchDossier } from "../src/lib/research/types";

interface AuditCampaignInput {
  name: string;
  clientName: string;
  email: string;
  artifact1: any;
}

const auditCampaigns: AuditCampaignInput[] = [
  {
    name: "Urban Style Winter Streetwear Launch",
    clientName: "Urban Style Founder",
    email: `urban_founder_${Date.now()}@urbanstyle.com`,
    artifact1: {
      client: {
        company_name: "Urban Style",
        industry: "Fashion E-commerce / Streetwear Apparel",
        competitor_references: ["Fabrilife", "Yellow Clothing", "Artisan Outfits"],
      },
      target_audience: {
        location: "Dhaka & Major Cities, Bangladesh",
        age_range: "18-35",
        description: "University students and urban young professionals seeking modern streetwear",
      },
      product_service: {
        name: "Drop-Shoulder Streetwear T-shirts & Heavyweight Fleece Hoodies",
        price: 1450,
        offer: "Winter Drop 2026: Buy 2 Get Free Express Delivery Across Bangladesh",
      },
      campaign_goals: {
        primary_goal: "Drive direct-to-consumer e-commerce sales and brand awareness",
        kpi: "2,000 orders within 30 days",
      },
      budget_and_timeline: {
        budget: "50,000 BDT",
        duration: "30 days",
      },
    },
  },
  {
    name: "Bella Italia Banani Grand Opening",
    clientName: "Luigi Rossi & Tariq Ahmed",
    email: `bella_owner_${Date.now()}@bellaitalia-dhaka.com`,
    artifact1: {
      client: {
        company_name: "Bella Italia Trattoria",
        industry: "Food & Beverage / Restaurant & Hospitality",
        competitor_references: ["Prego at Westin", "Spaghetti Jazz", "Pizza Guy"],
      },
      target_audience: {
        location: "Banani, Gulshan & Baridhara, Dhaka, Bangladesh",
        age_range: "22-50",
        description: "Affluent food enthusiasts, families, and young professionals looking for authentic Italian dining",
      },
      product_service: {
        name: "Wood-fired Neapolitan Pizza, Handmade Tagliatelle, & Tiramisu",
        price: 1200,
        offer: "Grand Opening Week: 15% discount on advance table reservations",
      },
      campaign_goals: {
        primary_goal: "Build local footfall, buzz, and fill table reservations during grand opening month",
        kpi: "350 table reservations in first 21 days",
      },
      budget_and_timeline: {
        budget: "75,000 BDT",
        duration: "21 days",
      },
    },
  },
  {
    name: "CloudPulse AI Kubernetes Observability Launch",
    clientName: "CloudPulse Systems Inc.",
    email: `vp_marketing_${Date.now()}@cloudpulse.io`,
    artifact1: {
      client: {
        company_name: "CloudPulse AI",
        industry: "B2B SaaS / DevOps & Cloud Infrastructure Observability",
        competitor_references: ["Datadog", "Dynatrace", "New Relic"],
      },
      target_audience: {
        location: "North America, Western Europe, and Global Tech Hubs",
        age_range: "25-50",
        description: "DevOps Engineers, Site Reliability Engineers (SREs), and Engineering Directors managing Kubernetes clusters",
      },
      product_service: {
        name: "Autonomous Kubernetes Incident Detection & Root-Cause Analysis Platform",
        price: 299,
        offer: "14-Day Full-Access Enterprise Free Trial + Guided Kubernetes Cluster Audit",
      },
      campaign_goals: {
        primary_goal: "Drive Product Qualified Leads (PQLs) and enterprise free trial activations",
        kpi: "500 verified developer signups with at least 1 connected cluster",
      },
      budget_and_timeline: {
        budget: "$15,000 USD",
        duration: "60 days",
      },
    },
  },
];

async function runRealWorldAudit() {
  console.log("================================================================================");
  console.log("       STARTING REAL-WORLD RESEARCH AI VALIDATION ACROSS 3 CAMPAIGNS            ");
  console.log("================================================================================\n");

  const results: any[] = [];
  const clientIds: string[] = [];
  const campaignIds: string[] = [];

  for (let i = 0; i < auditCampaigns.length; i++) {
    const item = auditCampaigns[i];
    console.log(`\n================================================================================`);
    console.log(`CAMPAIGN ${i + 1}: ${item.name}`);
    console.log(`Client: ${item.artifact1.client.company_name} | Industry: ${item.artifact1.client.industry}`);
    console.log(`================================================================================`);

    // 1. Create client and campaign
    const client = await Repository.createUser({
      name: item.clientName,
      email: item.email,
      role: "client",
    });
    const clientId = (client as any)._id.toString();
    clientIds.push(clientId);

    const camp = await Repository.createCampaign(item.name, clientId);
    const campaignId = camp.campaignId;
    campaignIds.push(campaignId);

    console.log(`[Campaign Setup] Client ID: ${clientId} | Campaign ID: ${campaignId}`);

    // 2. Upsert Artifact 1
    await Repository.upsertArtifact1(campaignId, item.artifact1);
    console.log(`[Artifact 1] Upserted intake configuration for ${item.artifact1.client.company_name}`);

    // 3. Execute Research Workflow
    const startTime = Date.now();
    console.log(`[Execution] Invoking ResearchAgent.conductResearch()...`);
    const dossier: ResearchDossier = await ResearchAgent.conductResearch(item.artifact1);
    const durationMs = Date.now() - startTime;
    console.log(`[Execution] Completed in ${durationMs}ms with status: ${dossier.research_status}`);

    // 4. Save to Repository
    const saved = await Repository.saveArtifact2(campaignId, dossier);
    console.log(`[Persistence] Saved Artifact2 version ${saved.version} to database.`);

    // 5. Structure data for detailed inspection
    results.push({
      campaignIndex: i + 1,
      name: item.name,
      clientId,
      campaignId,
      company: item.artifact1.client.company_name,
      industry: item.artifact1.client.industry,
      location: item.artifact1.target_audience.location,
      durationMs,
      dossier,
    });
  }

  // 6. Test Campaign Isolation
  console.log("\n================================================================================");
  console.log("                  CAMPAIGN ISOLATION AUDIT ACROSS ALL 3 CLIENTS                 ");
  console.log("================================================================================");

  let isolationPassed = true;
  for (let i = 0; i < campaignIds.length; i++) {
    const myClientId = clientIds[i];
    const myCampaignId = campaignIds[i];

    // Client's campaigns in DB
    const myCampaigns = await Campaign.find({ clientId: myClientId });
    const myCampaignIds = myCampaigns.map((c) => c._id.toString());

    if (!myCampaignIds.includes(myCampaignId)) {
      console.error(`❌ Self-ownership error: Client ${i + 1} does not own their own campaign!`);
      isolationPassed = false;
    }

    // Ensure client cannot see any other campaign
    for (let j = 0; j < campaignIds.length; j++) {
      if (i === j) continue;
      const otherCampaignId = campaignIds[j];
      if (myCampaignIds.includes(otherCampaignId)) {
        console.error(`❌ ISOLATION VIOLATION: Client ${i + 1} owns Campaign ${j + 1}`);
        isolationPassed = false;
      } else {
        console.log(`✓ Isolation verified: Client ${i + 1} has zero access to Campaign ${j + 1} (${auditCampaigns[j].name})`);
      }
    }
  }

  // Save audit data to a local file for in-depth inspection
  const auditDumpPath = path.resolve(process.cwd(), "scripts/audit-results-dump.json");
  fs.writeFileSync(auditDumpPath, JSON.stringify(results, null, 2));
  console.log(`\nFull audit data saved to: ${auditDumpPath}`);

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB.");
}

runRealWorldAudit().catch((err) => {
  console.error("FATAL AUDIT ERROR:", err);
  process.exit(1);
});
