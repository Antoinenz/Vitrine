/**
 * Standard licences an artist can attach to their work.
 *
 * Named licences rather than free text so the footer can link to the canonical
 * deed: the wording that actually governs use is the one on the licensor's own
 * site, not a paraphrase stored here. It also keeps the choice machine-readable
 * for search engines and image tools, which a prose sentence would not be.
 */
export interface Licence {
	id: string;
	label: string;
	/** Canonical deed. Empty for the default, which has nowhere to link. */
	url: string;
	/** Shown in the admin so the choice is understandable without a search. */
	summary: string;
}

export const LICENCES: Licence[] = [
	{
		id: 'all-rights-reserved',
		label: 'All rights reserved',
		url: '',
		summary: 'No reuse without your written permission. The default.'
	},
	{
		id: 'cc-by-4.0',
		label: 'CC BY 4.0',
		url: 'https://creativecommons.org/licenses/by/4.0/',
		summary: 'Anyone may use and adapt your work, including commercially, if they credit you.'
	},
	{
		id: 'cc-by-nc-4.0',
		label: 'CC BY-NC 4.0',
		url: 'https://creativecommons.org/licenses/by-nc/4.0/',
		summary: 'Use and adaptation with credit, but not for commercial purposes.'
	},
	{
		id: 'cc-by-nc-nd-4.0',
		label: 'CC BY-NC-ND 4.0',
		url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
		summary:
			'Share with credit, non-commercially, with no alterations. The most restrictive CC licence.'
	},
	{
		id: 'cc-by-sa-4.0',
		label: 'CC BY-SA 4.0',
		url: 'https://creativecommons.org/licenses/by-sa/4.0/',
		summary: 'Use and adapt with credit, provided derivatives carry the same licence.'
	},
	{
		id: 'cc0-1.0',
		label: 'CC0 1.0 (public domain)',
		url: 'https://creativecommons.org/publicdomain/zero/1.0/',
		summary: 'You waive all rights. Anyone may do anything, without credit. Cannot be undone.'
	}
];

export const DEFAULT_LICENCE = LICENCES[0].id;

export function findLicence(id: string | null | undefined): Licence {
	return LICENCES.find((l) => l.id === id) ?? LICENCES[0];
}
