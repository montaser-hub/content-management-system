import { config } from 'dotenv';
import { resolve } from 'node:path';

// Runs once before the e2e test file is loaded (see jest-e2e.json's
// setupFiles) — points every test at the dedicated cms_test_db database
// instead of whatever DATABASE_URL happens to be set in the shell.
// quiet: true — dotenv 17 prints a random promotional "tip" line (for the
// maintainer's other products) on every load otherwise; irrelevant noise in
// a test log.
config({ path: resolve(__dirname, '../.env.test'), quiet: true });
