---
description: Send a message to a partner via the riff-board messages API
allowed-tools: Bash
args: "<recipient> <message text> [--from <name>]"
---

# /riff-board:msg

Send a one-off message to a partner on [riff-board](https://riff-boards.vercel.app) from any RIFF project, without opening the dashboard.

Usage:

```
/riff-board:msg ian check this PR
/riff-board:msg alex remember to update the roadmap tomorrow
/riff-board:msg ian --from alex ping when you're back
```

## What You Do

### Step 1: Parse `$ARGUMENTS`

`$ARGUMENTS` is the raw text after the command name. Parse it like this:

1. Look for a `--from <name>` pair anywhere in the arguments. If present, remove it from the string and remember `<name>` as the sender override. If absent, the sender defaults to `Alex` (the sole admin on the board).
2. Of what remains, the **first whitespace-separated token** is the recipient name (`to`).
3. **Everything after that first token** is the message body (`body`), verbatim — preserve spacing/punctuation, don't trim internal content, just strip leading/trailing whitespace.

If there's no recipient token or no body text, stop and ask the user for both — do not guess or send a partial message.

### Step 2: Read the required env vars

Run:

```bash
echo "RIFF_BOARD_URL=$RIFF_BOARD_URL"
echo "RIFF_BOARD_MSG_TOKEN=${RIFF_BOARD_MSG_TOKEN:+set}"
```

(The token is only echoed as `set`/empty so it never appears in plaintext in the transcript.)

If **either** `RIFF_BOARD_URL` or `RIFF_BOARD_MSG_TOKEN` is empty, stop and tell the user to add both to `~/.zshrc`, then restart their shell (or `source ~/.zshrc`) and re-run the command:

```bash
export RIFF_BOARD_URL="https://riff-boards.vercel.app"
export RIFF_BOARD_MSG_TOKEN="..."   # the MESSAGES_API_TOKEN value from the board's Vercel env
```

Do not attempt the request without both values set.

### Step 3: Determine `from`

- Default: `Alex`.
- If the user passed `--from <name>` in Step 1, capitalize the first letter of `<name>` and use that instead (e.g. `--from ian` → `Ian`).

### Step 4: Infer the `project` field (best effort, optional)

1. Get the current directory's folder name:
   ```bash
   basename "$PWD"
   ```
2. Kebab-case it (lowercase, spaces/underscores → hyphens, strip anything that isn't `a-z0-9-`, collapse repeats, trim leading/trailing hyphens).
3. Sanity-check it looks like a real RIFF project slug — e.g. the current directory has a `.riff/` symlink or a `ROADMAP.yaml`:
   ```bash
   test -e .riff && echo "riff-project" || echo "not-a-riff-project"
   ```
4. If it looks like a RIFF project, include the kebab-cased slug as `project` in the request body. Otherwise, **omit** the `project` field entirely (do not send an empty string or a guess) — the board treats project as optional, and a wrong slug will make the whole request fail with a 400.

### Step 5: Send the message

```bash
curl -sS -w '\n%{http_code}' -X POST "$RIFF_BOARD_URL/api/messages" \
  -H "Authorization: Bearer $RIFF_BOARD_MSG_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"from":"Alex","to":"Ian","body":"check this PR","project":"riff-board"}'
```

Substitute the real `from`, `to`, `body`, and `project` (or omit `project` per Step 4) values you resolved above. Escape any `"`, `\`, or newlines inside `body` so the JSON stays valid. The `-w '\n%{http_code}'` appends the HTTP status code on its own line so you can tell success from failure without a second call.

#### API contract (for reference — don't assume, this is authoritative)

`POST ${RIFF_BOARD_URL}/api/messages`

Headers: `Authorization: Bearer ${RIFF_BOARD_MSG_TOKEN}`, `Content-Type: application/json`.

Request body:

```json
{
  "from": "Alex",
  "to": "Ian",
  "body": "check this PR",
  "project": "riff-board"
}
```

- `from` (string, required) — sender's display name on the board. Matched case-insensitively against existing users; unknown names are rejected.
- `to` (string, required) — recipient's display name, same matching rule.
- `body` (string, required, 1-5000 chars) — the message text.
- `project` (string, optional) — a project **slug** (not display name). If given, it must match an existing project on the board or the request is rejected.

Response, success (`200`):

```json
{ "ok": true, "id": "..." }
```

Response, failure (`400`, `401`, `403`, or `405`):

```json
{ "ok": false, "error": "..." }
```

Common failure reasons: missing/wrong bearer token (`401`), unknown `from`/`to` name (`400`), unknown `project` slug (`400`), sender and recipient aren't both admin and don't share project access (`403`).

### Step 6: Report the result

Parse the last line of the curl output as the HTTP status code and everything before it as the JSON body.

- Status `200` and `"ok":true` → tell the user the message was sent, to whom, and (if set) which project it was tagged with.
- Anything else → surface the `error` field from the response verbatim, plus the HTTP status code. Do not retry automatically — most failures (unknown name, unknown project slug, bad token) need a human fix, not a retry.

## Anti-patterns

- Don't invent a `from`/`to` name that wasn't explicitly given or defaulted — if the recipient token is ambiguous, ask.
- Don't guess a `project` slug when Step 4's check fails — omit the field instead of sending a wrong slug.
- Don't print the raw `RIFF_BOARD_MSG_TOKEN` value anywhere in output.
- Don't swallow a non-200 response as a soft success — a `400`/`401`/`403` means nothing was sent.
