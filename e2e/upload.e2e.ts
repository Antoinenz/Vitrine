import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Uploading, in a real browser.
 *
 * Drag-and-drop cannot be tested any other way: `DataTransfer`, the `Files`
 * type list, and the browser's rule that a drop is refused unless `dragover`
 * calls `preventDefault` are all browser behaviours with no HTTP equivalent.
 * The seeding in `global-setup` POSTs to the endpoint directly and would pass
 * happily with every drop handler in the app deleted.
 *
 * These run signed in, so owner chrome is on the page. They must not assert
 * bare `[data-photo]` counts the way the anonymous suites do.
 */

const EMAIL = 'e2e@test.com';
const PASSWORD = 'rotatedpassword123';

async function signIn(page: Page) {
	await page.goto('/login');
	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: /sign in/i }).click();
	await expect(page).toHaveURL('/');
}

/** A real JPEG, so the file survives the ingest worker rather than failing it. */
async function jpeg(): Promise<Buffer> {
	return sharp({
		create: { width: 600, height: 400, channels: 3, background: { r: 40, g: 90, b: 140 } }
	})
		.jpeg()
		.toBuffer();
}

/**
 * Dispatches a genuine file drag onto the window.
 *
 * Playwright has no native drop-a-file API, so the `DataTransfer` is built in
 * the page. This is what exercises the `types.includes('Files')` guard and the
 * `preventDefault` on `dragover` — both of which are invisible to any test that
 * calls the upload endpoint directly.
 */
async function dropFile(page: Page, name: string, base64: string, mimeType = 'image/jpeg') {
	await page.evaluate(
		async ({ name, base64, mimeType }) => {
			const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
			const file = new File([bytes], name, { type: mimeType });
			const dt = new DataTransfer();
			dt.items.add(file);

			for (const type of ['dragenter', 'dragover', 'drop']) {
				window.dispatchEvent(
					new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })
				);
			}
		},
		{ name, base64, mimeType }
	);
}

/**
 * Creates a scratch collection and opens its workbench — which is where the
 * uploader lives this pass; it moves onto `/c/[slug]` with the rest of the
 * inline controls, and these tests follow it there.
 *
 * Deliberately **not** the seeded `sierra`. The transition and viewer suites
 * assert that exactly six photographs are on that page, so uploading into it
 * would break them from another file — the worst kind of failure to attribute.
 * A fresh collection is also private by default, so it cannot alter the
 * anonymous artist page either.
 */
async function newWorkbench(page: Page, title: string) {
	// Created from the artist page, which is the only place it can be done now.
	await page.goto('/');
	await page.getByRole('button', { name: 'New collection' }).click();
	await page.getByLabel('Title').fill(title);
	await page.getByRole('button', { name: 'Create' }).click();

	// Lands on the collection, then through to the workbench.
	await page.getByRole('link', { name: /manage photos/i }).click();
	await expect(page.getByRole('button', { name: /upload photos/i })).toBeVisible();
}

test('choosing a file uploads it and reports progress', async ({ page }) => {
	await signIn(page);
	await newWorkbench(page, 'Chosen Files');

	await page.locator('input[type=file]').setInputFiles({
		name: 'chosen.jpg',
		mimeType: 'image/jpeg',
		buffer: await jpeg()
	});

	// The panel is fixed and lives in the layout, not the page — it has to appear
	// without a navigation.
	await expect(page.getByText('chosen.jpg')).toBeVisible();
	await expect(page.getByText('Uploaded')).toBeVisible({ timeout: 15_000 });
});

test('dropping a file anywhere in the window uploads it to the open collection', async ({
	page
}) => {
	await signIn(page);
	await newWorkbench(page, 'Dropped Files');

	const base64 = (await jpeg()).toString('base64');
	await dropFile(page, 'dropped.jpg', base64);

	await expect(page.getByText('dropped.jpg')).toBeVisible();
	await expect(page.getByText('Uploaded')).toBeVisible({ timeout: 15_000 });
});

/**
 * The positive counterpart to the two negative tests below.
 *
 * Without this one they would both pass if the veil were deleted outright, or
 * never rendered at all — which is exactly the sort of hole that makes a suite
 * feel safe while testing nothing.
 */
test('dragging files over the window names where they will land', async ({ page }) => {
	await signIn(page);
	await newWorkbench(page, 'Veil Check');

	await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.items.add(new File([new Uint8Array([1])], 'x.jpg', { type: 'image/jpeg' }));
		for (const type of ['dragenter', 'dragover']) {
			window.dispatchEvent(
				new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })
			);
		}
	});

	await expect(page.getByText('Drop to upload')).toBeVisible();
	// Anchored, because the title also appears in the heading, the breadcrumb and
	// the settings form — this must be the veil's own line, not any of those.
	await expect(page.getByText(/^to Veil Check$/)).toBeVisible();
});

test('dragging a photo to reorder does not raise the upload veil', async ({ page }) => {
	await signIn(page);
	await newWorkbench(page, 'Reorder Guard');

	/**
	 * The regression this guards: photo reordering drags a `text/plain` payload,
	 * and a drop handler that engages on any drag at all would black out the
	 * window every time the artist tried to rearrange a collection.
	 */
	await page.evaluate(() => {
		const dt = new DataTransfer();
		dt.setData('text/plain', 'some-photo-id');
		for (const type of ['dragenter', 'dragover']) {
			window.dispatchEvent(
				new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })
			);
		}
	});

	await expect(page.getByText('Drop to upload')).toHaveCount(0);
});

test('a visitor gets no upload handlers at all', async ({ page }) => {
	await page.goto('/c/sierra');

	const base64 = (await jpeg()).toString('base64');
	await dropFile(page, 'not-mine.jpg', base64);

	// No veil, no queue panel: the overlay is never mounted for a visitor.
	await expect(page.getByText('Drop to upload')).toHaveCount(0);
	await expect(page.getByText('not-mine.jpg')).toHaveCount(0);
});
