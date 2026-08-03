import { defineConfig } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Each run gets a fresh install in a temporary directory, so tests never see
 * data left by a previous run and never touch a development database.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'vitrine-e2e-'));
process.on('exit', () => rmSync(DATA_DIR, { recursive: true, force: true }));

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	/**
	 * The transition depends on layout and image decoding, which are timing
	 * sensitive; running files in parallel against one seeded server would make
	 * failures hard to attribute.
	 */
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	use: { baseURL: 'http://localhost:4173' },

	// Seeds over HTTP once the server is up. Playwright starts `webServer` before
	// global setup, so the endpoints are already listening.
	globalSetup: './e2e/global-setup.ts',

	webServer: {
		command: 'npm run build && node build/index.js',
		port: 4173,
		reuseExistingServer: false,
		timeout: 180_000,
		env: {
			DATA_DIR,
			PORT: '4173',
			ORIGIN: 'http://localhost:4173',
			ADMIN_EMAIL: 'e2e@test.com',
			ADMIN_PASSWORD: 'bootstrappassword',
			// WebP alone keeps seeding fast; AVIF encoding would dominate the run
			// without testing anything the transition cares about.
			IMAGE_FORMATS: 'webp',
			WORKER_CONCURRENCY: '4'
		}
	}
});
