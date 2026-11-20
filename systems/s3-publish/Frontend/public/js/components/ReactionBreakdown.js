export function renderReactionBreakdown(reactionBreakdown, totalLikes = 0) {
  const reactionList = [
    { key: 'like', name: 'Like', emoji: '👍' },
    { key: 'love', name: 'Love', emoji: '❤️' },
    { key: 'haha', name: 'Haha', emoji: '😆' },
    { key: 'wow', name: 'Wow', emoji: '😮' },
    { key: 'sad', name: 'Sad', emoji: '😢' },
    { key: 'angry', name: 'Angry', emoji: '😡' },
  ];

  const hasIndividualData =
    reactionBreakdown !== null &&
    reactionBreakdown !== undefined &&
    typeof reactionBreakdown === 'object';

  return `
    <div style="margin-top: 1.5rem; border-top: 1px solid var(--border-color); padding-top: 1.25rem;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h4 style="font-size: 0.95rem; font-weight: 600; color: var(--text-main);">Facebook Reaction Breakdown</h4>
        <span style="font-size: 0.85rem; color: var(--accent-primary); font-weight: 600;">Total Likes: ${totalLikes}</span>
      </div>

      <div class="reactions-grid">
        ${reactionList
          .map((r) => {
            const count = hasIndividualData && typeof reactionBreakdown[r.key] === 'number'
              ? reactionBreakdown[r.key]
              : 'N/A';
            return `
              <div class="reaction-card">
                <div class="reaction-emoji">${r.emoji}</div>
                <div class="reaction-name">${r.name}</div>
                <div class="reaction-count" style="${count === 'N/A' ? 'color: var(--text-dim); font-size: 0.75rem;' : ''}">${count}</div>
              </div>
            `;
          })
          .join('')}
      </div>

      ${
        !hasIndividualData
          ? `<p class="reaction-unsupported-note">ℹ️ Individual reaction type breakdown is not provided by the current Zernio analytics provider API. Total reactions are tracked above via Likes.</p>`
          : ''
      }
    </div>
  `;
}
