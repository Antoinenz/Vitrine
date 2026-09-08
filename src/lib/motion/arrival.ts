import { pendingPhotoIds } from './stack-transition';

/**
 * What a collection grid is allowed to load while its arrival plays.
 *
 * ## The problem this exists for
 *
 * Opening a collection starts two things in the same frame: a handful of
 * photographs flying out of the stack, and every photograph in the grid behind
 * them beginning to download and decode. The second ruins the first. A dozen
 * full-width images fetched at once saturate the connection the four in flight
 * are still waiting on, and decoding them competes for exactly the frames the
 * animation needs — which is why the first opening of a collection stutters and
 * every later one is smooth.
 *
 * So the grid loads in two acts. The photographs taking part in the transition
 * load immediately, because the animation is waiting on them and cannot start
 * without their pixels. Everything else waits until the flight has landed. The
 * grid is laid out either way — each frame already carries its photograph's
 * aspect ratio and dominant colour — so nothing moves when the held images
 * arrive; they resolve out of their colour, which is what they did anyway on a
 * first visit.
 *
 * ## Why only the first visit
 *
 * Holding images back costs about half a second before the grid fills in. On a
 * cold collection that is invisible, because those images were not going to be
 * there yet regardless. On one already in cache it would be a plain regression:
 * a grid that used to appear complete would show coloured rectangles first.
 *
 * A collection is therefore held once. After its grid has arrived, the browser
 * has the images and later openings load everything immediately — which matches
 * what is actually observed, that the stutter happens the first time and not
 * afterwards.
 */

/**
 * Collections whose grid has already arrived once in this session.
 *
 * Deliberately not persisted: it is a claim about the browser's caches, and
 * those do not survive the page either.
 */
const arrived = new Set<string>();

/**
 * The photographs that may load immediately, or null when every photograph may.
 *
 * Null is the answer for a direct link, a reload, a back navigation, reduced
 * motion, and any collection opened a second time — every route into the page
 * that isn't a first flight from a stack.
 */
export function eagerOnArrival(collectionId: string): Set<string> | null {
	if (arrived.has(collectionId)) return null;
	return pendingPhotoIds(collectionId);
}

/** Records that a grid has finished arriving, releasing it from then on. */
export function markArrived(collectionId: string): void {
	arrived.add(collectionId);
}
