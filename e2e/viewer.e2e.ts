import { expect, test } from '@playwright/test';

/**
 * Browser coverage for the photo viewer.
 *
 * The important property is that one URL has two correct presentations: an
 * overlay when entered from the grid, and a standalone server-rendered page
 * when opened cold. Those paths are easy to let drift apart, and the failure
 * only shows up on a shared link.
 */

const VIEWER = '[role="dialog"]';

test('clicking a photo opens the viewer at its own URL', async ({ page }) => {
	await page.goto('/c/sierra');
	await page.locator('[data-photo] a').first().click();

	await expect(page.locator(VIEWER)).toBeVisible();
	// A real, shareable URL — not a modal on the collection address.
	await expect(page).toHaveURL(/\/c\/sierra\/[a-f0-9-]{36}$/);
	await expect(page.locator(VIEWER)).toContainText('1 / 6');
});

test('arrow keys move through the collection and update the URL', async ({ page }) => {
	await page.goto('/c/sierra');
	await page.locator('[data-photo] a').first().click();
	await expect(page.locator(VIEWER)).toBeVisible();

	const first = page.url();

	await page.keyboard.press('ArrowRight');
	await expect(page.locator(VIEWER)).toContainText('2 / 6');
	expect(page.url()).not.toBe(first);

	await page.keyboard.press('ArrowLeft');
	await expect(page.locator(VIEWER)).toContainText('1 / 6');

	// Clamped at the ends rather than wrapping or erroring.
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator(VIEWER)).toContainText('1 / 6');

	await page.keyboard.press('End');
	await expect(page.locator(VIEWER)).toContainText('6 / 6');
});

test('Escape closes and returns to the grid', async ({ page }) => {
	await page.goto('/c/sierra');
	await page.locator('[data-photo] a').first().click();
	await expect(page.locator(VIEWER)).toBeVisible();

	await page.keyboard.press('Escape');

	await expect(page.locator(VIEWER)).toHaveCount(0);
	await expect(page).toHaveURL(/\/c\/sierra$/);
});

test('stepping through photos does not pile up history entries', async ({ page }) => {
	await page.goto('/c/sierra');
	await page.locator('[data-photo] a').first().click();
	await expect(page.locator(VIEWER)).toBeVisible();

	for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
	await expect(page.locator(VIEWER)).toContainText('5 / 6');

	// One back press returns to the grid, not four — stepping replaces rather
	// than pushes, so escaping a long collection never means mashing Back.
	await page.goBack();
	await expect(page).toHaveURL(/\/c\/sierra$/);
	await expect(page.locator(VIEWER)).toHaveCount(0);
});

test('a photo URL opened cold renders standalone', async ({ page }) => {
	// The shared-link case. `page.state` is empty on a direct load, so this must
	// come from the server-rendered route rather than shallow routing.
	await page.goto('/c/sierra');
	const href = await page.locator('[data-photo] a').nth(2).getAttribute('href');

	await page.goto(href!);

	await expect(page.locator(VIEWER)).toBeVisible();
	await expect(page.locator(VIEWER)).toContainText('3 / 6');
	await expect(page.locator('.filmstrip button')).toHaveCount(6);
});

test('the filmstrip jumps to a chosen photo', async ({ page }) => {
	await page.goto('/c/sierra');
	await page.locator('[data-photo] a').first().click();
	await expect(page.locator(VIEWER)).toBeVisible();

	await page.locator('.filmstrip button').nth(3).click();

	await expect(page.locator(VIEWER)).toContainText('4 / 6');
	await expect(page.locator('.filmstrip button').nth(3)).toHaveAttribute('aria-current', 'true');
});

test('closing returns the viewed photo to the viewport', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 700 });
	await page.goto('/c/sierra');
	await page.locator('[data-photo] a').first().click();
	await expect(page.locator(VIEWER)).toBeVisible();

	await page.keyboard.press('End');
	await expect(page.locator(VIEWER)).toContainText('6 / 6');
	await page.keyboard.press('Escape');
	await expect(page.locator(VIEWER)).toHaveCount(0);

	// The last photo viewed should be on screen, not left at the top of the page.
	await expect(page.locator('[data-photo]').last()).toBeInViewport();
});

test('a modified click still opens a real tab', async ({ page, context }) => {
	await page.goto('/c/sierra');

	const popup = context.waitForEvent('page');
	await page
		.locator('[data-photo] a')
		.first()
		.click({ modifiers: ['ControlOrMeta'] });
	const opened = await popup;

	// The overlay must not hijack ctrl/cmd-click.
	await expect(opened).toHaveURL(/\/c\/sierra\/[a-f0-9-]{36}$/);
	await opened.close();
});
