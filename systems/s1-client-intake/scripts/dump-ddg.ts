import fs from "fs";

async function dumpDDG() {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent("Bangladesh fashion apparel brands")}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const html = await res.text();
  fs.writeFileSync("scripts/ddg_sample.html", html);
  console.log("Saved ddg_sample.html, length:", html.length);
}

dumpDDG();
