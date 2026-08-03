import { describe, it, expect } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { collectionAccess, grantUnlock, revokeUnlock, isListed } from './access';
import type { Collection, User } from './db/schema';

/**
 * `collectionAccess` is the one gate every content route consults, so this
 * covers the full matrix of visibility × viewer. A gap here is a privacy bug,
 * not a cosmetic one.
 */

/** Minimal in-memory Cookies stand-in. */
function fakeCookies(initial: Record<string, string> = {}): Cookies {
	const jar = new Map(Object.entries(initial));
	return {
		get: (name: string) => jar.get(name),
		set: (name: string, value: string) => jar.set(name, value),
		delete: (name: string) => jar.delete(name),
		getAll: () => [...jar].map(([name, value]) => ({ name, value })),
		serialize: () => ''
	} as unknown as Cookies;
}

function makeCollection(over: Partial<Collection> = {}): Collection {
	return {
		id: 'col-1',
		ownerId: 'owner-1',
		slug: 'sierra',
		title: 'Sierra',
		description: '',
		visibility: 'public',
		passwordHash: null,
		coverPhotoId: null,
		sortKey: 'a0',
		downloadsEnabled: false,
		zipEnabled: false,
		stripExifOnDownload: false,
		metadataFields: [],
		publishedAt: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
		...over
	} as Collection;
}

const owner = { id: 'owner-1' } as User;
const stranger = { id: 'someone-else' } as User;

const anon: App.Locals = { user: null, session: null };
const asOwner: App.Locals = { user: owner, session: null };
const asStranger: App.Locals = { user: stranger, session: null };

describe('collectionAccess', () => {
	it('grants the owner access to their own private work', () => {
		const c = makeCollection({ visibility: 'private' });
		expect(collectionAccess(c, asOwner, fakeCookies())).toBe('granted');
	});

	it('denies anonymous visitors a private collection', () => {
		const c = makeCollection({ visibility: 'private' });
		expect(collectionAccess(c, anon, fakeCookies())).toBe('denied');
	});

	/** Being signed in as someone else must not confer any access. */
	it('denies a different signed-in user a private collection', () => {
		const c = makeCollection({ visibility: 'private' });
		expect(collectionAccess(c, asStranger, fakeCookies())).toBe('denied');
	});

	it('grants anyone a public collection', () => {
		expect(collectionAccess(makeCollection(), anon, fakeCookies())).toBe('granted');
	});

	it('grants anyone with the link an unlisted collection', () => {
		const c = makeCollection({ visibility: 'unlisted' });
		expect(collectionAccess(c, anon, fakeCookies())).toBe('granted');
	});

	it('locks a password-protected collection', () => {
		const c = makeCollection({ passwordHash: '$argon2id$fake' });
		expect(collectionAccess(c, anon, fakeCookies())).toBe('locked');
	});

	it('grants access once unlocked', () => {
		const c = makeCollection({ passwordHash: '$argon2id$fake' });
		const cookies = fakeCookies();
		grantUnlock(cookies, c);
		expect(collectionAccess(c, anon, cookies)).toBe('granted');
	});

	it('never asks the owner for the password', () => {
		const c = makeCollection({ passwordHash: '$argon2id$fake' });
		expect(collectionAccess(c, asOwner, fakeCookies())).toBe('granted');
	});

	/**
	 * Visibility is the outer gate; a password is an extra lock, never a bypass.
	 * Otherwise anyone holding a share link could reach work marked private.
	 */
	it('keeps a private collection private even when it has a password', () => {
		const c = makeCollection({ visibility: 'private', passwordHash: '$argon2id$fake' });
		const cookies = fakeCookies();
		grantUnlock(cookies, c);
		expect(collectionAccess(c, anon, cookies)).toBe('denied');
	});

	/** Unlocking one client gallery must not open another. */
	it('does not let a grant for one collection unlock a different one', () => {
		const a = makeCollection({ id: 'col-a', passwordHash: '$argon2id$fake' });
		const b = makeCollection({ id: 'col-b', passwordHash: '$argon2id$fake' });

		const cookies = fakeCookies();
		grantUnlock(cookies, a);

		expect(collectionAccess(a, anon, cookies)).toBe('granted');
		expect(collectionAccess(b, anon, cookies)).toBe('locked');
	});

	/**
	 * The grant is derived from the password hash, so changing the password
	 * invalidates outstanding grants with no revocation list to maintain.
	 */
	it('invalidates a grant when the password changes', () => {
		const before = makeCollection({ passwordHash: '$argon2id$old' });
		const cookies = fakeCookies();
		grantUnlock(cookies, before);
		expect(collectionAccess(before, anon, cookies)).toBe('granted');

		const after = makeCollection({ passwordHash: '$argon2id$new' });
		expect(collectionAccess(after, anon, cookies)).toBe('locked');
	});

	it('rejects a forged grant cookie', () => {
		const c = makeCollection({ passwordHash: '$argon2id$fake' });
		const cookies = fakeCookies({ [`vitrine_unlock_${c.id}`]: 'not-the-real-token' });
		expect(collectionAccess(c, anon, cookies)).toBe('locked');
	});

	it('re-locks after the grant is revoked', () => {
		const c = makeCollection({ passwordHash: '$argon2id$fake' });
		const cookies = fakeCookies();
		grantUnlock(cookies, c);
		revokeUnlock(cookies, c.id);
		expect(collectionAccess(c, anon, cookies)).toBe('locked');
	});
});

describe('isListed', () => {
	it('lists only public collections', () => {
		expect(isListed({ visibility: 'public' })).toBe(true);
		// Unlisted is reachable by link but must not appear in the index.
		expect(isListed({ visibility: 'unlisted' })).toBe(false);
		expect(isListed({ visibility: 'private' })).toBe(false);
	});
});
