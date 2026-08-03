import { expect, test } from '@playwright/test';

/**
 * Browser coverage for the stack → grid transition.
 *
 * This is the feature the whole design rests on, and it's the one that can't be
 * verified by typechecking: it depends on real layout, real image decoding and
 * a real navigation. These tests assert the parts that are objectively
 * checkable — that the URL genuinely changes, that the ghost overlay appears
 * and is always cleaned up, and that the grid ends in the same correct state
 * however it was reached. How it *feels* still needs a human.
 */

const GHOST_LAYER = '#vitrine-ghost-layer';

test('artist page renders collection stacks', async ({ page }) => {
	await page.goto('/');

	await expect(page.locator('h1')).toContainText('Test Artist');
	const stack = page.locator('.stack').first();
	await expect(stack).toBeVisible();
	// Four layers deep, or as many photos as exist.
	expect(await stack.locator('.layer').count()).toBeGreaterThan(1);
});

test('clicking a stack changes the URL and lands on the grid', async ({ page }) => {
	await page.goto('/');
	await page.locator('.stack-link').first().click();

	// A real navigation, not a modal pretending to be one.
	await expect(page).toHaveURL(/\/c\/sierra$/);
	await expect(page.locator('h1')).toContainText('Sierra');

	const figures = page.locator('[data-photo]');
	await expect(figures.first()).toBeVisible();
	expect(await figures.count()).toBe(6);
});

test('the ghost overlay is created and then always cleaned up', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.stack').first()).toBeVisible();

	// Catch the overlay mid-flight: it only exists during the transition.
	const appeared = page.waitForSelector(GHOST_LAYER, { state: 'attached', timeout: 3000 });
	await page.locator('.stack-link').first().click();
	await appeared;

	// And it must not survive — a stranded fixed overlay would sit on top of the
	// page swallowing nothing but looking wrong.
	await expect(page.locator(GHOST_LAYER)).toHaveCount(0, { timeout: 5000 });
});

test('every photo ends fully visible after the transition', async ({ page }) => {
	await page.goto('/');
	await page.locator('.stack-link').first().click();
	await expect(page).toHaveURL(/\/c\/sierra$/);
	await expect(page.locator(GHOST_LAYER)).toHaveCount(0, { timeout: 5000 });

	// The transition animates opacity; nothing may be left faded out.
	const opacities = await page
		.locator('[data-photo]')
		.evaluateAll((els) => els.map((el) => Number(getComputedStyle(el).opacity)));

	expect(opacities).toHaveLength(6);
	for (const opacity of opacities) expect(opacity).toBeCloseTo(1, 1);
});

test('a directly-opened collection reveals normally', async ({ page }) => {
	// The shared-link case: no stack was ever clicked, so there is nothing to
	// continue from and the grid must reveal itself instead of staying hidden.
	await page.goto('/c/sierra');

	await expect(page.locator('h1')).toContainText('Sierra');
	await expect(page.locator(GHOST_LAYER)).toHaveCount(0);

	const figures = page.locator('[data-photo]');
	await expect(figures.first()).toBeVisible();
	await expect
		.poll(async () => figures.first().evaluate((el) => Number(getComputedStyle(el).opacity)))
		.toBeCloseTo(1, 1);
});

test('reduced motion skips the overlay but still navigates', async ({ browser }) => {
	const context = await browser.newContext({ reducedMotion: 'reduce' });
	const page = await context.newPage();

	await page.goto('/');
	await page.locator('.stack-link').first().click();

	await expect(page).toHaveURL(/\/c\/sierra$/);
	// No ghosts at all under reduced motion — the destination is reached plainly.
	await expect(page.locator(GHOST_LAYER)).toHaveCount(0);
	await expect(page.locator('[data-photo]').first()).toBeVisible();

	await context.close();
});

test('back navigation returns to the artist page with stacks intact', async ({ page }) => {
	await page.goto('/');
	await page.locator('.stack-link').first().click();
	await expect(page).toHaveURL(/\/c\/sierra$/);

	await page.goBack();

	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('.stack').first()).toBeVisible();
	// A stale overlay must not follow the visitor back.
	await expect(page.locator(GHOST_LAYER)).toHaveCount(0);
});

test('photos keep their aspect ratio so the grid never reflows', async ({ page }) => {
	await page.goto('/c/sierra');

	const ratios = await page
		.locator('[data-photo] .frame')
		.evaluateAll((els) => els.map((el) => getComputedStyle(el).aspectRatio));

	// Every frame declares a ratio; none falls back to `auto`, which would let
	// the box resize on load and move the transition's target rectangles.
	expect(ratios).toHaveLength(6);
	for (const ratio of ratios) expect(ratio).not.toBe('auto');
});
