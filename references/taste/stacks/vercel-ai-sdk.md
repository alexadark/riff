---
description: Vercel AI SDK conventions for LLM streaming, structured output, and chat UIs
paths:
  - "**/app/routes/api/**/*.ts"
  - "**/app/lib/**/ai*.ts"
  - "**/app/lib/**/llm*.ts"
  - "**/*chat*.{ts,tsx}"
  - "**/*wizard*.{ts,tsx}"
---

# Taste Reference - Vercel AI SDK

> Apply when stack uses the Vercel AI SDK (`ai`, `@ai-sdk/*`). Default toolchain for any LLM streaming, chat UI, or structured-output call. Read on every task that touches model calls.
> API details / version-specific behavior beyond these rules: Context7 MCP `resolve-library-id("ai")` then `query-docs`. Don't rely on stale local docs.

## Why this is the default

Custom streaming code (raw `fetch()` + `ReadableStream` + provider-specific SDK) is a known anti-pattern. It hits framework gotchas (RR7 navigation-vs-data, see `react-router-7.md`), reimplements message format, leaks `Transfer-Encoding: chunked` issues on serverless edges, and breaks abort propagation. The AI SDK solves all of that. **Reach for the SDK before writing any custom streaming.**

## Core Rules

1. **Streaming endpoint = resource route + `streamText` + `toUIMessageStreamResponse`.** No default export, no UI rendering. The route accepts JSON `{ messages: UIMessage[] }`, calls `streamText({ model, system, messages: await convertToModelMessages(messages), abortSignal: request.signal })`, returns `result.toUIMessageStreamResponse()`. `convertToModelMessages` is async in v6 — `await` it or you get `Type 'Promise<...>' is missing properties from 'ModelMessage[]'`.

2. **Client streaming = `useChat` from `@ai-sdk/react` + `DefaultChatTransport`.** Never write a manual `fetch()` + `ReadableStream` reader. `useChat` handles message state, status (`ready` / `submitted` / `streaming` / `error`), abort via `stop()`, and parses the SDK's stream protocol. v5/v6 message format: `{ id, role, parts: [{ type: "text", text }] }`.

3. **Structured output = `generateObject` with Zod schema, not custom JSON parsing.** Replace `responseMimeType: "application/json"` + manual `JSON.parse(response.text)` + `Schema.parse(...)` with `generateObject({ model, schema: ZodSchema, system, prompt })`. The SDK validates against the schema and retries on bad JSON; you get a typed result for free.

4. **Provider with custom env var.** `@ai-sdk/google` defaults to `GOOGLE_GENERATIVE_AI_API_KEY`. If your project uses `GEMINI_API_KEY` (or any other), instantiate with `createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })`. Same pattern for `@ai-sdk/openai`, `@ai-sdk/anthropic`. Never read the env var inside `streamText` — instantiate the provider once at module top and inject the key.

5. **Abort signal flows from the request.** Pass `abortSignal: request.signal` to `streamText`. Client disconnect → server stops generating → no wasted tokens. `useChat`'s `stop()` cancels the request which cascades to `request.signal`.

6. **Rate limit BEFORE calling `streamText`.** Per-user bucket, return 429 early. The SDK doesn't rate-limit — that's your responsibility. In-memory `Map` is fine for serverless starter scale (resets on cold start). Move to Redis/Supabase before public launch.

## Server template (RR7 resource route)

```ts
// app/routes/api/<feature>/turn.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { type UIMessage, convertToModelMessages, streamText } from "ai";
import type { Route } from "./+types/turn";

export const maxDuration = 30; // Vercel: cap streaming duration

export async function action({ request }: Route.ActionArgs) {
  // 1. Auth
  // 2. Rate limit (return 429 early)
  // 3. Validate body
  const { messages }: { messages: UIMessage[] } = await request.json();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "server_misconfigured" }, { status: 500 });

  const google = createGoogleGenerativeAI({ apiKey });

  const result = streamText({
    model: google("gemini-3-flash-preview"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    abortSignal: request.signal,
  });

  return result.toUIMessageStreamResponse();
}
```

## Client template (`useChat`)

```tsx
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const { messages, sendMessage, status, error } = useChat({
  messages: initialMessages,
  transport: new DefaultChatTransport({ api: "/api/<feature>/turn" }),
});

const text = (m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
sendMessage({ text: input });
```

## Testing patterns

- **Mock `useChat` for component tests.** Stub the hook to return controlled `messages` / `status` / `error`. Tests then assert UI reactions to each state. Do NOT mock `fetch` and try to drive the real hook — that's testing the SDK, not your component.
- **Mock `streamText` for action tests.** Return an object with `toUIMessageStreamResponse: () => new Response(...)`. Assert auth, rate-limit, validation. Skip the actual streaming — that's the SDK's job.
- **Structural test for resource route.** `expect("default" in mod).toBe(false)`. Catches the regression where a future commit adds a default export and silently turns the route back into a UI route (see `react-router-7.md` rule 11).

## Anti-Pattern Checklist

| Found                                              | Replace with                                              |
| -------------------------------------------------- | --------------------------------------------------------- |
| Raw `fetch()` + `ReadableStream` reader on client  | `useChat` + `DefaultChatTransport`                        |
| Custom streaming generator (`async function*`)     | `streamText().toUIMessageStreamResponse()`                |
| Provider SDK direct (`@google/genai`, `openai`)    | `@ai-sdk/google`, `@ai-sdk/openai` via `streamText`       |
| `responseMimeType: "application/json"` + JSON.parse | `generateObject({ schema: ZodSchema })`                   |
| Streaming endpoint in route with `default` export  | Resource route under `app/routes/api/**/*.ts`             |
| `process.env.X_API_KEY` read inside the action     | `createXProvider({ apiKey })` at module top               |
| Hand-rolled rate limiter inside streaming function | Rate limit BEFORE `streamText`, return 429 early          |
| `convertToModelMessages(messages)` not awaited     | `await convertToModelMessages(messages)` (v6 returns Promise) |
| Manual `Transfer-Encoding: chunked` header         | `toUIMessageStreamResponse()` handles transport headers   |

## Gotchas

- **v6 breaking changes from v5.** `convertToModelMessages` is now async. Message format uses `parts: [{ type: "text", text }]`, not bare `content` strings. Server response is `toUIMessageStreamResponse()` (not the older `toDataStreamResponse()`). When migrating from v4/v5, expect both server and client rewrites.
- **`createXProvider` returns a function, not the model.** `const google = createGoogleGenerativeAI({ apiKey }); const model = google("gemini-3-flash-preview");`. Pass `model` (not `google`) to `streamText`.
- **`useChat` requires `transport` in v5+.** No more `api: "/path"` directly on the hook — it's on `new DefaultChatTransport({ api })`.
- **`DefaultChatTransport` is a class.** When mocking `ai` in tests, return an actual class (`class FakeTransport {}`) — `vi.fn().mockImplementation(() => ({}))` fails with "is not a constructor".
- **`streamText` returns a sync result, not a Promise.** No `await streamText(...)` — call `.toUIMessageStreamResponse()` directly. The streaming happens lazily as the response is consumed.
