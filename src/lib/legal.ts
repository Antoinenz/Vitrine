/**
 * Starter text for the operator-authored legal pages.
 *
 * These are **templates, not legal advice.** What a gallery's terms and privacy
 * policy must say depends on where its operator is, who its visitors are, and
 * what the install actually collects — none of which this software can know.
 * They are deliberately not seeded into the database: the admin editor offers
 * them as a starting point, so a page is only ever published once someone has
 * read it and made it their own.
 *
 * `{{SITE}}` is substituted with the artist's display name when inserted.
 */

export const TEMPLATES: Record<'terms' | 'privacy', string> = {
	terms: `# Terms of use

These terms cover your use of {{SITE}}.

# The photographs

Every photograph on this site is the property of {{SITE}} and is protected by
copyright. You may view them here and share links to them.

You may not reproduce, redistribute, sell, or use them commercially, or train
machine-learning models on them, without written permission.

Where a collection offers downloads, those files are provided for the purpose
agreed with you and remain subject to these terms.

# Availability

This site is offered as-is. It may be unavailable at times, and collections may
be changed or removed without notice.

# Contact

Questions about these terms can be sent to [add your contact address].

_Last updated: [date]._`,

	privacy: `# Privacy

This page explains what {{SITE}} collects when you visit.

# What is collected

This site is self-hosted and does not use third-party analytics, advertising, or
tracking cookies.

The web server keeps standard request logs — IP address, page requested, time,
browser user-agent — which are used to operate and secure the site.

A cookie is set only if you unlock a password-protected collection, to remember
that you entered the password. It contains no personal information.

# What is not done

Your visit is not sold, shared with advertisers, or used to build a profile of
you. There are no third-party scripts on these pages.

# Your rights

Depending on where you live you may have the right to ask what information is
held about you, and to have it deleted. Write to [add your contact address].

# Changes

If this policy changes, the date below will change with it.

_Last updated: [date]._`
};

/**
 * A deliberately tiny renderer for page content.
 *
 * Lines beginning `# ` become headings; blank lines separate paragraphs.
 * Everything else is treated as literal text and escaped by Svelte on output —
 * no HTML is interpreted, so an operator can't accidentally (or a compromised
 * account deliberately) inject script into a public page. A full Markdown
 * dependency would buy formatting nobody has asked for and a much larger
 * surface to get wrong.
 */
export interface Block {
	type: 'heading' | 'paragraph';
	text: string;
}

export function renderBlocks(content: string): Block[] {
	const blocks: Block[] = [];

	for (const chunk of content.split(/\n{2,}/)) {
		if (!chunk.trim()) continue;

		/**
		 * A heading is a single line. Text on the line below it — with no blank
		 * line between — is a paragraph, not part of the heading: writing
		 * `# Privacy` immediately above the opening sentence is the natural thing
		 * to do, and folding them together produced one enormous heading.
		 */
		const lines = chunk.split('\n');
		if (lines[0].trim().startsWith('# ')) {
			blocks.push({ type: 'heading', text: lines[0].trim().slice(2).trim() });
			const rest = lines.slice(1).join(' ').trim();
			if (rest) blocks.push({ type: 'paragraph', text: rest.replace(/\s+/g, ' ') });
			continue;
		}

		blocks.push({ type: 'paragraph', text: chunk.trim().replace(/\s+/g, ' ') });
	}

	return blocks;
}
