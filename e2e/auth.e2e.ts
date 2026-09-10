import { test, expect } from '@playwright/test';

/**
 * Signing in, in a real browser.
 *
 * This file exists because of a bug that shipped: the session cookie was set
 * `Secure` unconditionally in production, so over plain HTTP — which is how a
 * self-hosted install is usually reached first, on a LAN or a Tailscale
 * address — the browser silently discarded it. Sign-in then looped back to the
 * form with no error, because from the server's point of view nothing had gone
 * wrong.
 *
 * Every test at the time passed. They were written with HTTP clients, and an
 * HTTP client that stores the cookie itself is free to ignore `Secure`, so all
 * of them saw a working sign-in. Only a browser enforces it. So the rule here
 * is: **the authentication path is tested through a browser, never through
 * `request`.** Seeding elsewhere may use HTTP; this may not.
 *
 * The suite's other files run anonymously and assert the visitor's view. These
 * run signed in, and must therefore never assert bare `[data-photo]` counts —
 * owner chrome is part of the page here.
 */

/** Set by `globalSetup` when it rotates the bootstrap password. */
const EMAIL = 'e2e@test.com';
const PASSWORD = 'rotatedpassword123';

/**
 * Fills only once the page is settled, and checks before submitting.
 *
 * The suite failed here perhaps one run in three, always at sign-in and never
 * on a re-run, and it survived two wrong diagnoses — a rate limit, and a
 * machine too busy to answer in five seconds. The page state at the moment of
 * failure gave it away: the **email box was empty**, the password box was full,
 * and there was no error message anywhere. Nothing had been rejected; nothing
 * had been submitted.
 *
 * Filling begins before hydration finishes, and hydration replaces the input —
 * so the first value typed is discarded and the second survives. Waiting for
 * the page to settle and then confirming both boxes still hold what was typed
 * removes the race rather than widening the window it hides in.
 */
async function signIn(page: import('@playwright/test').Page) {
	await page.waitForLoadState('networkidle');

	const email = page.getByLabel('Email');
	const password = page.getByLabel('Password');
	await email.fill(EMAIL);
	await password.fill(PASSWORD);
	await expect(email).toHaveValue(EMAIL);
	await expect(password).toHaveValue(PASSWORD);
	await page.getByRole('button', { name: /sign in/i }).click();
}

test('the footer sign-in link round-trips to the page it was clicked from', async ({ page }) => {
	await page.goto('/c/sierra');
	await page.getByRole('link', { name: /sign in/i }).click();

	// The path it came from rides along, so the artist lands back where they were.
	await expect(page).toHaveURL(/\/login\?next=%2Fc%2Fsierra$/);

	await signIn(page);

	await expect(page).toHaveURL('/c/sierra');
	// The proof the cookie survived: the footer now offers the other direction.
	await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
});

test('a signed-in artist sees the gallery, not a panel', async ({ page }) => {
	await page.goto('/login');
	await signIn(page);

	// Straight back to the artist page — there is no dashboard to land on.
	await expect(page).toHaveURL('/');
	await expect(page.locator('.stack').first()).toBeVisible();
});

test('signing out returns the visitor view', async ({ page }) => {
	await page.goto('/login');
	await signIn(page);
	await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();

	await page.getByRole('button', { name: /sign out/i }).click();

	await expect(page).toHaveURL('/');
	await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
});

test('the session survives a reload', async ({ page }) => {
	await page.goto('/login');
	await signIn(page);
	// Wait for the POST to land before reloading, or the reload cancels it and
	// this measures the login page rather than the session.
	await expect(page).toHaveURL('/');

	await page.reload();

	// A cookie the browser refused to store would look fine until exactly here.
	await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
});

test('a wrong password is rejected with a message, not a silent loop', async ({ page }) => {
	await page.goto('/login');
	await page.waitForLoadState('networkidle');

	const email = page.getByLabel('Email');
	await email.fill(EMAIL);
	await page.getByLabel('Password').fill('not-the-password');
	// The same hydration race as `signIn`: without this the email is sometimes
	// discarded, and the server answers "enter your email and password" — which
	// would make this test pass or fail for the wrong reason either way.
	await expect(email).toHaveValue(EMAIL);

	await page.getByRole('button', { name: /sign in/i }).click();

	await expect(page.getByRole('alert')).toContainText(/incorrect/i);
	// Still on the form, and still anonymous — the failure mode this guards
	// against is a redirect back to the form with nothing said.
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
});
