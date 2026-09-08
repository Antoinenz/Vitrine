/**
 * The `sizes` attribute each layout gives its photographs.
 *
 * Shared rather than written at each call site because the transition needs to
 * know what the *other* layout will ask for. A stack shows its prints small and
 * a grid shows them large, so the two pick different candidates out of the same
 * srcset — and the flight between them is waiting on whichever the destination
 * chooses. Warming it means resolving `sizes` exactly as the destination will,
 * which is only possible if there is one copy of the answer.
 */

/** Collection stacks on the artist page. */
export const STACK_SIZES = '(max-width: 40rem) 80vw, 320px';

/** The grid on a collection page. */
export const GRID_SIZES = '(max-width: 40rem) 100vw, (max-width: 70rem) 50vw, 33vw';
