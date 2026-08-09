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

	/**
	 * The overlay exists only for the length of the transition, so polling for it
	 * is a race that a loaded machine loses. A MutationObserver installed before
	 * the click records that it appeared at all, which is the actual claim and is
	 * independent of how fast the run happens to be.
	 */
	type GhostWindow = Window & { __sawGhost?: boolean };

	await page.evaluate(() => {
		(window as GhostWindow).__sawGhost = false;
		new MutationObserver(() => {
			if (document.getElementById('vitrine-ghost-layer')) {
				(window as GhostWindow).__sawGhost = true;
			}
		}).observe(document.body, { childList: true });
	});

	await page.locator('.stack-link').first().click();
	await expect.poll(() => page.evaluate(() => (window as GhostWindow).__sawGhost)).toBe(true);

	/**
	 * And it must not survive — a stranded fixed overlay would sit on top of the
	 * page looking wrong. The window is generous because the transition waits on
	 * real image decoding, which is slow on a loaded CI machine; the assertion is
	 * "it always goes away", not "it goes away within one animation frame".
	 */
	await expect(page.locator(GHOST_LAYER)).toHaveCount(0, { timeout: 15000 });
});

test('every photo ends fully visible after the transition', async ({ page }) => {
	await page.goto('/');
	await page.locator('.stack-link').first().click();
	await expect(page).toHaveURL(/\/c\/sierra$/);
	await expect(page.locator(GHOST_LAYER)).toHaveCount(0, { timeout: 15000 });

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

test('photographs keep their proportions throughout the flight', async ({ page }) => {
	await page.setViewportSize({ width: 1200, height: 900 });
	await page.goto('/');
	await expect(page.locator('.stack').first()).toBeVisible();

	/**
	 * Samples every ghost's rendered shape against the shape of the photograph it
	 * depicts, on every frame of the flight.
	 *
	 * A ghost used to be cut from the stack's *layer* — a fixed, roughly 4:3 box
	 * — and fitted to a grid figure of the photograph's own proportions. For a
	 * portrait frame that is a different scale horizontally and vertically, so
	 * the picture was squeezed narrow and tall for the whole journey and only
	 * snapped back at the end, when the ghost faded and the real photograph
	 * showed through. Measured, it reached 2.35x its correct aspect.
	 */
	await page.evaluate(() => {
		const w = window as Window & { __aspect?: number[]; __raf?: number };
		w.__aspect = [];
		const tick = () => {
			const layer = document.getElementById('vitrine-ghost-layer');
			if (layer) {
				for (const ghost of layer.children) {
					const img = ghost.querySelector('img');
					if (!img?.naturalWidth) continue;
					const rect = ghost.getBoundingClientRect();
					if (!rect.height) continue;
					w.__aspect!.push(rect.width / rect.height / (img.naturalWidth / img.naturalHeight));
				}
			}
			w.__raf = requestAnimationFrame(tick);
		};
		tick();
	});

	await page.locator('.stack-link').first().click();
	await expect(page).toHaveURL(/\/c\//);
	await page.waitForTimeout(1500);

	const samples = await page.evaluate(() => {
		const w = window as Window & { __aspect?: number[]; __raf?: number };
		cancelAnimationFrame(w.__raf!);
		return w.__aspect ?? [];
	});

	// The flight was actually observed, rather than the assertion passing on an
	// empty sample set.
	expect(samples.length).toBeGreaterThan(10);

	// A few percent is sub-pixel rounding; anything more is visible distortion.
	expect(Math.max(...samples)).toBeLessThan(1.15);
	expect(Math.min(...samples)).toBeGreaterThan(0.87);
});

/**
 * NOTE: this does **not** reproduce the reported fault.
 *
 * The bug is an overlay left floating over the gallery after clicking between
 * pages faster than the animation can run. Two attempts to force it — leaving
 * for a page that cannot claim the capture, and superseding the navigation with
 * a back press — both come out clean with the fixes reverted, so this test
 * passes either way and is not a regression test for that bug.
 *
 * It is kept as a guard on the general invariant: no navigation sequence may
 * leave ghosts on screen. The fixes it accompanies are an expiry timer on an
 * unclaimed overlay and a cancel on arriving somewhere that cannot play one,
 * and neither is proven by a failing test.
 */
test('no ghosts survive a rapid change of mind', async ({ page }) => {
	// A real entry to go back to, so `history.back()` lands on a page of the site
	// rather than on the blank tab the context started with.
	await page.goto('/login');
	await page.goto('/');
	await expect(page.locator('.stack').first()).toBeVisible();

	/**
	 * Click, then leave again before the collection page has mounted. The stack
	 * is captured in the click handler, but the navigation that would have
	 * collected the overlay is superseded — and because the artist page never
	 * unmounted, nothing re-runs to claim it either.
	 */
	await page.locator('.stack-link').first().click({ noWaitAfter: true });
	await page.evaluate(() => history.back());

	// Whichever navigation wins the race, the overlay must not survive it. The
	// destination is deliberately not asserted — the point is that *no* landing
	// place leaves ghosts behind.
	await expect(page.locator(GHOST_LAYER)).toHaveCount(0, { timeout: 6000 });
});
