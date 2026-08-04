import { asc, eq, and } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { collections, users } from '$lib/server/db/schema';

/** Escapes the five characters that are not legal as XML text. */
function xml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * Lists the artist page and every *public* collection.
 *
 * Unlisted collections are excluded on purpose: publishing their URLs in a
 * sitemap would undo the only thing that makes them unlisted.
 */
export const GET: RequestHandler = ({ url }) => {
	const owner = db
		.select({ id: users.id })
		.from(users)
		.orderBy(asc(users.createdAt))
		.limit(1)
		.get();

	const published = owner
		? db
				.select({ slug: collections.slug, updatedAt: collections.updatedAt })
				.from(collections)
				.where(and(eq(collections.ownerId, owner.id), eq(collections.visibility, 'public')))
				.orderBy(asc(collections.sortKey))
				.all()
		: [];

	const entries = [
		`  <url><loc>${xml(url.origin)}/</loc></url>`,
		...published.map(
			(c) =>
				`  <url><loc>${xml(`${url.origin}/c/${c.slug}`)}</loc>` +
				`<lastmod>${c.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`
		)
	];

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

	return new Response(body, {
		headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=3600' }
	});
};
