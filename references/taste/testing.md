# Taste Reference - Testing

> Source: SignalFinder taste.md (React Router 7 + Drizzle + Supabase + Hexagonal Architecture)

## Rules

1. **Test-first for services** - Backend services get tests BEFORE implementation (red-green-refactor). TDD should be vertical - a test that calls the service and checks the DB result is better than mocking the DB. Front-end routes get tested via Playwright E2E, not unit tests on loaders. (Beck)
