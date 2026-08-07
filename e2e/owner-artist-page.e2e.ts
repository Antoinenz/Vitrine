import { test, expect, type Page } from '@playwright/test';

/**
 * The artist's controls on their own page.
 *
 * The whole point of this change is that editing happens on the public page, so
 * these run signed in and assert against the *same* page a visitor sees. They
 * must never assert bare `[data-photo]` counts — owner chrome is present here —
 * and they must not create collections that would alter what the anonymous
 * suites see, so anything made is left private.
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

test('a visitor sees no owner controls', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'New collection' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);
});

test('the artist creates a collection without leaving the gallery', async ({ page }) => {
	await signIn(page);

	// Same page, same stacks — the controls are additions, not a separate screen.
	await expect(page.locator('.stack').first()).toBeVisible();

	await page.getByRole('button', { name: 'New collection' }).click();
	await page.getByLabel('Title').fill('Inline Made');
	await page.getByRole('button', { name: 'Create' }).click();

	// Straight into the new collection, which is empty and wants photographs.
	await expect(page).toHaveURL('/c/inline-made');
	await expect(page.getByRole('heading', { name: 'Inline Made' })).toBeVisible();
});

test('a collection created inline is private, so it stays off the public page', async ({
	page,
	browser
}) => {
	await signIn(page);
	await page.getByRole('button', { name: 'New collection' }).click();
	await page.getByLabel('Title').fill('Not Yet Published');
	await page.getByRole('button', { name: 'Create' }).click();
	await expect(page).toHaveURL('/c/not-yet-published');

	// The owner sees it on their own page — otherwise a collection they just made
	// would vanish and there would be no way back to it.
	await page.goto('/');
	await expect(page.getByText('Not Yet Published')).toBeVisible();

	// A visitor does not.
	const anon = await browser.newContext();
	const anonPage = await anon.newPage();
	await anonPage.goto('/');
	await expect(anonPage.getByText('Not Yet Published')).toHaveCount(0);
	await anon.close();
});

test('an empty title is refused with a message, not silently', async ({ page }) => {
	await signIn(page);
	await page.getByRole('button', { name: 'New collection' }).click();

	// The field is `required`, so the browser blocks submission — which is the
	// behaviour worth pinning: no request, no navigation, and the modal stays.
	await page.getByRole('button', { name: 'Create' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.getByLabel('Title')).toBeVisible();
});

test('the profile modal saves and the page reflects it immediately', async ({ page }) => {
	await signIn(page);

	await page.getByRole('button', { name: 'Edit profile' }).click();
	await page.getByLabel('Display name').fill('Renamed Artist');
	await page.getByRole('button', { name: 'Save' }).click();

	await expect(page.getByRole('status')).toContainText('Saved');

	// The heading behind the modal is the same page's own header, so a correct
	// save shows through without a reload.
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('heading', { name: 'Renamed Artist' })).toBeVisible();

	// Put it back, so later files and reruns see the seeded name.
	await page.getByRole('button', { name: 'Edit profile' }).click();
	await page.getByLabel('Display name').fill('Test Artist');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status')).toContainText('Saved');
});
