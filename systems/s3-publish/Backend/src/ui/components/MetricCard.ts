export interface MetricCardInput {
  label: string;
  value: number | string | null | undefined;
  icon?: string;
  subtext?: string;
  format?: 'number' | 'percentage';
}

export function renderMetricCard({ label, value, icon, subtext, format = 'number' }: MetricCardInput): string {
  let displayValue: string;
  if (typeof value === 'number') {
    if (format === 'percentage') {
      displayValue = `${value.toFixed(2)}%`;
    } else {
      displayValue = value.toLocaleString();
    }
  } else if (value === undefined || value === null) {
    displayValue = '0';
  } else {
    displayValue = String(value);
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
