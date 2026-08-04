/**
 * Fills a fresh install with demo content, for development and screenshots.
 *
 *     DATA_DIR=./data-demo npx vite-node scripts/seed.ts
 *
 * Generated photographs rather than bundled ones: real images would add
 * megabytes to the repository, and the gradients here exercise the same ingest
 * path — renditions, thumbhash, dominant colour — without the weight.
 *
 * Refuses to touch a database that already has an account, so it can't
 * overwrite a real gallery by being run in the wrong directory.
 */
import sharp from 'sharp';
import { db } from '../src/lib/server/db/index.js';
import { users, profiles, collections, photos, derivatives } from '../src/lib/server/db/schema.js';
import { hashPassword } from '../src/lib/server/auth.js';
import { storeOriginal, writeDerivative, derivativeKey } from '../src/lib/server/storage.js';
import { keysAfter, keyBetween } from '../src/lib/server/sort-key.js';
import { processImage } from '../src/lib/server/images/process.js';

const PALETTES = [
	[
		[38, 60, 72],
		[120, 140, 130],
		[210, 200, 180]
	],
	[
		[64, 48, 44],
		[150, 110, 86],
		[226, 208, 180]
	],
	[
		[30, 42, 58],
		[88, 110, 130],
		[186, 198, 206]
	],
	[
		[46, 34, 40],
		[128, 92, 96],
		[220, 196, 188]
	]
];

async function photograph(width: number, height: number, palette: number[][]): Promise<Buffer> {
	const raw = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3;
			const t = (x / width) * 0.45 + (y / height) * 0.55;
			const segment = t < 0.5 ? 0 : 1;
			const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
			const [a, b] = [palette[segment], palette[segment + 1]];
			// Radial falloff, for a soft vignette rather than a flat ramp.
			const dx = x / width - 0.5;
			const dy = y / height - 0.5;
			const v = 1 - Math.min(1, Math.hypot(dx, dy) * 1.15) * 0.42;
			const grain = (Math.random() - 0.5) * 7;
			for (let c = 0; c < 3; c++) {
				raw[i + c] = Math.max(0, Math.min(255, (a[c] + (b[c] - a[c]) * k) * v + grain));
			}
		}
	}
	return sharp(raw, { raw: { width, height, channels: 3 } })
		.blur(1.1)
		.jpeg({ quality: 92 })
		.toBuffer();
}

async function main() {
	if (db.select().from(users).limit(1).get()) {
		console.error('Refusing to seed: this database already has an account.');
		process.exit(1);
	}

	const userId = crypto.randomUUID();
	db.insert(users)
		.values({
			id: userId,
			email: 'demo@example.com',
			passwordHash: await hashPassword('demopassword')
		})
		.run();
	db.insert(profiles)
		.values({
			userId,
			displayName: 'Demo Artist',
			bio: 'Landscape and quiet places. Mostly film, mostly early mornings.',
			accentColor: '#415a6b',
			socialLinks: [{ label: 'Instagram', url: 'https://instagram.com/example' }]
		})
		.run();

	const sets = [
		{ title: 'Sierra Nevada', slug: 'sierra-nevada', description: 'High country in late light.' },
		{ title: 'Coastal Fog', slug: 'coastal-fog', description: 'Mornings on the northern shore.' }
	];

	let collectionKey: string | null = null;

	for (const [index, set] of sets.entries()) {
		const collectionId = crypto.randomUUID();
		collectionKey = keyBetween(collectionKey, null);

		db.insert(collections)
			.values({
				id: collectionId,
				ownerId: userId,
				slug: set.slug,
				title: set.title,
				description: set.description,
				visibility: 'public',
				sortKey: collectionKey,
				downloadsEnabled: true,
				zipEnabled: true,
				metadataFields: ['camera', 'aperture', 'shutterSpeed', 'iso'],
				publishedAt: new Date()
			})
			.run();

		const shapes: [number, number][] = [
			[1800, 1200],
			[1200, 1800],
			[1600, 1600]
		];
		const keys = keysAfter(null, shapes.length);

		for (const [n, [w, h]] of shapes.entries()) {
			const buffer = await photograph(w, h, PALETTES[(index * 3 + n) % PALETTES.length]);
			const stored = await storeOriginal(
				(async function* () {
					yield buffer;
				})(),
				`${set.slug}-${n + 1}.jpg`
			);
			const photoId = crypto.randomUUID();
			const processed = await processImage(buffer);

			db.insert(photos)
				.values({
					id: photoId,
					collectionId,
					storageKey: stored.storageKey,
					originalName: `${set.slug}-${n + 1}.jpg`,
					contentType: 'image/jpeg',
					bytes: stored.bytes,
					crc32: stored.crc32,
					width: processed.width,
					height: processed.height,
					thumbhash: processed.thumbhash,
					dominantColor: processed.dominantColor,
					sortKey: keys[n],
					status: 'ready'
				})
				.run();

			// Derivatives reference the photo, so the row must exist first.
			for (const rendition of processed.renditions) {
				const key = derivativeKey(photoId, rendition.width, rendition.format);
				const bytes = await writeDerivative(key, rendition.data);
				db.insert(derivatives)
					.values({
						id: crypto.randomUUID(),
						photoId,
						width: rendition.width,
						height: rendition.height,
						format: rendition.format,
						storageKey: key,
						bytes
					})
					.run();
			}

			console.log(`  ${set.title} — photograph ${n + 1}/${shapes.length}`);
		}
	}

	console.log('\nSeeded. Sign in as demo@example.com / demopassword');
}

await main();
