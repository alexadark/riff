---
description: Send a message to a partner via the riff-board messages API
allowed-tools: Bash
args: "<recipient> <message text> [--from <name>] [--project <slug>]"
---

# /riff-board:msg

Send a one-off message to a partner on [riff-board](https://riff-boards.vercel.app) from any RIFF project, without opening the dashboard.

Usage:

```
/riff-board:msg ian check this PR
/riff-board:msg alex remember to update the roadmap tomorrow
/riff-board:msg ian --from alex ping when you're back
/riff-board:msg ian --project ai-interviewer bug on the recording flow
```

## What You Do

### Step 1: Parse `$ARGUMENTS`

`$ARGUMENTS` is the raw text after the command name. Parse it like this:

1. Look for a `--from <name>` pair anywhere in the arguments. If present, remove it from the string and remember `<name>` as the sender override. If absent, the sender defaults to `Alex` (the sole admin on the board).
2. Look for a `--project <slug>` pair anywhere in the arguments. If present, remove it and remember `<slug>` as the project override (Step 4 will use it directly, no inference).
3. Of what remains, the **first whitespace-separated token** is the recipient name (`to`).
4. **Everything after that first token** is the message body (`body`), verbatim — preserve spacing/punctuation, don't trim internal content, just strip leading/trailing whitespace.

If there's no recipient token or no body text, stop and ask the user for both — do not guess or send a partial message.

### Step 1.5: Rewrite the body

The body must always be sent in **English**, **direct**, and **in bullet points** when there is more than one idea. This is the standard partner comms format on the board — Ian scans it fast.

Rules:
- If the raw body is French (or franglais), translate to English silently. No preamble like "Here's the translation:".
- Drop filler and hedging: "je pense que", "peut-être", "il faudrait", "if you have time" — cut them.
- Split ideas into `-` bullets, one per line, when there are 2+ points. A single sentence stays a single sentence.
- Keep proper nouns, file paths, URLs, and technical terms untouched.
- Preserve intent and priority. Do not soften.

### Step 1.6: Preview if the input is long

Before sending, if the RAW dictated body is longer than ~30 words OR the rewrite in Step 1.5 changed the structure (translation, bullets, cuts), preview the final English body to the user in ONE block, then ask:

```
Preview → Ian [project: <slug or none>]:
- point 1
- point 2
- point 3

Send? (y/n)
```

Wait for confirmation. If `y` (or the user just says "vas-y", "envoie", "yes", "ok"), send. If `n` or the user proposes edits, apply the edits and re-preview. Do not send without confirmation on long or rewritten messages.

Short one-liner messages (no translation, no restructuring) can go directly to Step 5 without preview.

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

### Step 4: Determine the `project` slug

Rules, in order of precedence:

**A. Explicit override wins.** If Step 1 captured a `--project <slug>` value, use that verbatim. Skip the inference below.

**B. Infer from the current repo.** Otherwise, read the project slug from the local roadmap file. This is the same slug board-sync.mjs uses, so it will always match the board:

```bash
# Prefer ROADMAP-board.yaml (curated slice for board), fall back to ROADMAP.yaml.
for f in ROADMAP-board.yaml ROADMAP.yaml; do
  if [ -f "$f" ]; then
    # Extract board.slug if present, otherwise kebab-case the top-level `name:` value.
    slug=$(awk '
      /^board:/ { in_board=1; next }
      in_board && /^  slug:/ { gsub(/["'\''[:space:]]/, "", $2); print $2; exit }
      /^[^ ]/ && !/^board:/ { in_board=0 }
      /^name:/ && !name { gsub(/^name:[[:space:]]*/, ""); gsub(/["'\'']/, ""); name=$0 }
      END { if (!found && name) { gsub(/[^a-zA-Z0-9]+/, "-", name); print tolower(name) } }
    ' "$f")
    if [ -n "$slug" ]; then
      echo "detected project: $slug (from $f)"
      break
    fi
  fi
done
```

**C. No fallback to folder name.** If neither A nor B produced a slug, omit the `project` field entirely — do NOT guess from `basename $PWD`, because the folder name rarely matches the board slug (e.g. folder `ignite-search-web` maps to slug `authentic-video`). Wrong slug → 400. Better to send no project than the wrong one.

Report to the user in Step 6 which project (if any) was tagged, so ambiguity is always visible.

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

- Status `200` and `"ok":true` → tell the user in ONE line:
  - `from → to` (both names)
  - the project tag: either `[project: <slug>]` if one was sent, or `[no project]` if none — never leave this ambiguous
  - the source of the project value: `(explicit --project)`, `(from ROADMAP.yaml)`, or `(no project detected)` — so the user knows where it came from
- Anything else → surface the `error` field from the response verbatim, plus the HTTP status code. Do not retry automatically — most failures (unknown name, unknown project slug, bad token) need a human fix, not a retry.

Example success line:
```
Sent Alex → Ian [project: ai-interviewer] (from ROADMAP-board.yaml)
```
Or, without a project:
```
Sent Alex → Ian [no project] (no roadmap file in this repo)
```

## Anti-patterns

- Don't invent a `from`/`to` name that wasn't explicitly given or defaulted — if the recipient token is ambiguous, ask.
- Don't derive the project from `basename $PWD` — folder names don't match board slugs (see Step 4C).
- Don't guess a `project` slug when Step 4 produces nothing — omit the field instead of sending a wrong slug.
- Don't print the raw `RIFF_BOARD_MSG_TOKEN` value anywhere in output.
- Don't swallow a non-200 response as a soft success — a `400`/`401`/`403` means nothing was sent.
