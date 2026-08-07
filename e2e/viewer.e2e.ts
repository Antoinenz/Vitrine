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

	/**
	 * Wait for the arrival animation to finish before clicking.
	 *
	 * `revealGrid` tweens the photographs from `opacity: 0` and a 12px offset, and
	 * Playwright's actionability checks do not consider opacity — so the click was
	 * being delivered to a target that was still invisible and still moving. That
	 * is what made this the flakiest test in the suite; it failed roughly one run
	 * in three regardless of machine load.
	 */
	await expect(page.locator('[data-photo]').first()).toHaveCSS('opacity', '1');

	const popup = context.waitForEvent('page');
	await page
		.locator('[data-photo] a')
		.first()
		.click({ modifiers: ['ControlOrMeta'] });
	const opened = await popup;

	/**
	 * The overlay must not hijack ctrl/cmd-click.
	 *
	 * `waitForURL` with `commit` rather than `toHaveURL`, because ctrl-click opens
	 * the tab in the *background* and browsers deprioritise loading those — the
	 * page can sit on `about:blank` for a long time while the foreground tab
	 * holds the CPU. `toHaveURL` polls for a fully settled load and was timing out
	 * roughly one run in three, which is what made this the suite's flakiest test.
	 * The claim being made is that the browser genuinely navigated a new tab to
	 * the photograph's own URL, and a committed navigation is exactly that.
	 */
	await opened.waitForURL(/\/c\/sierra\/[a-f0-9-]{36}$/, { waitUntil: 'commit' });
	await opened.close();
});

test('the details panel opens and closes', async ({ page }) => {
	await page.goto('/c/sierra');
	await page.locator('[data-photo]').first().click();
	await expect(page.locator(VIEWER)).toBeVisible();

	// The button only exists when the photograph carries metadata, which is why
	// the seed embeds real EXIF — without it this whole path is invisible.
	await page.getByRole('button', { name: 'Details' }).click();
	await expect(page.locator(`${VIEWER} dl`)).toBeVisible();
	await expect(page.locator(`${VIEWER} dl`)).toContainText('Test Camera One');

	/**
	 * The collection allows four metadata fields but only the camera has a value,
	 * so exactly one row may render. This is the assertion that would catch the
	 * panel listing empty labels for metadata the photograph doesn't carry.
	 */
	await expect(page.locator(`${VIEWER} dl > div`)).toHaveCount(1);

	await page.getByRole('button', { name: 'Details' }).click();

	// The panel animates out, so it lingers in the DOM through its outro. The
	// assertion is that it goes, not that it went in the same frame.
	await expect(page.locator(`${VIEWER} dl`)).toHaveCount(0);
});

test('zooming keeps the photograph on screen while the sharper file loads', async ({ page }) => {
	await page.goto('/c/sierra');
	await expect(page.locator('[data-photo]').first()).toHaveCSS('opacity', '1');
	await page.locator('[data-photo] a').first().click();

	const img = page.locator(`${VIEWER} img`).first();
	await expect(img).toBeVisible();
	const before = await img.getAttribute('src');

	/**
	 * Slow every rendition request from here on. The zoom source is the only
	 * image the page still wants, and without this delay it arrives from cache
	 * fast enough that the regression would hide behind a passing test.
	 */
	await page.route('**/i/**', async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});

	await img.dblclick();

	/**
	 * The bug this pins: the element was bound straight to the zoom source, so it
	 * was hidden behind a spinner until those bytes landed — the photograph
	 * disappeared at the exact moment someone leaned in to look at it. It must
	 * stay on screen, showing the rendition it already had.
	 */
	await expect(img).toBeVisible();
	expect(await img.getAttribute('src')).toBe(before);

	// And it does eventually sharpen, rather than being stuck on the preview.
	await expect(img).not.toHaveAttribute('src', before ?? '', { timeout: 15_000 });
	await expect(img).toBeVisible();
});

test('a bar with the collection name appears once the header scrolls away', async ({ page }) => {
	await page.setViewportSize({ width: 900, height: 600 });
	await page.goto('/c/sierra');

	const bar = page.locator('.topbar');
	// Present in the markup from the start, but not shown — it animates in, so it
	// cannot simply be absent.
	await expect(bar).not.toBeInViewport();

	await page.locator('[data-photo]').last().scrollIntoViewIfNeeded();

	await expect(bar).toBeInViewport();
	await expect(bar).toContainText('Sierra');
	await expect(bar.getByRole('link', { name: /back/i })).toBeVisible();

	// And it goes away again on the way back up, rather than sticking.
	await page.evaluate(() => window.scrollTo({ top: 0 }));
	await expect(bar).not.toBeInViewport();
});

test('the filmstrip keeps the selection centred and respects each frame shape', async ({
	page
}) => {
	await page.setViewportSize({ width: 1000, height: 700 });
	await page.goto('/c/sierra');
	await page.locator('[data-photo] a').first().click();
	await expect(page.locator(VIEWER)).toBeVisible();

	const strip = page.locator('.filmstrip');
	const thumbs = page.locator('.filmstrip button');

	/**
	 * The seed has landscape, portrait and square photographs, so if the strip
	 * still forced one box shape every chip would measure the same. Distinct
	 * widths are the evidence that the frame shape survives.
	 */
	const widths = await thumbs.evaluateAll((els) =>
		els.map((el) => Math.round(el.getBoundingClientRect().width))
	);
	expect(new Set(widths).size).toBeGreaterThan(1);

	/** The selected thumbnail sits at the middle of the strip, within a pixel or two. */
	async function offsetFromCentre() {
		return await page.evaluate(() => {
			const strip = document.querySelector('.filmstrip')!;
			const active = strip.querySelector('[aria-current="true"]')!;
			const s = strip.getBoundingClientRect();
			const a = active.getBoundingClientRect();
			return Math.abs(a.left + a.width / 2 - (s.left + s.width / 2));
		});
	}

	await expect.poll(offsetFromCentre).toBeLessThan(4);

	// Stepping moves the strip, not the marker.
	const before = await strip.evaluate((el) => el.scrollLeft);
	await page.keyboard.press('ArrowRight');
	await expect(page.locator(VIEWER)).toContainText('2 / 6');
	await expect.poll(offsetFromCentre).toBeLessThan(4);
	expect(await strip.evaluate((el) => el.scrollLeft)).not.toBe(before);
});

test('a progress dial reports the zoom rendition arriving', async ({ page }) => {
	await page.goto('/c/sierra');
	await expect(page.locator('[data-photo]').first()).toHaveCSS('opacity', '1');
	await page.locator('[data-photo] a').first().click();

	const img = page.locator(`${VIEWER} img`).first();
	await expect(img).toBeVisible();

	// Slowed, or the rendition arrives before the dial can be observed at all.
	await page.route('**/i/**', async (route) => {
		await new Promise((r) => setTimeout(r, 1200));
		await route.continue();
	});

	await img.dblclick();

	const dial = page.locator('.zoom-progress');
	await expect(dial).toBeVisible();
	// Real bytes, not a fake easing curve — so it must report a genuine position.
	await expect(dial).toHaveAttribute('aria-valuenow', /\d+/);

	// And it goes when the rendition lands, rather than lingering at 99%.
	await expect(dial).toHaveCount(0, { timeout: 20_000 });
	await expect(img).toBeVisible();
});
