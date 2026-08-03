import type { User, Session } from '$lib/server/db/schema';

declare global {
	namespace App {
		interface Locals {
			/** The signed-in owner, or null for an anonymous visitor. */
			user: User | null;
			session: Session | null;
		}

		/**
		 * State carried by shallow routing. The photo viewer pushes a real URL
		 * (`/c/[slug]/[photoId]`) while rendering as an overlay; `photo` is set
		 * only on that client-side path.
		 *
		 * It is always absent during SSR and on a direct load of the URL, which
		 * is why the viewer must also exist as a standalone route.
		 */
		interface PageState {
			photo?: { id: string; index: number };
		}
	}
}

export {};
