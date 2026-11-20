export interface AliasSystem {
  id: 's1' | 's2' | 's3';
  step: string;
  name: string;
  summary: string;
  points: string[];
  url: string;
}

/**
 * The three Alias systems run as separate apps (see systems/README.md).
 * Override their addresses with ALIAS_S1_URL, ALIAS_S2_URL and ALIAS_S3_URL.
 */
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
      url: process.env.ALIAS_S1_URL ?? 'http://localhost:3005',
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
      url: process.env.ALIAS_S2_URL ?? 'http://localhost:3001',
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
      url: process.env.ALIAS_S3_URL ?? 'http://localhost:5173',
    },
  ];
}
