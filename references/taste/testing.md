# Taste Reference - Testing

> Source: SignalFinder taste.md (RR7 + Drizzle + Supabase + Hexagonal).

## Rules

1. **Test-first for services.** Backend services get tests BEFORE implementation (red-green-refactor). TDD vertical: test calling service + checking DB result beats mocking DB. Front-end routes: Playwright E2E, not unit tests on loaders. (Beck)
