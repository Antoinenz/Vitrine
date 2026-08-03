import { asc, eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profiles, users } from '$lib/server/db/schema';

/**
 * Supplies the artist's accent colour to every page.
 *
 * Loaded once in the root layout rather than per page, so the colour is present
 * in the first server-rendered HTML — set later from a page load, links would
 * visibly change colour after hydration.
 */
export const load: LayoutServerLoad = async () => {
	const owner = db
		.select({ id: users.id })
		.from(users)
		.orderBy(asc(users.createdAt))
		.limit(1)
		.get();
	if (!owner) return { accentColor: null };

	const profile = db
		.select({ accentColor: profiles.accentColor })
		.from(profiles)
		.where(eq(profiles.userId, owner.id))
		.get();

	return { accentColor: profile?.accentColor ?? null };
};
