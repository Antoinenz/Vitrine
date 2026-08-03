import { sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import { db } from './db';
import { users, profiles } from './db/schema';
import { hashPassword } from './auth';
import {
	ADMIN_EMAIL,
	ADMIN_PASSWORD,
	ORIGINALS_DIR,
	DERIVATIVES_DIR,
	IS_PRODUCTION
} from './config';

/**
 * One-time setup performed at server start: ensure the storage directories
 * exist and, on a brand-new install, create the owner account.
 */

let done = false;

export async function bootstrap(): Promise<void> {
	if (done) return;
	done = true;

	mkdirSync(ORIGINALS_DIR, { recursive: true });
	mkdirSync(DERIVATIVES_DIR, { recursive: true });

	await seedOwner();
}

/**
 * Creates the owner from ADMIN_EMAIL/ADMIN_PASSWORD, but only when no user
 * exists yet. Guarding on "is the table empty" rather than "does this email
 * exist" means leaving the variables set in the environment can never resurrect
 * a deleted account or silently reset a changed password.
 */
async function seedOwner(): Promise<void> {
	const { count } = db
		.select({ count: sql<number>`count(*)` })
		.from(users)
		.get() ?? {
		count: 0
	};
	if (count > 0) return;

	if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
		console.warn(
			'[vitrine] No user accounts exist and ADMIN_EMAIL/ADMIN_PASSWORD are unset.\n' +
				'          Set them and restart to create the owner account.'
		);
		return;
	}

	if (IS_PRODUCTION && ADMIN_PASSWORD.length < 12) {
		throw new Error(
			'ADMIN_PASSWORD must be at least 12 characters in production. ' +
				'This is the bootstrap credential for the only account on the install.'
		);
	}

	const id = crypto.randomUUID();
	const passwordHash = await hashPassword(ADMIN_PASSWORD);
	// Captured before the closure: narrowing from the guard above doesn't reach
	// inside the transaction callback.
	const email = ADMIN_EMAIL.toLowerCase().trim();

	db.transaction((tx) => {
		tx.insert(users)
			.values({
				id,
				email,
				passwordHash,
				// Forces a change at first login, so a credential that was passed
				// through an env file or compose config can't stay valid.
				mustChangePassword: true
			})
			.run();

		tx.insert(profiles).values({ userId: id, displayName: '' }).run();
	});

	console.log(`[vitrine] Created owner account ${ADMIN_EMAIL}. You'll be asked to`);
	console.log('          choose a new password at first login.');
}
