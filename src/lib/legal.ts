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

These terms cover your use of {{SITE}} (the "site"). By browsing it you agree to
them. If you don't, please don't use the site.

# Copyright

Every photograph published here is the work of {{SITE}} and is protected by
copyright. Copyright is not transferred by viewing, downloading, or sharing.

You may view the photographs, link to any page, and share those links freely.

# What you may not do

Without written permission, you may not:

reproduce, republish, or redistribute any photograph, in whole or in part;
sell, license, or otherwise commercialise it;
use it in any product, publication, advertisement, or promotional material;
alter, crop, recolour, or create derivative works from it;
remove or obscure any credit, watermark, or metadata;
use it to train, fine-tune, or evaluate machine-learning or generative systems,
or include it in any dataset assembled for that purpose.

Automated scraping, bulk downloading, and framing the site's images on another
site are not permitted.

# Downloads

Some collections offer downloads. Where they do, files are provided for the
purpose agreed with you — a print, a personal copy, a delivery to a client — and
remain subject to these terms. A download grants no additional rights.

# Password-protected collections

Some collections are shared by link and password. Please don't pass either on
without the owner's agreement. Access can be withdrawn at any time.

# Availability and changes

The site is provided as-is and as-available. It may be offline at times, and
collections may be added, changed, or removed without notice. Nothing here is a
guarantee of continued availability.

# Liability

To the extent the law allows, {{SITE}} is not liable for any loss arising from
use of this site. Nothing in these terms limits liability that cannot be limited
by law.

# Licensing and permissions

Requests to license or reproduce a photograph are welcome. Write to
[add your contact address].

# Changes to these terms

These terms may be updated. The date below shows when they last changed.

_Last updated: [date]._`,

	privacy: `# Privacy

This page explains what happens to information about you when you visit
{{SITE}}. It is written to be read, not to be survived.

# The short version

This site is self-hosted. It has no advertising, no third-party analytics, and
no tracking cookies. Nothing about your visit is sold or shared with anyone.

# What is collected

**Server logs.** Like nearly every web server, this one records each request:
your IP address, the page requested, the date and time, the referring page, and
your browser's user-agent string. These are used to run the site, diagnose
faults, and identify abuse.

**A cookie, only if you unlock a collection.** If you enter a password for a
private collection, a cookie is set so you aren't asked again. It records only
that the password was entered correctly for that one collection. It contains no
personal information and is not used for tracking.

**A cookie, only if you sign in.** Administrators of the site get a session
cookie when they log in. Visitors never receive one.

That is the complete list. There is no analytics script, no advertising
identifier, no fingerprinting, no social media pixel, and no third-party
JavaScript on any page.

# What is not done

Your visit is not used to build a profile of you, is not sold or rented, and is
not shared with advertisers or data brokers. Photographs you view are served
from this site's own server, not from a third-party CDN that could observe you.

# How long it is kept

Server logs are kept only as long as they are useful for operating and securing
the site, and are then deleted. Cookies expire on their own — the unlock cookie
within 30 days, the sign-in cookie within 30 days of last use.

# Legal basis

Where the UK GDPR or EU GDPR applies, the lawful basis for processing server
logs is legitimate interest: running a website securely and reliably. The
cookies described above are strictly necessary for functions you have asked for,
so no consent banner is required.

# Your rights

Depending on where you live, you may have the right to ask what information is
held about you, to have it corrected or deleted, to object to its processing, or
to complain to a data protection regulator. Write to [add your contact address]
and it will be dealt with promptly.

# Children

This site is not directed at children and does not knowingly collect
information from them.

# Changes

If this policy changes, the date below will change with it.

# Contact

Questions about privacy can be sent to [add your contact address].

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
