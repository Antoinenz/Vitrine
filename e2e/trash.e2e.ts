import sharp from 'sharp';
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
async function jpeg(): Promise<Buffer> {
	return sharp({
		create: { width: 400, height: 300, channels: 3, background: { r: 90, g: 60, b: 40 } }
	})
		.jpeg()
		.toBuffer();
}

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

/**
 * Trashing has to stop the photographs, not just the page.
 *
 * This was shipped broken. The collection page 404'd while `/i/<id>/<size>`
 * went on serving every rendition and `/api/photos/<id>/download` went on
 * serving the untouched originals — to anyone holding a photograph id, which
 * the page publishes in `data-photo`. Discarding a private client gallery
 * removed it from view and left the work reachable.
 *
 * Asserted over HTTP against real URLs, because that is the claim: not that a
 * row is marked, but that the bytes stop coming.
 */
test('a trashed collection stops serving its photographs', async ({ page }) => {
	await signIn(page);

	// The seeded collection, which actually has processed photographs in it.
	await page.goto('/c/sierra');
	const photoId = await page.locator('[data-photo]').first().getAttribute('data-photo');
	expect(photoId).toBeTruthy();

	const rendition = `/i/${photoId}/320.webp`;
	expect((await page.request.get(rendition)).status()).toBe(200);

	await page.getByRole('link', { name: /manage photos/i }).click();
	await page.getByRole('button', { name: /move this collection to the trash/i }).click();
	await page.getByRole('button', { name: /^move to trash$/i }).click();

	expect((await page.request.get('/c/sierra')).status()).toBe(404);
	expect((await page.request.get(rendition)).status()).toBe(404);
	expect((await page.request.get(`/api/photos/${photoId}/download`)).status()).toBe(404);

	// Put it back: the rest of the suite is built on this collection.
	await page.goto('/trash');
	const row = page.locator('.items li').filter({ hasText: 'Sierra' });
	await row.getByRole('button', { name: /^restore$/i }).click();

	expect((await page.request.get(rendition)).status()).toBe(200);
});

/**
 * Deleting a photograph is discarding it, not destroying it.
 *
 * The workbench used to unlink the original from disk the moment the button was
 * pressed. Everything discarded in this gallery now goes to the trash first, so
 * this asserts the whole loop — gone from the collection, gone from the URLs,
 * still recoverable.
 */
test('a deleted photograph goes to the trash and comes back', async ({ page }) => {
	await signIn(page);

	await page.goto('/');
	await page.getByRole('button', { name: 'New collection', exact: true }).click();
	const field = page.getByRole('textbox', { name: 'Collection name' });
	await field.fill('Photo Bin');
	await field.press('Enter');

	await page.goto('/c/photo-bin');
	await page.locator('input[type=file]').setInputFiles({
		name: 'binned.jpg',
		mimeType: 'image/jpeg',
		buffer: await jpeg()
	});
	await expect(page.getByText('Uploaded')).toBeVisible({ timeout: 20_000 });

	/**
	 * Reload until it appears, rather than waiting on the DOM.
	 *
	 * The page is server-rendered and the photograph only exists on it once the
	 * worker has finished encoding, so `toHaveCount` would poll a document that
	 * cannot change on its own.
	 */
	await expect
		.poll(
			async () => {
				await page.goto('/c/photo-bin');
				return page.locator('[data-photo]').count();
			},
			{ timeout: 30_000, intervals: [1000] }
		)
		.toBe(1);

	const photoId = await page.locator('[data-photo]').first().getAttribute('data-photo');

	await page.getByRole('link', { name: /manage photos/i }).click();
	page.once('dialog', (d) => d.accept());
	await page
		.getByRole('button', { name: /^delete$/i })
		.first()
		.click();

	// Gone from the collection, and from the addresses that served it.
	await page.goto('/c/photo-bin');
	await expect(page.getByText('This collection is empty')).toBeVisible();
	expect((await page.request.get(`/i/${photoId}/320.webp`)).status()).toBe(404);
	expect((await page.request.get(`/api/photos/${photoId}/download`)).status()).toBe(404);

	// And recoverable.
	await page.goto('/trash');
	const row = page.locator('.items li').filter({ hasText: 'binned.jpg' });
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: /^restore$/i }).click();

	await page.goto('/c/photo-bin');
	await expect(page.locator('[data-photo]')).toHaveCount(1);
	expect((await page.request.get(`/i/${photoId}/320.webp`)).status()).toBe(200);
});
