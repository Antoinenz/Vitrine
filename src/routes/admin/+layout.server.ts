import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * Guards every admin route.
 *
 * Layout loads run before the page loads beneath them, so putting the check
 * here means a new admin page is protected by existing rather than by
 * remembering to add a guard. The login page sits under `/admin/login` and is
 * exempted explicitly.
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	const isLoginPage = url.pathname === '/admin/login';
	const isPasswordPage = url.pathname === '/admin/password';

	if (!locals.user) {
		if (isLoginPage) return { user: null };
		const next = url.pathname === '/admin' ? '' : `?next=${encodeURIComponent(url.pathname)}`;
		redirect(303, `/admin/login${next}`);
	}

	// A bootstrap password from an env file or compose config shouldn't stay
	// usable, so the account is pinned to the change-password screen until it's
	// rotated. Allowing navigation away would make the prompt trivially skippable.
	if (locals.user.mustChangePassword && !isPasswordPage) {
		redirect(303, '/admin/password');
	}

	if (isLoginPage) redirect(303, '/admin/collections');

	return { user: { id: locals.user.id, email: locals.user.email } };
};
