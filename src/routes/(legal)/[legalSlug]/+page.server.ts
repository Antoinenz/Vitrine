import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { legalPages, LEGAL_SLUGS, type LegalSlug } from '$lib/server/db/schema';
import { renderBlocks } from '$lib/legal';

export const load: PageServerLoad = async ({ params }) => {
	if (!(LEGAL_SLUGS as readonly string[]).includes(params.legalSlug)) error(404);

	const page = db
		.select()
		.from(legalPages)
		.where(eq(legalPages.slug, params.legalSlug as LegalSlug))
		.get();

	// An unwritten page doesn't exist as far as visitors are concerned, rather
	// than rendering as an empty document with a heading.
	if (!page || !page.content.trim()) error(404);

	return {
		title: page.title,
		blocks: renderBlocks(page.content),
		updatedAt: page.updatedAt
	};
};
