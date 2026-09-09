import { test, expect } from '@playwright/test';

const EMAIL = 'e2e@test.com';
const PASSWORD = 'rotatedpassword123';

async function signIn(page: import('@playwright/test').Page) {
	await page.goto('/login');
	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Password').fill(PASSWORD);
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

	await page.getByRole('button', { name: /new collection/i }).click();
	await page.getByLabel(/title/i).fill('Bin Test');
	await page.getByRole('button', { name: /^create$/i }).click();

	await expect(page.getByRole('heading', { name: 'Bin Test' })).toBeVisible();

	// Reached the way the artist reaches it: from the collection's own page.
	// There is no /admin/collections index, only the per-collection route.
	await page.goto('/c/bin-test');
	await page.getByRole('link', { name: /manage photos/i }).click();
	await page.getByRole('button', { name: /move this collection to the trash/i }).click();
	await page.getByRole('button', { name: /^move to trash$/i }).click();

	// Gone from the public gallery.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Bin Test' })).toHaveCount(0);

	// And gone from its own address, which is the part that actually matters.
	const gone = await page.request.get('/c/bin-test');
	expect(gone.status()).toBe(404);

	// Still recoverable.
	await page.goto('/trash');
	await expect(page.getByRole('heading', { name: 'Bin Test' })).toBeVisible();
	await page.getByRole('button', { name: /^restore$/i }).click();

	await expect(page.getByText(/restored/i)).toBeVisible();

	const back = await page.request.get('/c/bin-test');
	expect(back.status()).toBe(200);
});

test('the trash is not reachable without signing in', async ({ page }) => {
	await page.goto('/trash');
	await expect(page).toHaveURL(/\/login/);
});
