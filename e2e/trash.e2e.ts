import { test, expect } from '@playwright/test';

const EMAIL = 'e2e@test.com';
const PASSWORD = 'rotatedpassword123';

async function signIn(page: import('@playwright/test').Page) {
	await page.goto('/login');
	/**
	 * Filled only once the page is settled, and checked before submitting.
	 *
	 * This suite failed here perhaps one run in three, always at sign-in and
	 * never on a re-run, and it survived two wrong diagnoses — a rate limit, and
	 * a machine too busy to answer in five seconds. The page state at the moment
	 * of failure gave it away: the **email box was empty**, the password box was
	 * full, and there was no error message anywhere. Nothing had been rejected;
	 * nothing had been submitted.
	 *
	 * Filling begins before hydration finishes, and hydration replaces the input
	 * — so the first value typed is discarded and the second survives. Waiting
	 * for the page to settle and then confirming both boxes still hold what was
	 * typed removes the race rather than widening the window it hides in.
	 */
	await page.waitForLoadState('networkidle');

	const email = page.getByLabel('Email');
	const password = page.getByLabel('Password');
	await email.fill(EMAIL);
	await password.fill(PASSWORD);
	await expect(email).toHaveValue(EMAIL);
	await expect(password).toHaveValue(PASSWORD);

	await page.getByRole('button', { name: /sign in/i }).click();
	await expect(page).toHaveURL('/');
}

/**
 * Through a browser, because the thing worth proving is that a discarded
 * collection is gone from the public site — and "gone" is a claim about what a
 * request to its URL returns, not about a row.
 */
test('a discarded collection leaves the gallery and comes back intact', async ({ page }) => {
	await signIn(page);

	await page.getByRole('button', { name: 'New collection', exact: true }).click();
	const field = page.getByRole('textbox', { name: 'Collection name' });
	await field.fill('Bin Test');
	await field.press('Enter');

	await expect(page.getByRole('button', { name: 'Rename Bin Test' })).toBeVisible();

	// Reached the way the artist reaches it: from the collection's own page.
	// There is no /admin/collections index, only the per-collection route.
	await page.goto('/c/bin-test');
	await page.getByRole('link', { name: /manage photos/i }).click();
	await page.getByRole('button', { name: /move this collection to the trash/i }).click();
	await page.getByRole('button', { name: /^move to trash$/i }).click();

	// Gone from the public gallery.
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Rename Bin Test' })).toHaveCount(0);

	// And gone from its own address, which is the part that actually matters.
	const gone = await page.request.get('/c/bin-test');
	expect(gone.status()).toBe(404);

	// Still recoverable.
	await page.goto('/trash');

	// Scoped to its own row: other tests discard things too, and a test that
	// assumes it is the only thing in the bin breaks the moment one more is.
	const row = page.locator('.items li').filter({ hasText: 'Bin Test' });
	await expect(row.getByRole('heading', { name: 'Bin Test' })).toBeVisible();
	await row.getByRole('button', { name: /^restore$/i }).click();

	await expect(page.getByText(/restored/i)).toBeVisible();

	const back = await page.request.get('/c/bin-test');
	expect(back.status()).toBe(200);
});

test('the trash is not reachable without signing in', async ({ page }) => {
	await page.goto('/trash');
	await expect(page).toHaveURL(/\/login/);
});
