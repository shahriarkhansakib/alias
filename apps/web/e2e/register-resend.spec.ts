import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'ResendPassword123!';

function getMailpitUrl(): string {
  return (process.env.MAILPIT_API_URL ?? 'http://127.0.0.1:8025').replace(/\/+$/, '');
}

/** Number of messages Mailpit holds for this recipient. */
async function countMessagesTo(email: string): Promise<number> {
  const response = await fetch(
    `${getMailpitUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  );
  const payload = (await response.json()) as { messages_count: number };
  return payload.messages_count;
}

/** Registers a new user with the page clock installed, so the resend cooldown can be skipped. */
async function register(page: Page, email: string): Promise<void> {
  await page.clock.install();
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Resend E2E');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
}

test.describe('Register: check your email and send again', () => {
  test.describe('happy paths', () => {
    test('sends another verification email after the cooldown', async ({ page }) => {
      const email = `resend-${Date.now()}@example.com`;
      await register(page, email);
      await expect.poll(() => countMessagesTo(email)).toBe(1);

      await page.clock.runFor(30_000);
      await page.getByRole('button', { name: 'Send again', exact: true }).click();

      await expect(page.getByText('We sent another link.')).toBeVisible();
      await expect.poll(() => countMessagesTo(email)).toBe(2);
    });
  });

  test.describe('edge cases', () => {
    test('disables "Send again" during the cooldown and counts down', async ({ page }) => {
      await register(page, `resend-cooldown-${Date.now()}@example.com`);

      const button = page.getByRole('button', { name: /^Send again/ });
      await expect(button).toBeDisabled();
      await expect(button).toHaveText('Send again (available in 30 s)');

      await page.clock.runFor(10_000);
      await expect(button).toHaveText('Send again (available in 20 s)');
      await expect(button).toBeDisabled();

      await page.clock.runFor(20_000);
      await expect(button).toHaveText('Send again');
      await expect(button).toBeEnabled();
    });
  });

  test.describe('error cases', () => {
    test('shows a retry message when the resend request fails', async ({ page }) => {
      await register(page, `resend-error-${Date.now()}@example.com`);
      await page.route('**/api/auth/send-verification-email', (route) =>
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Too many requests' }),
        }),
      );

      await page.clock.runFor(30_000);
      await page.getByRole('button', { name: 'Send again', exact: true }).click();

      await expect(
        page.getByText('We could not send another link right now. Please try again in a moment.'),
      ).toBeVisible();
      await expect(page.getByText('Check your email')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Send again/ })).toBeDisabled();
    });
  });
});
