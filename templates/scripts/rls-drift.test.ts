// @vitest-environment node
/**
 * rls-drift.test.ts — drop into any Supabase project's `test:rls` suite.
 *
 * Two failure modes this catches that "is RLS on?" linters miss:
 *   1. A public table with RLS disabled (relrowsecurity = false) → world-readable
 *      through PostgREST.
 *   2. GRANT drift — a `GRANT … TO anon/authenticated/PUBLIC` that re-exposes a
 *      table you assumed was locked down. RLS on + a broad GRANT still leaks if
 *      the policy is permissive or the role is the table owner.
 *
 * The allowlist is the spec: declare exactly which grants anon/authenticated are
 * *allowed* to hold. Anything granted beyond it fails the test, so widening the
 * surface is a deliberate, reviewable diff to this file — never a silent prod drift.
 *
 * Wire-up (package.json):  "test:rls": "vitest run scripts/rls-drift.test.ts"
 * Needs DATABASE_URL. Skips (does not fail) when it's unset, so it's safe in CI
 * jobs that don't provision a database.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

type Role = "anon" | "authenticated" | "PUBLIC";
type Privilege =
	| "SELECT"
	| "INSERT"
	| "UPDATE"
	| "DELETE"
	| "TRUNCATE"
	| "REFERENCES"
	| "TRIGGER";

/**
 * Tables (qualified `schema.table`) that anon/authenticated may reach, and with
 * which privileges. Omit a role to deny it entirely. Omit a table to deny all
 * roles on it. Keep this tight — every entry is attack surface you accept.
 *
 * Example:
 *   "public.organizations": { authenticated: ["SELECT"] },
 *   "public.public_invites": { anon: ["SELECT"], authenticated: ["SELECT"] },
 */
const GRANT_ALLOWLIST: Partial<Record<string, Partial<Record<Role, Privilege[]>>>> = {};

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("RLS + grants drift", () => {
	// Supabase pooler runs on 6543 (transaction mode, no advisory locks); use the
	// 5432 direct port for catalog reads — same swap as check-rls.ts.
	const sql = postgres((databaseUrl as string).replace(":6543/", ":5432/"), {
		max: 1,
	});

	afterAll(async () => {
		await sql.end({ timeout: 5 });
	});

	it("every public table has RLS enabled", async () => {
		const rows = await sql<{ name: string }[]>`
			SELECT (n.nspname || '.' || c.relname) AS name
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relkind = 'r'
			  AND n.nspname = 'public'
			  AND NOT c.relrowsecurity
			ORDER BY name
		`;
		const unprotected = rows.map((r) => r.name);
		expect(
			unprotected,
			`Public tables with RLS OFF (world-readable via PostgREST):\n  ${unprotected.join("\n  ")}\n` +
				`Fix: ALTER TABLE … ENABLE ROW LEVEL SECURITY in a migration, plus policies.`,
		).toEqual([]);
	});

	it("no anon/authenticated/PUBLIC grant outside the allowlist", async () => {
		const grants = await sql<{ table: string; role: Role; privilege: Privilege }[]>`
			SELECT (table_schema || '.' || table_name) AS table,
			       grantee AS role,
			       privilege_type AS privilege
			FROM information_schema.role_table_grants
			WHERE table_schema = 'public'
			  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
			ORDER BY table, role, privilege
		`;

		const violations = grants
			.filter((g) => !GRANT_ALLOWLIST[g.table]?.[g.role]?.includes(g.privilege))
			.map((g) => `${g.table} → ${g.role} ${g.privilege}`);

		expect(
			violations,
			`GRANT drift — privileges held outside GRANT_ALLOWLIST:\n  ${violations.join("\n  ")}\n` +
				`Either REVOKE them in a migration, or add them to GRANT_ALLOWLIST if intended.`,
		).toEqual([]);
	});
});
