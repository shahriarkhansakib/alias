export function renderPerformanceChart(timelinePoints: any[] = [], activeMetric: string = 'reach'): string {
  const availableMetrics = [
    { key: 'reach', label: 'Reach' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'likes', label: 'Likes' },
    { key: 'comments', label: 'Comments' },
    { key: 'shares', label: 'Shares' },
  ];

  if (!timelinePoints || timelinePoints.length === 0) {
    return `
      <div class="chart-card">
        <div class="chart-header">
          <h3 style="font-size: 1.1rem; font-weight: 600;">Performance Over Time</h3>
        </div>
        <div class="empty-state">
          <div class="state-icon">📈</div>
          <p>No timeline data available for the selected period.</p>
        </div>
      </div>
    `;
  }

  const values = timelinePoints.map((p) => Number(p[activeMetric] || 0));
  const maxVal = Math.max(...values, 1);
  const width = 700;
  const height = 200;
  const padding = 30;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const pointsSvg = timelinePoints.map((p, i) => {
    const val = Number(p[activeMetric] || 0);
    const x = padding + (i / Math.max(timelinePoints.length - 1, 1)) * chartW;
    const y = height - padding - (val / maxVal) * chartH;
    return { x, y, val, date: p.date };
  });

  const pathD = pointsSvg.reduce((acc, pt, i) => {
    return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
  }, '');

  const areaD = `${pathD} L ${pointsSvg[pointsSvg.length - 1].x} ${height - padding} L ${pointsSvg[0].x} ${height - padding} Z`;

  return `
    <div class="chart-card">
      <div class="chart-header">
        <h3 style="font-size: 1.1rem; font-weight: 600;">Performance Over Time</h3>
        <div class="metric-switcher">
          ${availableMetrics
            .map(
              (m) => `
            <button class="metric-btn ${m.key === activeMetric ? 'active' : ''}" data-metric="${m.key}">
              ${m.label}
            </button>
          `
            )
            .join('')}
        </div>
      </div>

      <div class="chart-wrapper">
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%; overflow: visible;">
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0"/>
            </linearGradient>
          </defs>

          <!-- Grid Lines -->
          <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="#273659" stroke-dasharray="3,3"/>
          <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" stroke="#273659" stroke-dasharray="3,3"/>
          <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#273659"/>

          <!-- Area & Line -->
          <path d="${areaD}" fill="url(#chartGradient)"/>
          <path d="${pathD}" fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round"/>

          <!-- Data Points -->
          ${pointsSvg
            .map(
              (pt) => `
            <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#3b82f6" stroke="#0b1329" stroke-width="2">
              <title>${pt.date}: ${pt.val} ${activeMetric}</title>
            </circle>
            <text x="${pt.x}" y="${height - 10}" fill="#64748b" font-size="10" text-anchor="middle">
              ${pt.date.slice(5)}
            </text>
          `
            )
            .join('')}
        </svg>
      </div>
    </div>
  `;
}
