import { loadEnvConfig } from "@next/env";
import path from "path";

// Load environment exactly as Next.js does
loadEnvConfig(process.cwd());

import { ResearchSearchService } from "../src/lib/research/search-service";
import { validateSourceUrl } from "../src/lib/research/url-validator";

async function verifyLiveTavily() {
  console.log("=== TAVILY LIVE API CONNECTIVITY VERIFICATION ===");

  const keyDetected = Boolean(process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.trim().length > 5);
  console.log(`[1] Environment Detection: TAVILY_API_KEY detected = ${keyDetected}`);

  if (!keyDetected) {
    console.log("[Status] TAVILY_API_KEY not found in process.env.");
    return;
  }

  console.log("[2] Executing controlled real Tavily search request (query: 'Bangladesh digital commerce market')...");
  const startTime = Date.now();
  const searchResponse = await ResearchSearchService.callTavilySearch("Bangladesh digital commerce market", {
    maxResults: 3,
    timeoutMs: 8000,
  });
  const latency = Date.now() - startTime;

  console.log(`[3] Tavily API Response: HTTP ${searchResponse.status} (Latency: ${latency}ms)`);
  console.log(`[4] Authentication Status: ${searchResponse.status === 200 ? "SUCCESS (HTTP 200 OK)" : `FAILED (${searchResponse.errorCategory})`}`);
  console.log(`[5] Results Received: ${searchResponse.results.length}`);

  if (searchResponse.results.length === 0) {
    console.log(`[Status] Zero results returned. Error: ${searchResponse.errorMessage}`);
    return;
  }

  console.log("\n[6] Inspecting Real External Results & Live URL Validation:");
  let validatedCount = 0;
  for (let i = 0; i < searchResponse.results.length; i++) {
    const item = searchResponse.results[i];
    console.log(`\n  --- Result ${i + 1} ---`);
    console.log(`  Title: "${item.title}"`);
    console.log(`  URL: ${item.url}`);
    console.log(`  Content Excerpt (first 120 chars): "${item.content?.slice(0, 120)}..."`);

    // Run existing URL validator (SSRF protection + Live HTTP validation)
    const valResult = await validateSourceUrl(item.url, { timeoutMs: 8000, maxRetries: 1 });
    console.log(`  Validation Status: ${valResult.validation_status} (HTTP ${valResult.http_status})`);
    console.log(`  Final Destination: ${valResult.final_url}`);
    if (valResult.validation_status === "VERIFIED" || valResult.validation_status === "REDIRECTED_AND_VERIFIED") {
      validatedCount++;
    }
  }

  console.log("\n=======================================================");
  console.log(`Summary: ${validatedCount}/${searchResponse.results.length} search URLs successfully passed full live validation.`);
  console.log("=======================================================\n");
}

verifyLiveTavily().catch((err) => {
  console.error("FATAL ERROR IN LIVE VERIFICATION:", err);
  process.exit(1);
});
