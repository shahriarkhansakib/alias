export function renderAnalyticsFilters(currentFilters = {}) {
  const selectedPlatform = currentFilters.platform || 'all';
  const fromDate = currentFilters.fromDate || '';
  const toDate = currentFilters.toDate || '';

  return `
    <div class="dashboard-controls" id="analytics-filters">
      <select id="filter-platform" class="filter-select">
        <option value="all" ${selectedPlatform === 'all' ? 'selected' : ''}>All Platforms</option>
        <option value="facebook" ${selectedPlatform === 'facebook' ? 'selected' : ''}>Facebook</option>
        <option value="instagram" ${selectedPlatform === 'instagram' ? 'selected' : ''}>Instagram (Ready)</option>
        <option value="linkedin" ${selectedPlatform === 'linkedin' ? 'selected' : ''}>LinkedIn (Ready)</option>
        <option value="x" ${selectedPlatform === 'x' ? 'selected' : ''}>X / Twitter (Ready)</option>
      </select>

      <input type="date" id="filter-from-date" class="filter-input" value="${fromDate}" title="From Date">
      <input type="date" id="filter-to-date" class="filter-input" value="${toDate}" title="To Date">

      <button id="btn-apply-filters" class="btn-icon">
        🔍 Filter
      </button>
      <button id="btn-reset-filters" class="btn-icon" style="background-color: transparent;">
        🔄 Reset
      </button>
      <button id="btn-refresh-dashboard" class="btn-icon" style="border-color: var(--accent-primary); color: var(--accent-primary);">
        ⚡ Refresh Analytics
      </button>
    </div>
  `;
}
