import type { RequestHandler } from './$types';

/**
 * Only public collections should be indexed. Unlisted ones are reachable by
 * link but deliberately unlisted, and both they and the admin area carry
 * `noindex` meta tags too — this is the belt to that pair of braces, since a
 * crawler that ignores robots.txt still sees the meta tag.
 */
export const GET: RequestHandler = ({ url }) => {
	const body = [
		'User-agent: *',
		'Disallow: /admin',
		'Disallow: /api',
		// The artist's own doors. Nothing secret — they're guarded server-side —
		// but there is no reason for them to turn up in a search result.
		'Disallow: /login',
		'Disallow: /password',
		'',
		`Sitemap: ${url.origin}/sitemap.xml`,
		''
	].join('\n');

	return new Response(body, {
		headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=3600' }
	});
};
