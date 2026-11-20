import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import mongoose from "mongoose";
import dbConnect from "../src/lib/db/connect";
import Campaign from "../src/models/Campaign";
import Artifact2 from "../src/models/Artifact2";
import Artifact1 from "../src/models/Artifact1";
import fs from "fs";
import path from "path";

async function inspectUrbanCampaigns() {
  await dbConnect();

  const campaigns = await Campaign.find({ name: /Urban/i }).sort({ createdAt: -1 });
  console.log(`Found ${campaigns.length} Urban Style campaigns in MongoDB:`);

  const dump: any[] = [];

  for (let i = 0; i < campaigns.length; i++) {
    const c = campaigns[i];
    console.log(`\n[${i + 1}] Campaign ID: ${c._id} | Name: ${c.name} | CreatedAt: ${c.createdAt}`);
    const a1 = await Artifact1.findOne({ campaignId: c._id });
    const a2 = await Artifact2.findOne({ campaignId: c._id });

    console.log(`  Artifact1 present: ${Boolean(a1)}`);
    console.log(`  Artifact2 present: ${Boolean(a2)}`);
    if (a2) {
      console.log(`    Status: ${a2.research_status}`);
      console.log(`    Active Provider: ${a2.search_provider_status?.active_provider}`);
      console.log(`    Live Search Succeeded: ${a2.search_provider_status?.live_search_succeeded}`);
      console.log(`    Total Sources: ${a2.sources?.length}`);
      console.log(`    Total Findings: ${a2.findings?.length}`);
      console.log(`    Competitors: ${a2.competitors?.length}`);
      dump.push({
        campaign: { id: c._id, name: c.name, status: c.status, createdAt: c.createdAt },
        artifact1: a1,
        artifact2: a2,
      });
    }
  }

  // Also check if there's any Artifact2 with business_name "Urban Style"
  const a2ByBiz = await Artifact2.find({ business_name: /Urban/i }).sort({ updatedAt: -1 });
  console.log(`\nArtifact2 records by business_name /Urban/: ${a2ByBiz.length}`);
  for (const a of a2ByBiz) {
    if (!dump.some((d) => d.artifact2._id.toString() === a._id.toString())) {
      console.log(`Additional Artifact2 found: ID: ${a._id}, CampaignId: ${a.campaignId}`);
      dump.push({
        campaign: { id: a.campaignId, name: a.business_name },
        artifact2: a,
      });
    }
  }

  const outPath = path.resolve(process.cwd(), "scripts/urban-audit-dump.json");
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(`\nSaved Urban campaign database records to: ${outPath}`);

  await mongoose.disconnect();
}

inspectUrbanCampaigns().catch((err) => {
  console.error(err);
  process.exit(1);
});
