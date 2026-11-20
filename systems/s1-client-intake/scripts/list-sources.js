const d = require('./urban-quality-audit-dump.json');
d.sources.forEach((s, i) => {
  console.log(`[${i+1}] ${s.source_id} | HTTP ${s.http_status} [${s.validation_status}] | Tier: ${s.source_tier} | Type: ${s.source_type}`);
  console.log(`    Title: "${s.title.slice(0, 70)}"`);
  console.log(`    Domain: ${s.domain} (${s.publisher})`);
  console.log(`    Original URL: ${s.original_url}`);
  console.log(`    Final URL: ${s.final_url}`);
  console.log(`    Excerpt Length: ${s.evidence_excerpt ? s.evidence_excerpt.length : 0} chars`);
  console.log(`    Snippet: "${(s.evidence_excerpt || '').slice(0, 140)}..."\n`);
});
