/**
 * check-safe-migration.ts
 *
 * Block destructive migrations from auto-applying in CI/Vercel build.
 *
 * Compares drizzle/meta/_journal.json against the __drizzle_migrations table
 * on the target database. For every pending migration it scans the SQL for
 * destructive patterns (DROP TABLE/COLUMN, TRUNCATE, DELETE FROM, RENAME,
 * ALTER COLUMN ... TYPE). On match, exits 1 so the build fails and the
 * migration must be applied manually.
 *
 * A migration can opt out of the destructive guard with the comment marker
 * `-- @riff:reviewed` on a line of its own. Use sparingly: it's a signed
 * promise that the destructive op was reviewed and is safe to auto-apply.
 *
 * Wire-up (in package.json):
 *   "db:check-safe": "tsx scripts/check-safe-migration.ts",
 *   "vercel-build": "npm run db:check-safe && npm run db:migrate && npm run build"
 *
 * Requires: postgres (already a runtime dep when using drizzle + postgres.js).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DESTRUCTIVE_PATTERNS: { name: string; regex: RegExp }[] = [
	{ name: "DROP TABLE", regex: /\bDROP\s+TABLE\b/i },
	{ name: "DROP COLUMN", regex: /\bDROP\s+COLUMN\b/i },
	{ name: "DROP SCHEMA", regex: /\bDROP\s+SCHEMA\b/i },
	{ name: "TRUNCATE", regex: /\bTRUNCATE\b/i },
	{ name: "DELETE FROM", regex: /\bDELETE\s+FROM\b/i },
	{ name: "RENAME", regex: /\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b/i },
	{ name: "ALTER COLUMN ... TYPE", regex: /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i },
	{ name: "ALTER TABLE ... DROP CONSTRAINT", regex: /\bALTER\s+TABLE\b[\s\S]*?\bDROP\s+CONSTRAINT\b/i },
];

const REVIEWED_MARKER = /^--\s*@riff:reviewed\b/m;

type JournalEntry = { idx: number; tag: string; when: number };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("[check-safe-migration] DATABASE_URL is not set, skipping check.");
	process.exit(0);
}

const drizzleDir = join(process.cwd(), "drizzle");
const journal = JSON.parse(readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
	entries: JournalEntry[];
};

const sql = postgres(databaseUrl.replace(":6543/", ":5432/"), { max: 1 });

try {
	const tableExists = await sql<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_schema = 'drizzle'
			  AND table_name = '__drizzle_migrations'
		) AS exists
	`;

	let appliedCount = 0;
	if (tableExists[0]?.exists) {
		const rows = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`;
		appliedCount = Number.parseInt(rows[0]?.count ?? "0", 10);
	}

	const issues: string[] = [];
	let pendingCount = 0;

	for (const entry of journal.entries) {
		if (entry.idx < appliedCount) continue;

		const sqlPath = join(drizzleDir, `${entry.tag}.sql`);
		let body: string;
		try {
			body = readFileSync(sqlPath, "utf8");
		} catch {
			continue;
		}
		pendingCount++;

		if (REVIEWED_MARKER.test(body)) continue;

		for (const { name, regex } of DESTRUCTIVE_PATTERNS) {
			if (regex.test(body)) {
				issues.push(`  ${entry.tag}.sql: ${name}`);
				break;
			}
		}
	}

	if (issues.length > 0) {
		console.error("[check-safe-migration] BLOCKED — destructive SQL in pending migrations:");
		console.error(issues.join("\n"));
		console.error("");
		console.error("Apply manually after review, or add `-- @riff:reviewed` at the top of");
		console.error("the migration to allow auto-apply.");
		process.exit(1);
	}

	console.log(`[check-safe-migration] OK (${pendingCount} pending migration(s), all non-destructive)`);
	process.exit(0);
} finally {
	await sql.end({ timeout: 5 });
}
