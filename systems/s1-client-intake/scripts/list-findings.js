const d = require('./urban-quality-audit-dump.json');
d.findings.forEach((f, i) => {
  console.log(`[${i+1}] ${f.finding_id} | ${f.category} | Nature: ${f.finding_nature} | Evidence Status: ${f.evidence_status} (${f.confidence})`);
  console.log(`    Claim: "${f.claim}"`);
  console.log(`    Explanation: "${f.explanation}"`);
  console.log(`    Evaluation: "${f.evidence_evaluation}"`);
  console.log(`    Limitations: "${f.limitations}"`);
  console.log(`    Supporting Sources: ${f.supporting_source_ids.join(', ') || 'None'}`);
  console.log(`    Excerpt Mapped: "${(f.evidence_excerpt || '').slice(0, 180)}..."\n`);
});
