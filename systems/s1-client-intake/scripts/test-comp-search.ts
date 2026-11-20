import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { ResearchSearchService } from "../src/lib/research/search-service";

async function testComp() {
  for (const name of ["Fabrilife", "Yellow Clothing", "Artisan Outfits"]) {
    const query = `"${name}" official website store Bangladesh -site:wikipedia.org -site:tavily.com`;
    const res = await ResearchSearchService.callTavilySearch(query, { maxResults: 5 });
    console.log(`\nCompetitor: ${name}`);
    res.results.forEach((r, i) => console.log(`  [${i + 1}] ${r.title} -> ${r.url}`));
  }
}

testComp().catch(console.error);
