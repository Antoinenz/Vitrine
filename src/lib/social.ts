/**
 * Width of the JPEG rendition advertised to link-preview scrapers.
 *
 * Lives outside `$lib/server` because the page components need it to build the
 * `og:image` URL, and anything under `server/` can't be imported into markup.
 * It must match the width the image worker actually generates.
 */
export const SOCIAL_WIDTH = 1280;
