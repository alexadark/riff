/**
 * check-rls.ts
 *
 * Run the Supabase Database Linter rules that matter for multi-tenant safety
 * against the database pointed at by DATABASE_URL. Exits 1 if any rule fails.
 *
 * Rules covered:
 *   - rls_disabled_in_public: every table in `public` must have RLS enabled.
 *   - policy_exists_rls_disabled: policies present but RLS off → policies inert.
 *
 * Run locally: `pnpm check-rls`
 * Run in CI: scheduled daily + on push to main (see .github/workflows/db-lint.yml).
 */
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("[check-rls] DATABASE_URL is not set.");
	process.exit(1);
}

const sql = postgres(databaseUrl.replace(":6543/", ":5432/"), { max: 1 });

type LintRow = { name: string };

let failed = false;

try {
	const rlsDisabled = await sql<LintRow[]>`
		SELECT (n.nspname || '.' || c.relname) AS name
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind = 'r'
		  AND n.nspname = 'public'
		  AND NOT c.relrowsecurity
		ORDER BY name
	`;
	if (rlsDisabled.length > 0) {
		failed = true;
		console.error(`[check-rls] FAIL rls_disabled_in_public — ${rlsDisabled.length} table(s):`);
		for (const row of rlsDisabled) console.error(`  - ${row.name}`);
		console.error("");
		console.error('  Fix: add `ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;`');
		console.error("  to a Drizzle migration plus CREATE POLICY for each access pattern.");
	} else {
		console.log("[check-rls] OK rls_disabled_in_public — all public tables have RLS.");
	}

	const policyOnDisabledRls = await sql<LintRow[]>`
		SELECT DISTINCT (n.nspname || '.' || c.relname) AS name
		FROM pg_policy p
		JOIN pg_class c ON c.oid = p.polrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public'
		  AND NOT c.relrowsecurity
		ORDER BY name
	`;
	if (policyOnDisabledRls.length > 0) {
		failed = true;
		console.error(
			`[check-rls] FAIL policy_exists_rls_disabled — ${policyOnDisabledRls.length} table(s) have policies but RLS off (policies are inert):`,
		);
		for (const row of policyOnDisabledRls) console.error(`  - ${row.name}`);
	} else {
		console.log("[check-rls] OK policy_exists_rls_disabled — all policies are active.");
	}
} finally {
	await sql.end({ timeout: 5 });
}

if (failed) process.exit(1);
process.exit(0);
