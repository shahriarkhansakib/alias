/**
 * The three Alias systems, reached through the single gateway on this app's own origin
 * (see next.config.ts rewrites and src/proxy.ts). No other port is ever shown to users.
 */

export interface AliasSystem {
  id: 's1' | 's2' | 's3';
  step: string;
  name: string;
  summary: string;
  points: string[];
}

export interface AdminSystemLink {
  id: string;
  system: string;
  name: string;
  description: string;
  href: string;
}

/** Where a client starts a conversation with Alias (System 1 client chat). */
export const CLIENT_CHAT_HREF = '/intake/campaign/new';

export function getAliasSystems(): AliasSystem[] {
  return [
    {
      id: 's1',
      step: 'System 1',
      name: 'Client intake & brief',
      summary:
        'An AI consultant chats with the client, pulls out the facts and asks only for what is missing. An operator confirms the brief.',
      points: [
        'Chat-based intake, no long forms',
        'Operator console with AI-drafted replies',
        'Locked, versioned campaign brief',
      ],
    },
    {
      id: 's2',
      step: 'System 2',
      name: 'Ad creative studio',
      summary:
        'Agents turn the confirmed brief into campaign angles, copy and finished ads for each platform.',
      points: [
        'Real product photo, never regenerated',
        'Claims and prices locked to confirmed facts',
        'Automatic size, contrast and layout checks',
      ],
    },
    {
      id: 's3',
      step: 'System 3',
      name: 'Publish & measure',
      summary: "Approved ads are published to the client's Facebook page and tracked post by post.",
      points: [
        'Publishing through Zernio',
        'Reach, engagement and click analytics',
        'Every post ID mapped and stored',
      ],
    },
  ];
}

export function getAdminSystemLinks(): AdminSystemLink[] {
  return [
    {
      id: 's1-campaigns',
      system: 'System 1',
      name: 'Campaigns & briefs',
      description: 'Review intake campaigns and confirm Artifact-1 briefs.',
      href: '/intake/admin',
    },
    {
      id: 's1-inbox',
      system: 'System 1',
      name: 'Client inbox',
      description: 'Live client conversations with AI-drafted replies.',
      href: '/intake/admin/communication',
    },
    {
      id: 's2-studio',
      system: 'System 2',
      name: 'Creative studio',
      description: 'Turn a brief into angles, copy and finished ads.',
      href: '/studio',
    },
    {
      id: 's3-publish',
      system: 'System 3',
      name: 'Publishing & analytics',
      description: 'Publish approved ads and track their results.',
      href: '/publish',
    },
  ];
}
