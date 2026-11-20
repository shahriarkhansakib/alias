export function renderMetricCard({ label, value, icon, subtext, format = 'number' }) {
  let displayValue = value;
  if (typeof value === 'number') {
    if (format === 'percentage') {
      displayValue = `${value.toFixed(2)}%`;
    } else {
      displayValue = value.toLocaleString();
    }
  } else if (value === undefined || value === null) {
    displayValue = '0';
  }

  return `
    <div class="metric-card" id="metric-card-${label.toLowerCase().replace(/\s+/g, '-')}">
      <div class="metric-card-header">
        <span class="metric-label">${label}</span>
        <span class="metric-icon">${icon || '📊'}</span>
      </div>
      <div class="metric-value">${displayValue}</div>
      ${subtext ? `<div class="metric-subtext">${subtext}</div>` : ''}
    </div>
  `;
}
