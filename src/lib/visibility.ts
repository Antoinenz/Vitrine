import type { Visibility } from '$lib/server/db/schema';

/**
 * The three states a collection can be in, in the order a dropdown should
 * offer them.
 *
 * Here rather than in the schema because the labels and the descriptions are
 * needed in the browser, and `$lib/server` cannot be imported there. The type
 * still comes from the schema, as a type-only import that is erased at build —
 * so there is one definition of what the values are, and one of what they mean.
 *
 * Ordered least to most exposed, so the list reads as a sequence of decisions
 * rather than an arbitrary set, and the safest option is the one at the top.
 */
export const VISIBILITY_OPTIONS: {
	value: Visibility;
	label: string;
	hint: string;
}[] = [
	{ value: 'private', label: 'Private', hint: 'Only you can see it.' },
	{
		value: 'unlisted',
		label: 'Unlisted',
		hint: 'Anyone with the link can see it. It is not listed on your page or in your sitemap.'
	},
	{ value: 'public', label: 'Public', hint: 'Listed on your page and offered to search engines.' }
];

export const VISIBILITIES = new Set<Visibility>(VISIBILITY_OPTIONS.map((o) => o.value));

/** The label for a state, for a badge or a menu. */
export function visibilityLabel(value: Visibility): string {
	return VISIBILITY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
