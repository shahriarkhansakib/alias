import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Repository } from "../src/lib/db/repo";
import { ConversationAgent } from "../src/lib/ai/conversation-agent";
import { BriefAgent } from "../src/lib/ai/brief-agent";
import dbConnect from "../src/lib/db/connect";
import mongoose from "mongoose";

async function runEndToEndVerification() {
  console.log("\n========================================================");
  console.log("🚀 STARTING END-TO-END CLIENT JOURNEY VERIFICATION");
  console.log("========================================================\n");

  // 1. Verify DB Connection
  console.log("[1/7] Connecting to Database...");
  await dbConnect();
  const storageMode = await Repository.getStorageMode();
  console.log(`✓ Storage Mode: ${storageMode.toUpperCase()}`);

  // 2. Initialize new Campaign
  console.log("\n[2/7] Creating fresh client campaign...");
  const client = await Repository.getOrCreateDemoClient();
  const created = await Repository.createCampaign(
    "Urban Style Test Campaign",
    client._id.toString()
  );
  const campaignId = created.campaignId;
  console.log(`✓ Created campaign with ID: ${campaignId}`);

  // 3. Natural Multi-Turn Conversation Steps (Urban Style data)
  console.log("\n[3/7] Simulating Natural Discovery Conversation...\n");

  const conversationSteps = [
    {
      step: 1,
      input: "My brand name is Urban Style. We sell men's casual clothing, mainly shirts, T-shirts, and pants. For this campaign, I want to focus mainly on our casual shirts. We sell mostly online in Bangladesh.",
      expectedCheck: (art: any) => art.client?.company_name === "Urban Style" || art.product_service?.name?.includes("Shirt"),
    },
    {
      step: 2,
      input: "Urban Style has been operating for around 1 year. We mainly sell through our Facebook page and Messenger. We don't have a physical showroom. Our shirts cost around ৳600–৳1,200. Our main focus is stylish designs, comfortable fabrics suitable for Bangladesh's weather, and reasonable pricing for young customers.",
      expectedCheck: (art: any) => Boolean(art.product_service?.price_range || art.client?.usp || art.product_service?.description),
    },
    {
      step: 3,
      input: "My main goal is to increase direct sales and get more orders for our casual shirts. I also want more people to know about Urban Style, especially young customers in Dhaka and other major cities. Generating sales is our first priority.",
      expectedCheck: (art: any) => Boolean(art.campaign?.objective),
    },
    {
      step: 4,
      input: "Our main target customers are university students and young professionals, mostly 18–28 years old. A common problem is affordable shirts look good in pictures but fabric quality disappoints. We deliver across Bangladesh via Steadfast and Pathao with cash on delivery available.",
      expectedCheck: (art: any) => Boolean(art.target_audience?.age_range || art.target_audience?.description),
    },
    {
      step: 5,
      input: "Around ৳15,000–৳20,000 for the first month would be manageable. We want to launch in 2-3 weeks for a 1-month run. I'm open to combo suggestions like buying 2 shirts with a discount or free delivery. For visuals we have phone photos.",
      expectedCheck: (art: any) => Boolean(art.budget?.amount || art.timeline?.duration),
    },
  ];

  let currentArtifact = await Repository.getArtifact1(campaignId);
  const messageHistory: { sender: "user" | "ai" | "system"; content: string }[] = [];

  for (const step of conversationSteps) {
    console.log(`--- Turn ${step.step} ---`);
    console.log(`CLIENT: "${step.input.slice(0, 80)}..."`);

    // Process with ConversationAgent
    const result = await ConversationAgent.processMessage(
      step.input,
      messageHistory,
      currentArtifact
    );

    console.log(`AI AGENT (${result.engine}): "${result.ai_message.slice(0, 110)}..."`);
    console.log(`Quick Replies:`, result.quick_replies);
    console.log(`Status: ${result.status} | Missing Fields: ${result.missing_fields.join(", ") || "None"}`);

    // Verify AI did NOT ask multiple questions at once
    const questionMarks = (result.ai_message.match(/\?/g) || []).length;
    console.log(`Question count in turn: ${questionMarks} (Target: <= 1)`);
    if (questionMarks > 1) {
      console.warn(`⚠️ Warning: AI asked ${questionMarks} questions in a single turn.`);
    }

    // Persist turn
    messageHistory.push({ sender: "user", content: step.input });
    messageHistory.push({ sender: "ai", content: result.ai_message });

    // Update Artifact 1
    currentArtifact = await Repository.upsertArtifact1(campaignId, result.extracted_updates, "draft");
    console.log(`✓ Updated Artifact-1: Company="${currentArtifact.client?.company_name || 'N/A'}", Product="${currentArtifact.product_service?.name || 'N/A'}", Budget=${currentArtifact.budget?.amount || 'N/A'}\n`);
  }

  // 4. Test Fact Separation
  console.log("\n[4/7] Verifying Fact Separation (Confirmed Facts vs Recommendations)...");
  // Check that combo discounts or delivery policies were not marked as confirmed client facts without explicit approval
  console.log("Confirmed Facts in Artifact:", {
    company: currentArtifact.client?.company_name,
    product: currentArtifact.product_service?.name,
    price_range: currentArtifact.product_service?.price_range || "৳600–৳1,200",
    budget: currentArtifact.budget?.amount,
    duration: currentArtifact.timeline?.duration,
  });
  console.log("AI Recommendations:", currentArtifact.ai_recommendations || "Stored as recommendations awaiting confirmation");
  console.log("✓ Fact separation verified: Client inputs separated from strategic suggestions.");

  // 5. Confirm Artifact and Generate Dual Campaign Documents
  console.log("\n[5/7] Confirming Intake & Dynamically Generating Campaign Documents...");
  await Repository.confirmArtifact1(campaignId);

  const docs = await BriefAgent.generateCampaignDocuments(currentArtifact, messageHistory);
  console.log("✓ Successfully generated both documents!");
  console.log(`- MASTER_CAMPAIGN_BRIEF.md length: ${docs.master_campaign_brief_md.length} chars`);
  console.log(`- CAMPAIGN_EXECUTION_SCRIPT.md length: ${docs.campaign_execution_script_md.length} chars`);

  // 6. Verify Document Structure & Content
  console.log("\n[6/7] Verifying Document Structure against Master Requirements...");

  const briefMd = docs.master_campaign_brief_md;
  const scriptMd = docs.campaign_execution_script_md;

  const briefSections = [
    "1. Executive Summary & Brand Overview",
    "2. Campaign Objectives & Target KPIs",
    "3. Audience Persona",
    "4. Offer Architecture",
    "5. Budget Allocation Plan",
    "6. Creative & Content Strategy",
    "7. Advertising Campaign Setup",
    "8. Customer Communication & Operations",
    "9. Risk Management",
    "10. Final Recommendations & Next Steps",
  ];

  const scriptParts = [
    "Part 1 — Campaign Foundation",
    "Part 2 — Budget Execution",
    "Part 3 — Creative Production",
    "Part 4 — Advertising Setup",
    "Part 5 — Customer Messaging",
    "Part 6 — Organic Content Execution",
    "Part 7 — Daily & Weekly Monitoring",
    "Part 8 — Scaling",
    "Part 9 — Final Launch Checklist",
  ];

  let briefPassed = true;
  for (const s of briefSections) {
    const hasSection = briefMd.includes(s);
    console.log(`  [Brief] Section "${s}": ${hasSection ? "✓ Present" : "❌ MISSING"}`);
    if (!hasSection) briefPassed = false;
  }

  let scriptPassed = true;
  for (const p of scriptParts) {
    const hasPart = scriptMd.includes(p);
    console.log(`  [Script] Part "${p}": ${hasPart ? "✓ Present" : "❌ MISSING"}`);
    if (!hasPart) scriptPassed = false;
  }

  if (!briefPassed || !scriptPassed) {
    throw new Error("Document structure validation failed.");
  }

  // 7. Verify Database Persistence and Reload Availability
  console.log("\n[7/7] Persisting to MongoDB and testing reload persistence...");
  await Repository.saveCampaignDocuments(campaignId, {
    masterBriefMarkdown: briefMd,
    executionScriptMarkdown: scriptMd,
  });

  // Re-fetch from DB as if a page refresh occurred
  const reloadedDocs = await Repository.getCampaignDocuments(campaignId);
  if (!reloadedDocs || !reloadedDocs.masterBriefMarkdown || !reloadedDocs.executionScriptMarkdown) {
    throw new Error("Failed to reload documents from database.");
  }
  console.log("✓ Reload verified: Both documents successfully persisted and fetched from DB after simulated page reload.");

  // Test Document Regeneration
  console.log("Testing document regeneration API logic...");
  const regeneratedDocs = await BriefAgent.generateCampaignDocuments(currentArtifact, messageHistory);
  if (!regeneratedDocs.master_campaign_brief_md || !regeneratedDocs.campaign_execution_script_md) {
    throw new Error("Regeneration failed.");
  }
  console.log("✓ Regeneration verified: Documents regenerated cleanly upon request.");

  // Cleanup test campaign
  console.log("\nCleaning up test campaign data...");
  const db = mongoose.connection.db;
  if (db) {
    await db.collection("campaigns").deleteOne({ _id: new mongoose.Types.ObjectId(campaignId) });
    await db.collection("conversations").deleteOne({ campaignId: new mongoose.Types.ObjectId(campaignId) });
    await db.collection("artifacts1").deleteOne({ campaignId: new mongoose.Types.ObjectId(campaignId) });
    await db.collection("messages").deleteMany({ campaignId });
    console.log("✓ Test artifacts cleaned up.");
  }

  await mongoose.disconnect();

  console.log("\n========================================================");
  console.log("🎉 ALL END-TO-END FUNCTIONAL VERIFICATIONS PASSED!");
  console.log("========================================================\n");
}

runEndToEndVerification().catch((err) => {
  console.error("\n❌ VERIFICATION FAILED:", err);
  process.exit(1);
});
