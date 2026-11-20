/**
 * Known user-agent substrings for link-preview bots and social crawlers.
 * These crawlers preload links to generate preview cards (title, og:image, snippet).
 * They must still receive the HTTP redirect, but their requests are filtered out from
 * eligible human click metrics.
 *
 * NOTE: Bot detection is heuristic-based and not claimed to be 100% exhaustive.
 */
const KNOWN_BOT_PATTERNS = [
  // Meta / Facebook
  'facebookexternalhit',
  'facebot',
  'meta-externalagent',
  'meta-externalfetcher',
  // Twitter / X
  'twitterbot',
  // LinkedIn
  'linkedinbot',
  // WhatsApp
  'whatsapp',
  // Slack
  'slackbot',
  'slack-imgproxy',
  // Messaging & Discord
  'telegrambot',
  'discordbot',
  'skypeuripreview',
  // Search engines & generic scrapers
  'googlebot',
  'bingbot',
  'applebot',
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'criteo',
  'headlesschrome',
  'phantomjs',
];

export function isLinkPreviewBot(userAgent?: string): boolean {
  if (!userAgent || typeof userAgent !== 'string' || !userAgent.trim()) {
    return false;
  }

  const lower = userAgent.toLowerCase();
  for (const pattern of KNOWN_BOT_PATTERNS) {
    if (lower.includes(pattern)) {
      return true;
    }
  }

  return false;
}
