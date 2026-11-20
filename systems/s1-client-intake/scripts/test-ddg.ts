async function testDuckDuckGo(query: string) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    console.log("DDG Status:", res.status);
    const html = await res.text();
    console.log("DDG HTML length:", html.length);
    // Extract results
    const regex = /<a[^>]+class="result__snippet"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const urlRegex = /<a[^>]+class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    const results = [];
    // Or check result__title
    const titleRegex = /<a[^>]+class="result__title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let count = 0;
    while ((match = titleRegex.exec(html)) !== null && count < 5) {
      count++;
      results.push({ href: match[1], title: match[2].replace(/<[^>]+>/g, "").trim() });
    }
    console.log("DDG Results count:", results.length, results);
  } catch (err: any) {
    console.error("DDG search failed:", err.message);
  }
}

testDuckDuckGo("Bangladesh fashion apparel brands online market 2025");
