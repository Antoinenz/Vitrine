import sharp from 'sharp';
import { test, expect, type Page } from '@playwright/test';

const EMAIL = 'e2e@test.com';
const PASSWORD = 'rotatedpassword123';

async function signIn(page: Page) {
	await page.goto('/login');
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

async function jpeg(seed: number): Promise<Buffer> {
	return sharp({
		create: { width: 300, height: 200, channels: 3, background: { r: seed, g: 80, b: 120 } }
	})
		.jpeg()
		.toBuffer();
}

/**
 * A private collection with `count` processed photographs in it.
 *
 * Deliberately not the seeded `sierra`: the transition and viewer suites assert
 * exactly how many photographs are on that page, and a test that discards some
 * of them would break those from another file.
 */
async function collectionWith(page: Page, title: string, slug: string, count: number) {
	await page.goto('/');
	await page.getByRole('button', { name: 'New collection', exact: true }).click();
	const field = page.getByRole('textbox', { name: 'Collection name' });
	await field.fill(title);
	await field.press('Enter');

	await page.goto(`/c/${slug}`);
	await page.locator('input[type=file]').setInputFiles(
		await Promise.all(
			Array.from({ length: count }, async (_, i) => ({
				name: `${slug}-${i}.jpg`,
				mimeType: 'image/jpeg',
				buffer: await jpeg(40 + i * 30)
			}))
		)
	);

	// The page is server-rendered, so the photographs only appear on a reload
	// once the worker has finished with them.
	await expect
		.poll(
			async () => {
				await page.goto(`/c/${slug}`);
				return page.locator('.grid figure').count();
			},
			{ timeout: 40_000, intervals: [1000] }
		)
		.toBe(count);
}

test('selecting photographs offers actions, and discarding takes them', async ({ page }) => {
	await signIn(page);
	await collectionWith(page, 'Pick Some', 'pick-some', 3);

	const figures = page.locator('.grid figure');
	const ribbon = page.getByRole('toolbar', { name: /selected photographs/i });

	// The ribbon is not permanent furniture on a page meant for looking.
	await expect(ribbon).toHaveCount(0);

	await figures.nth(0).hover();
	await figures.nth(0).getByRole('checkbox').click();
	await expect(ribbon).toBeVisible();
	await expect(page.getByText('1 photograph selected')).toBeVisible();

	// Only ever one face, so this needs exactly one photograph.
	await expect(page.getByRole('button', { name: 'Set as cover' })).toBeEnabled();

	await figures.nth(2).hover();
	await figures
		.nth(2)
		.getByRole('checkbox')
		.click({ modifiers: ['Shift'] });
	await expect(page.getByText('3 photographs selected')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Set as cover' })).toBeDisabled();

	await page.getByRole('button', { name: 'Deselect' }).click();
	await expect(ribbon).toHaveCount(0);

	// Discard two, and check the bytes stop as well as the tiles.
	await figures.nth(0).hover();
	await figures.nth(0).getByRole('checkbox').click();
	const goneId = await figures.nth(0).getAttribute('data-photo');
	await figures.nth(1).hover();
	await figures
		.nth(1)
		.getByRole('checkbox')
		.click({ modifiers: ['Shift'] });

	await page.getByRole('button', { name: 'Move to trash' }).click();

	await expect(figures).toHaveCount(1);
	await expect(ribbon).toHaveCount(0);
	expect((await page.request.get(`/i/${goneId}/320.webp`)).status()).toBe(404);

	// And recoverable, because nothing here is deleted by one click.
	await page.goto('/trash');
	await expect(page.locator('.items li').filter({ hasText: 'pick-some-' })).toHaveCount(2);
});

test('a visitor gets no checkboxes at all', async ({ page, browser }) => {
	await signIn(page);
	await collectionWith(page, 'No Ticks', 'no-ticks', 1);

	// Unlisted rather than public: reachable by link, so a visitor can get to it,
	// while staying out of the listings the anonymous suites assert on.
	const tile = page.locator('.collections > li').filter({ hasText: 'No Ticks' }).first();
	await page.goto('/');
	await tile.hover();
	await tile.getByRole('button', { name: 'Actions for No Ticks' }).click();
	await page.getByRole('menu').getByText('Change visibility…').click();
	await page.getByRole('radio', { name: /Unlisted/ }).check();
	await page.getByRole('button', { name: 'Save' }).click();
	// Hidden, not absent: a closed <dialog> keeps its contents in the DOM.
	await expect(page.getByText('Who can see this?')).toBeHidden();

	const anon = await browser.newContext();
	const anonPage = await anon.newPage();
	await anonPage.goto('/c/no-ticks');

	await expect(anonPage.locator('.grid figure')).toHaveCount(1);
	await expect(anonPage.getByRole('checkbox')).toHaveCount(0);
	await anon.close();
});
