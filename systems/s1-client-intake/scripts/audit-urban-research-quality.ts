import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { ResearchAgent } from "../src/lib/ai/research-agent";
import fs from "fs";
import path from "path";

async function runUrbanAudit() {
  console.log("=== EXECUTING URBAN STYLE RESEARCH FOR QUALITY AUDIT ===");

  const artifact1 = {
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
      name: "Men's Casual Shirts & Drop-Shoulder Heavyweight Hoodies",
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
  };

  const dossier = await ResearchAgent.conductResearch(artifact1);

  const outPath = path.resolve(process.cwd(), "scripts/urban-quality-audit-dump.json");
  fs.writeFileSync(outPath, JSON.stringify(dossier, null, 2));
  console.log(`\nAudit dossier saved to: ${outPath}`);

  console.log(`Total Sources: ${dossier.sources.length}`);
  console.log(`Total Findings: ${dossier.findings.length}`);
  console.log(`Competitors: ${dossier.competitors.length}`);
}

runUrbanAudit().catch((err) => {
  console.error(err);
  process.exit(1);
});
