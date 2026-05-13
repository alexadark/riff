# Taste Reference - Testing

> Source: SignalFinder taste.md (RR7 + Drizzle + Supabase + Hexagonal).

## Rules

1. **Test-first for services.** Backend services get tests BEFORE implementation (red-green-refactor). TDD vertical: test calling service + checking DB result beats mocking DB. Front-end routes: Playwright E2E, not unit tests on loaders. (Beck)

2. **Testing DB-level concurrency without a Postgres harness.** Acceptance criteria asks for "N parallel calls hit the DB simultaneously" but the test suite mocks `~/lib/db` (no in-memory Postgres, no testcontainers). Honest substitute, in three parts:

   1. **Application-layer simulation.** Sequential loop of N calls where the mock flips outcome per iteration (1 success → N-1 conflicts). Asserts response shape + the conflict-handling branch executes. Does NOT prove DB-level serialization.
   2. **Migration-text assertion.** Read the migration SQL from disk in a test and `expect(sql).toContain(...)` the partial unique index / CHECK constraint that enforces the invariant. Proves the DDL ships, not the runtime behavior.
   3. **SUMMARY.md note.** Document the harness gap explicitly: "True concurrent DB test deferred until a Postgres harness exists. The atomic property is enforced by the index from migration X, asserted via migration-text test Y."

   Anti-pattern: pretending a mocked sequential test proves concurrent atomicity. Reviewers should flag it. Real concurrent tests need testcontainers or a dedicated test DB — open a seed file when the project hits the harness wall, don't paper over it.
