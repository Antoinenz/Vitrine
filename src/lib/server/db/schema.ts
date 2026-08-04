import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

/**
 * Timestamps are stored as INTEGER epoch-milliseconds. SQLite has no native
 * date type, and storing numbers keeps ordering, comparison and indexing exact.
 */
const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	/**
	 * Set when the account is seeded from ADMIN_PASSWORD on first boot. While
	 * true the admin UI forces a password change, so a deployment that never
	 * rotated the bootstrap credential can't sit exposed indefinitely.
	 */
	mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
	createdAt: createdAt()
});

export const sessions = sqliteTable(
	'sessions',
	{
		/**
		 * The SHA-256 of the session token, never the token itself. A leaked
		 * database therefore yields no usable sessions.
		 */
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('sessions_user_idx').on(t.userId)]
);

// ---------------------------------------------------------------------------
// Artist profile
// ---------------------------------------------------------------------------

/**
 * One row per user. Split from `users` so that public page rendering never
 * touches the table holding password hashes.
 */
export const profiles = sqliteTable('profiles', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	displayName: text('display_name').notNull().default(''),
	/** Short "about me" shown at the top of the artist page. */
	bio: text('bio').notNull().default(''),
	avatarPhotoId: text('avatar_photo_id'),
	/** `[{ label, url }]` — ordered, so the artist controls link order. */
	socialLinks: text('social_links', { mode: 'json' })
		.$type<{ label: string; url: string }[]>()
		.notNull()
		.default([]),
	accentColor: text('accent_color').notNull().default('#1c1917'),

	/** Id from `$lib/licences`, shown in the footer. */
	licence: text('licence').notNull().default('all-rights-reserved'),
	/** A short line in the footer — a print enquiry address, a studio note. */
	footerNote: text('footer_note').notNull().default(''),
	/** `[{ label, url }]`, ordered, shown beside the legal links. */
	footerLinks: text('footer_links', { mode: 'json' })
		.$type<{ label: string; url: string }[]>()
		.notNull()
		.default([])
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export type Visibility = 'public' | 'unlisted' | 'private';

/** EXIF fields the artist may expose. Anything absent is never sent to a client. */
export const METADATA_FIELDS = [
	'camera',
	'lens',
	'focalLength',
	'aperture',
	'shutterSpeed',
	'iso',
	'takenAt',
	'location'
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

export const collections = sqliteTable(
	'collections',
	{
		id: text('id').primaryKey(),
		/**
		 * Present from day one so adding multi-artist support later is a routing
		 * change rather than a data migration.
		 */
		ownerId: text('owner_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		slug: text('slug').notNull(),
		title: text('title').notNull(),
		description: text('description').notNull().default(''),

		visibility: text('visibility').$type<Visibility>().notNull().default('private'),
		/**
		 * Optional argon2 hash for a shareable client gallery. Independent of
		 * `visibility`: an unlisted collection can also carry a password.
		 */
		passwordHash: text('password_hash'),

		coverPhotoId: text('cover_photo_id'),

		/**
		 * Fractional ordering key. Reordering rewrites one row instead of
		 * renumbering the whole collection. See `lib/server/sort-key.ts`.
		 */
		sortKey: text('sort_key').notNull(),

		downloadsEnabled: integer('downloads_enabled', { mode: 'boolean' }).notNull().default(false),
		zipEnabled: integer('zip_enabled', { mode: 'boolean' }).notNull().default(false),
		/** Re-encode downloads to drop EXIF (notably GPS) from originals. */
		stripExifOnDownload: integer('strip_exif_on_download', { mode: 'boolean' })
			.notNull()
			.default(false),

		/** Allow-list of EXIF fields rendered publicly. */
		metadataFields: text('metadata_fields', { mode: 'json' })
			.$type<MetadataField[]>()
			.notNull()
			.default([]),

		publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`)
	},
	(t) => [
		// Slugs are unique per owner rather than globally, so introducing a second
		// artist later can't collide with the first one's slugs.
		uniqueIndex('collections_owner_slug_idx').on(t.ownerId, t.slug),
		index('collections_visibility_idx').on(t.visibility),
		index('collections_sort_idx').on(t.ownerId, t.sortKey)
	]
);

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export type PhotoStatus = 'pending' | 'processing' | 'ready' | 'failed';

/** Normalised EXIF. Extraction happens once at upload; this is the stored shape. */
export type PhotoExif = Partial<{
	camera: string;
	lens: string;
	focalLength: string;
	aperture: string;
	shutterSpeed: string;
	iso: number;
	takenAt: string;
	location: { lat: number; lon: number };
}>;

export const photos = sqliteTable(
	'photos',
	{
		id: text('id').primaryKey(),
		collectionId: text('collection_id')
			.notNull()
			.references(() => collections.id, { onDelete: 'cascade' }),

		/** Content-addressed path of the untouched upload. */
		storageKey: text('storage_key').notNull(),
		originalName: text('original_name').notNull(),
		contentType: text('content_type').notNull(),
		bytes: integer('bytes').notNull(),
		width: integer('width').notNull().default(0),
		height: integer('height').notNull().default(0),

		/** ThumbHash bytes, base64. ~25 bytes: inlined, so placeholders cost no request. */
		thumbhash: text('thumbhash'),
		dominantColor: text('dominant_color'),

		/**
		 * CRC-32 of the original, computed once during ingest. Storing it lets the
		 * ZIP endpoint emit STORE-mode entries with a known checksum, which is what
		 * makes an exact Content-Length (and therefore a real progress bar)
		 * possible without buffering the archive.
		 */
		crc32: integer('crc32'),

		/** Full extracted EXIF. Projected through the allow-list before it leaves the server. */
		exif: text('exif', { mode: 'json' }).$type<PhotoExif>(),

		caption: text('caption').notNull().default(''),
		altText: text('alt_text').notNull().default(''),

		sortKey: text('sort_key').notNull(),
		status: text('status').$type<PhotoStatus>().notNull().default('pending'),
		/** Populated when `status = 'failed'` so the admin UI can show a reason. */
		error: text('error'),

		createdAt: createdAt()
	},
	(t) => [
		index('photos_collection_sort_idx').on(t.collectionId, t.sortKey),
		// Drives the boot-time requeue of work interrupted by a restart.
		index('photos_status_idx').on(t.status)
	]
);

/**
 * Generated renditions. Kept in their own table (rather than a JSON blob on
 * `photos`) so a format can be added or re-encoded without rewriting photo rows,
 * and so serving a given width is a single indexed lookup.
 */
export const derivatives = sqliteTable(
	'derivatives',
	{
		id: text('id').primaryKey(),
		photoId: text('photo_id')
			.notNull()
			.references(() => photos.id, { onDelete: 'cascade' }),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		format: text('format').$type<'avif' | 'webp' | 'jpeg'>().notNull(),
		storageKey: text('storage_key').notNull(),
		bytes: integer('bytes').notNull()
	},
	(t) => [uniqueIndex('derivatives_photo_width_format_idx').on(t.photoId, t.width, t.format)]
);

// ---------------------------------------------------------------------------
// Legal / informational pages
// ---------------------------------------------------------------------------

export const LEGAL_SLUGS = ['terms', 'privacy'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/**
 * Operator-authored pages linked from the footer.
 *
 * Stored per install rather than shipped as fixed text: what a privacy policy
 * has to say depends entirely on who is running the gallery, where they are,
 * and what they actually collect. Shipping one would be wrong for almost every
 * operator, and worse, would look authoritative.
 *
 * A page with empty content is treated as absent — the footer doesn't link it
 * and the route 404s — so an install can never publish boilerplate its operator
 * hasn't read and agreed to.
 */
export const legalPages = sqliteTable('legal_pages', {
	slug: text('slug').$type<LegalSlug>().primaryKey(),
	title: text('title').notNull(),
	content: text('content').notNull().default(''),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`)
});

export type LegalPage = typeof legalPages.$inferSelect;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ one, many }) => ({
	profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
	collections: many(collections)
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
	owner: one(users, { fields: [collections.ownerId], references: [users.id] }),
	photos: many(photos)
}));

export const photosRelations = relations(photos, ({ one, many }) => ({
	collection: one(collections, {
		fields: [photos.collectionId],
		references: [collections.id]
	}),
	derivatives: many(derivatives)
}));

export const derivativesRelations = relations(derivatives, ({ one }) => ({
	photo: one(photos, { fields: [derivatives.photoId], references: [photos.id] })
}));

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Derivative = typeof derivatives.$inferSelect;
