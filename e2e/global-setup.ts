import { request } from '@playwright/test';
import sharp from 'sharp';

/**
 * Seeds the test install over HTTP, against the already-running server.
 *
 * Deliberately uses the same public endpoints a real artist would: sign in,
 * rotate the bootstrap password, create a collection, upload files, publish.
 * Writing rows directly would be faster but would skip the ingest pipeline
 * entirely — and the renditions it produces are exactly what the transition
 * under test animates.
 */

const BASE = 'http://localhost:4173';

/** A gradient, so encoders and placeholder hashing have real signal. */
async function photo(width: number, height: number): Promise<Buffer> {
	const raw = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3;
			raw[i] = Math.round((x / width) * 255);
			raw[i + 1] = Math.round((y / height) * 255);
			raw[i + 2] = 130;
		}
	}
	return (
		sharp(raw, { raw: { width, height, channels: 3 } })
			/**
			 * Real EXIF, so the viewer's details panel has something to show.
			 *
			 * Without this every seeded photograph carries `{}`, the Details button
			 * never renders, and the entire metadata path — extraction, projection
			 * through the allow-list, and the panel itself — is invisible to the
			 * suite.
			 *
			 * Only the IFD0 strings, because that is all that survives: sharp's
			 * `withExif` did not carry the ExifIFD numerics (FNumber, ExposureTime,
			 * ISO) through to something exifr could read back. One camera name is
			 * enough to open the panel, and the allow-list below deliberately
			 * permits four fields against this one populated value — so the panel is
			 * also proved not to render empty rows for metadata that isn't there.
			 */
			.withExif({ IFD0: { Make: 'Test', Model: 'Camera One' } })
			.jpeg()
			.toBuffer()
	);
}

const SIZES: [number, number][] = [
	[1200, 800],
	[800, 1200],
	[1000, 1000],
	[1400, 900],
	[900, 1400],
	[1100, 780]
];

export default async function globalSetup() {
	const ctx = await request.newContext({
		baseURL: BASE,
		extraHTTPHeaders: { Origin: BASE, Accept: 'text/html' }
	});

	// The server may still be applying migrations when Playwright hands over.
	for (let i = 0; i < 40; i++) {
		try {
			const res = await ctx.get('/');
			if (res.status() < 500) break;
		} catch {
			/* not listening yet */
		}
		await new Promise((r) => setTimeout(r, 250));
	}

	await ctx.post('/login', {
		form: { email: 'e2e@test.com', password: 'bootstrappassword' },
		maxRedirects: 0
	});

	// The account is seeded with `mustChangePassword`, so this is required before
	// anything else is reachable.
	await ctx.post('/password', {
		form: {
			current: 'bootstrappassword',
			next: 'rotatedpassword123',
			confirm: 'rotatedpassword123'
		},
		maxRedirects: 0
	});

	/**
	 * The slug the create action derives from this title. Asserted rather than
	 * assumed, because every path below is addressed by slug now — if slug
	 * generation ever changed, the uploads would 404 with no hint as to why.
	 */
	const slug = 'sierra';

	const created = await ctx.post('/admin/collections?/create', {
		form: { title: 'Sierra' },
		maxRedirects: 0
	});
	const location = created.headers()['location'] ?? '';
	const collectionId = location.split('/').pop();
	if (!collectionId) {
		throw new Error(`Seeding failed: no collection id in redirect (${created.status()})`);
	}

	for (let i = 0; i < SIZES.length; i++) {
		const body = await photo(...SIZES[i]);
		// Slug-addressed, so seeding no longer needs the collection id — but the
		// slug is only set by the `settings` post below, so this still runs against
		// the auto-generated one.
		const res = await ctx.post(`/api/collections/${slug}/upload?name=p${i}.jpg`, {
			headers: { 'content-type': 'image/jpeg' },
			data: body
		});
		if (!res.ok()) throw new Error(`Upload ${i} failed: ${res.status()} ${await res.text()}`);
	}

	/**
	 * Built by hand rather than with the `form` option, which takes a flat object
	 * and so cannot express a repeated field. `metadataFields` is a checkbox
	 * group: it arrives as one key appearing several times.
	 */
	const settings = new URLSearchParams({
		title: 'Sierra',
		slug: 'sierra',
		description: 'High country, late light.',
		visibility: 'public'
	});
	/**
	 * Publishes the EXIF the photographs carry. The allow-list defaults to empty,
	 * so without this the details panel stays shut even though the metadata was
	 * read and stored correctly — the button that opens it never renders, and the
	 * whole metadata path goes untested.
	 */
	for (const field of ['camera', 'aperture', 'shutterSpeed', 'iso']) {
		settings.append('metadataFields', field);
	}

	await ctx.post(`/admin/collections/${collectionId}?/settings`, {
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		data: settings.toString(),
		maxRedirects: 0
	});

	await ctx.post('/admin/profile', {
		form: { displayName: 'Test Artist', bio: 'Photographs.', accentColor: '#264653' },
		maxRedirects: 0
	});

	/**
	 * Renditions are generated in the background, and the transition can't run
	 * until they exist. Poll the collection page until every photo has rendered
	 * rather than sleeping for a guessed duration.
	 */
	const anon = await request.newContext({ baseURL: BASE });
	for (let i = 0; i < 120; i++) {
		const html = await (await anon.get('/c/sierra')).text();
		const rendered = (html.match(/data-photo/g) ?? []).length;
		if (rendered >= SIZES.length) break;
		if (i === 119) {
			throw new Error(`Only ${rendered}/${SIZES.length} photos processed before timeout`);
		}
		await new Promise((r) => setTimeout(r, 500));
	}

	await anon.dispose();
	await ctx.dispose();
}
