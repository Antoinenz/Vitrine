import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** `/admin` has no content of its own; collections is the working surface. */
export const load: PageServerLoad = async () => {
	redirect(303, '/admin/collections');
};
