import { expect, type Page, test } from '@playwright/test';
import { bootstrapSuperAdminForE2e, resetDatabaseForE2e } from './helpers/db';
import { waitForVerificationLink } from './helpers/mailpit';
import { generateTotpCode } from './helpers/totp';

test.describe('Environment-aware Platform 2FA lifecycle, password toggles & guarded toggle', () => {
  test.beforeAll(() => {
    resetDatabaseForE2e();
  });

  async function registerAndVerifyUser(page: Page, name: string, email: string, password: string) {
    await page.goto('/register');
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Check your email')).toBeVisible();

    const verificationUrl = await waitForVerificationLink(email);
    await page.goto(verificationUrl);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
  }

  test('runs full dev lifecycle: default OFF, self-lockout guard, personal 2FA setup, toggle ON/OFF, sub-admin gating & 2FA login', async ({
    browser,
    page,
  }) => {
    const suffix = Date.now();
    const superAdminEmail = `super-${suffix}@example.com`;
    const superAdminPassword = 'SuperAdminPassword123!';
    const subAdminEmail = `sub-${suffix}@example.com`;
    const subAdminPassword = 'SubAdminPassword123!';

    // 1. Register and verify super_admin and sub_admin candidates
    await registerAndVerifyUser(page, 'Root Admin', superAdminEmail, superAdminPassword);
    await registerAndVerifyUser(page, 'Sub Admin', subAdminEmail, subAdminPassword);
    bootstrapSuperAdminForE2e(superAdminEmail);

    // 2. In development, /admin opens directly with platform 2FA OFF by default
    await page.goto('/login');
    await page.getByLabel('Email address').fill(superAdminEmail);
    await page.getByLabel('Password', { exact: true }).fill(superAdminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await expect(page.getByRole('heading', { name: 'Platform status' })).toBeVisible();
    await expect(page.getByTestId('platform-mfa-policy-status')).toHaveText('Optional (OFF)');
    await expect(page.getByTestId('platform-mfa-off-warning')).toBeVisible();

    // 3. Provision sub_admin while policy is OFF
    await page.getByLabel('Verified user email').fill(subAdminEmail);
    await page.getByLabel('Reason (optional)').fill('E2E Sub Admin');
    await page.getByRole('button', { name: 'Provision platform admin' }).click();
    await expect(page.getByText(`Provisioned ${subAdminEmail} as platform_admin.`)).toBeVisible();

    // 4. Attempting to toggle platform 2FA ON without personal 2FA is blocked cleanly
    await page.getByTestId('toggle-platform-mfa-btn').click();
    await expect(page.getByTestId('platform-security-error')).toHaveText(
      'Enable and verify your own 2FA authenticator before turning on the platform-wide 2FA requirement',
    );

    // 5. Enroll personal TOTP inside /admin (and test password eye toggle)
    const personalEnableInput = page.getByLabel('Confirm password to set up personal 2FA', {
      exact: true,
    });
    const personalEnableToggle = page.getByTestId('personal-mfa-enable-password-toggle');
    await personalEnableInput.fill(superAdminPassword);
    await expect(personalEnableInput).toHaveAttribute('type', 'password');
    await personalEnableToggle.click();
    await expect(personalEnableInput).toHaveAttribute('type', 'text');
    await personalEnableToggle.click();
    await expect(personalEnableInput).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Set up personal 2FA' }).click();

    const personalSecretEl = page.getByTestId('personal-totp-secret');
    await expect(personalSecretEl).toBeVisible();
    await expect(page.getByTestId('personal-totp-uri')).toContainText('otpauth://totp/');
    await expect(page.getByTestId('personal-backup-codes')).toBeVisible();

    const base32Secret = (await personalSecretEl.textContent())?.trim() ?? '';
    expect(base32Secret.length).toBeGreaterThan(8);

    await page
      .getByLabel('Enter 6-digit code from your authenticator')
      .fill(generateTotpCode(base32Secret));
    await page.getByRole('button', { name: 'Verify & enable personal 2FA' }).click();

    await expect(page.getByTestId('personal-mfa-status')).toHaveText('Enabled');

    // While policy is OFF, disable form is available and its password eye toggle works
    const disableInput = page.getByLabel('Confirm password to disable personal 2FA', {
      exact: true,
    });
    const disableToggle = page.getByTestId('personal-mfa-disable-password-toggle');
    await expect(disableInput).toBeVisible();
    await disableInput.fill('check-visibility');
    await disableToggle.click();
    await expect(disableInput).toHaveAttribute('type', 'text');
    await disableToggle.click();
    await expect(disableInput).toHaveAttribute('type', 'password');

    // 6. Toggle platform 2FA ON -> status becomes Required (ON) and disable form is hidden
    await page.getByTestId('toggle-platform-mfa-btn').click();
    await expect(page.getByTestId('platform-mfa-policy-status')).toHaveText('Required (ON)');
    await expect(page.getByTestId('personal-mfa-locked-note')).toBeVisible();
    await expect(disableInput).toHaveCount(0);

    // 7. Un-enrolled sub_admin signs in on a separate context -> hits /admin MFA enrollment gate
    const subContext = await browser.newContext();
    const subPage = await subContext.newPage();
    try {
      await subPage.goto('/login');
      await subPage.getByLabel('Email address').fill(subAdminEmail);
      await subPage.getByLabel('Password', { exact: true }).fill(subAdminPassword);
      await subPage.getByRole('button', { name: 'Sign in' }).click();

      await expect(subPage).toHaveURL(/\/admin$/);
      await expect(
        subPage.getByRole('heading', { name: 'Multi-factor authentication required' }),
      ).toBeVisible();

      // Verify password eye toggle works on the MFA enrollment gate
      const gatePasswordInput = subPage.getByLabel(
        'Confirm your password to generate TOTP credentials',
        { exact: true },
      );
      const gatePasswordToggle = subPage.getByTestId('mfa-enable-password-toggle');
      await gatePasswordInput.fill(subAdminPassword);
      await expect(gatePasswordInput).toHaveAttribute('type', 'password');
      await gatePasswordToggle.click();
      await expect(gatePasswordInput).toHaveAttribute('type', 'text');
      await gatePasswordToggle.click();
      await expect(gatePasswordInput).toHaveAttribute('type', 'password');

      // 8. super_admin signs out, completes 2FA login, and toggles policy OFF
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/$/);

      await page.goto('/login');
      await page.getByLabel('Email address').fill(superAdminEmail);
      await page.getByLabel('Password', { exact: true }).fill(superAdminPassword);
      await page.getByRole('button', { name: 'Sign in' }).click();

      await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
      await page.getByLabel('6-digit authenticator code').fill(generateTotpCode(base32Secret));
      await page.getByRole('button', { name: 'Verify and continue' }).click();

      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByTestId('platform-mfa-policy-status')).toHaveText('Required (ON)');

      await page.getByTestId('toggle-platform-mfa-btn').click();
      await expect(page.getByTestId('platform-mfa-policy-status')).toHaveText('Optional (OFF)');

      // 9. Sub-admin reloads /admin -> enters console without MFA gate, no toggle button shown
      await subPage.reload();
      await expect(subPage.getByRole('heading', { name: 'Platform status' })).toBeVisible();
      await expect(subPage.getByTestId('platform-mfa-policy-status')).toHaveText('Optional (OFF)');
      await expect(subPage.getByTestId('platform-mfa-readonly-note')).toBeVisible();
      await expect(subPage.getByTestId('toggle-platform-mfa-btn')).toHaveCount(0);
    } finally {
      await subContext.close();
    }
  });
});
