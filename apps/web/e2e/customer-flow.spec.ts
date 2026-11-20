import { expect, test } from '@playwright/test';
import { resetDatabaseForE2e } from './helpers/db';
import { waitForVerificationLink } from './helpers/mailpit';

test.describe('Customer landing, registration, Mailpit verification & dashboard boundaries', () => {
  test.beforeAll(() => {
    resetDatabaseForE2e();
  });

  test('enforces landing page hygiene, password toggles, back navigation, Mailpit verification, and customer-only isolation', async ({
    page,
  }) => {
    const email = `customer-${Date.now()}@example.com`;
    const password = 'CustomerPassword123!';

    // 1. Landing page hygiene for guests
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();
    await expect(page.getByText(/Customer Dashboard/i)).toHaveCount(0);
    await expect(page.getByText(/Platform Admin/i)).toHaveCount(0);

    // 2. ← Back to home and password eye toggle work on /login
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);

    const loginPasswordInput = page.getByLabel('Password', { exact: true });
    const loginPasswordToggle = page.getByTestId('login-password-toggle');
    await loginPasswordInput.fill(password);
    await expect(loginPasswordInput).toHaveAttribute('type', 'password');
    await expect(loginPasswordToggle).toHaveAttribute('aria-pressed', 'false');
    await loginPasswordToggle.click();
    await expect(loginPasswordInput).toHaveAttribute('type', 'text');
    await expect(loginPasswordToggle).toHaveAttribute('aria-pressed', 'true');
    await loginPasswordToggle.click();
    await expect(loginPasswordInput).toHaveAttribute('type', 'password');

    await page.getByRole('link', { name: '← Back to home' }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole('link', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/register$/);
    await page.getByRole('link', { name: '← Back to home' }).click();
    await expect(page).toHaveURL(/\/$/);

    // 3. Register customer (verifying password eye toggle on /register) and verify via Mailpit
    await page.getByRole('link', { name: 'Create account' }).click();
    await page.getByLabel('Full name').fill('Customer E2E');
    await page.getByLabel('Email address').fill(email);

    const registerPasswordInput = page.getByLabel('Password', { exact: true });
    const registerPasswordToggle = page.getByTestId('register-password-toggle');
    await registerPasswordInput.fill(password);
    await expect(registerPasswordInput).toHaveAttribute('type', 'password');
    await registerPasswordToggle.click();
    await expect(registerPasswordInput).toHaveAttribute('type', 'text');
    await registerPasswordToggle.click();
    await expect(registerPasswordInput).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Check your email')).toBeVisible();

    const verificationUrl = await waitForVerificationLink(email);
    await page.goto(verificationUrl);

    // 4. Lands on blank /dashboard with user email & Sign out button only
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('dashboard-user-email')).toHaveText(email);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByTestId('customer-workspace-placeholder')).toBeVisible();
    await expect(page.getByRole('button', { name: /create tenant|create office/i })).toHaveCount(0);

    // 5. Authenticated landing page shows a single Continue to workspace CTA
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Continue to workspace' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);

    // 6. Customer cannot access /admin or /api/v1/platform/status
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/dashboard$/);

    const platformStatusResponse = await page.request.get('/api/v1/platform/status');
    expect(platformStatusResponse.status()).toBe(403);
  });
});
