import { test, expect, type Page } from '@playwright/test';

const EMAIL = 'e2e@test.com';
const PASSWORD = 'rotatedpassword123';

async function signIn(page: Page) {
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

/** Makes a collection and returns its title. */
async function make(page: Page, title: string) {
	await page.getByRole('button', { name: 'New collection', exact: true }).click();
	const field = page.getByRole('textbox', { name: 'Collection name' });
	await field.fill(title);
	await field.press('Enter');
	await expect(page.getByRole('button', { name: `Rename ${title}` })).toBeVisible();
	return page.locator('.collections > li').filter({ hasText: title }).first();
}

test('the three dots and a right-click open the same menu', async ({ page }) => {
	await signIn(page);
	const tile = await make(page, 'Menu Test');

	await tile.hover();
	await tile.getByRole('button', { name: 'Actions for Menu Test' }).click();
	await expect(page.getByRole('menu')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('menu')).toHaveCount(0);

	await tile.click({ button: 'right' });
	await expect(page.getByRole('menu')).toBeVisible();

	for (const item of ['Open', 'Open in new tab', 'Rename', 'Move to trash']) {
		await expect(page.getByRole('menu').getByText(item, { exact: true })).toBeVisible();
	}
});

test('shift and right-click leaves the browser its own menu', async ({ page }) => {
	await signIn(page);
	const tile = await make(page, 'Shift Test');

	// There is no API to open the browser's menu, so the only thing a page can
	// do is decline to prevent the event. That is what this checks.
	await page.evaluate(() => {
		(window as unknown as { prevented: boolean | null }).prevented = null;
		document.addEventListener(
			'contextmenu',
			(e) => ((window as unknown as { prevented: boolean | null }).prevented = e.defaultPrevented),
			true
		);
	});

	await tile.click({ button: 'right', modifiers: ['Shift'] });

	expect(await page.evaluate(() => (window as unknown as { prevented: boolean }).prevented)).toBe(
		false
	);
	await expect(page.getByRole('menu')).toHaveCount(0);
});

test('visibility can be changed from the tile, and a visitor can tell', async ({
	page,
	browser
}) => {
	await signIn(page);
	const tile = await make(page, 'Visible Test');

	/**
	 * Checked by asking for the collection's own URL as a stranger, not by
	 * looking for it on the artist page.
	 *
	 * An empty collection is deliberately not listed to visitors — it has no
	 * stack to show — so making one public changes nothing there. What it does
	 * change is that the address stops being a 404, which is the thing an artist
	 * is actually deciding when they publish.
	 *
	 * Unlisted rather than public, on purpose. These files share one database
	 * with the suites that assert what an anonymous visitor sees, and publishing
	 * something here changes their world out from under them — which is exactly
	 * what happened, as unrelated viewer tests began failing a different one each
	 * run. Unlisted moves the address from 404 to 200 just as well, and stays out
	 * of every public listing.
	 */
	const anon = await browser.newContext();
	const anonPage = await anon.newPage();

	expect((await anonPage.request.get('/c/visible-test')).status()).toBe(404);

	await tile.hover();
	await tile.getByRole('button', { name: 'Actions for Visible Test' }).click();
	await page.getByRole('menu').getByText('Change visibility…').click();

	await expect(page.getByText('Who can see this?')).toBeVisible();
	await page.getByRole('radio', { name: /Unlisted/ }).check();
	await page.getByRole('button', { name: 'Save' }).click();

	await expect(page.getByRole('button', { name: 'Rename Visible Test' })).toBeVisible();
	await expect(tile.getByRole('button', { name: /change who can see this/i })).toHaveAttribute(
		'title',
		'Unlisted'
	);

	expect((await anonPage.request.get('/c/visible-test')).status()).toBe(200);
	await anon.close();
});

test('moving to trash from the menu takes it off the page', async ({ page }) => {
	await signIn(page);
	const tile = await make(page, 'Menu Trash Test');

	await tile.hover();
	await tile.getByRole('button', { name: 'Actions for Menu Trash Test' }).click();
	await page.getByRole('menu').getByText('Move to trash').click();

	await expect(page.getByRole('button', { name: 'Rename Menu Trash Test' })).toHaveCount(0);

	await page.goto('/trash');
	await expect(page.getByRole('heading', { name: 'Menu Trash Test' })).toBeVisible();
});

test('reorder mode makes the tiles draggable and stops them being links', async ({ page }) => {
	await signIn(page);
	const tile = await make(page, 'Reorder Test');

	await tile.hover();
	await tile.getByRole('button', { name: 'Actions for Reorder Test' }).click();
	await page.getByRole('menu').getByText('Reorder collections').click();

	await expect(page.getByText(/Drag the collections/)).toBeVisible();
	await expect(page.locator('.collections.reordering')).toHaveCount(1);
	await expect(tile).toHaveAttribute('draggable', 'true');

	await page.getByRole('button', { name: 'Done' }).click();
	await expect(page.locator('.collections.reordering')).toHaveCount(0);
});
