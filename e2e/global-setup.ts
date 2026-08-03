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
	return sharp(raw, { raw: { width, height, channels: 3 } })
		.jpeg()
		.toBuffer();
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

	await ctx.post('/admin/login', {
		form: { email: 'e2e@test.com', password: 'bootstrappassword' },
		maxRedirects: 0
	});

	// The account is seeded with `mustChangePassword`, so this is required before
	// anything else is reachable.
	await ctx.post('/admin/password', {
		form: {
			current: 'bootstrappassword',
			next: 'rotatedpassword123',
			confirm: 'rotatedpassword123'
		},
		maxRedirects: 0
	});

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
		const res = await ctx.post(`/admin/collections/${collectionId}/upload?name=p${i}.jpg`, {
			headers: { 'content-type': 'image/jpeg' },
			data: body
		});
		if (!res.ok()) throw new Error(`Upload ${i} failed: ${res.status()} ${await res.text()}`);
	}

	await ctx.post(`/admin/collections/${collectionId}?/settings`, {
		form: {
			title: 'Sierra',
			slug: 'sierra',
			description: 'High country, late light.',
			visibility: 'public'
		},
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
