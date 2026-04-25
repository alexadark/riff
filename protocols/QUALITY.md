# QUALITY

What every RIFF agent does AFTER code is written: doc verification, expertise capture, and post-agent code review checklist. Pair with [EXECUTION.md](./EXECUTION.md) (in-flight rules) and [MODEL.md](./MODEL.md) (model dispatch).

---

## 1. Doc Check (mandatory before planning or implementing)

Before planning or implementing any task that touches framework / library APIs:

1. Use `ref_search_documentation` to find current docs for the specific API
2. Use `ref_read_url` to read the relevant page
3. If Ref has no results, fall back to `npx ctx7 docs <library> <topic>` via Bash

**This is mandatory** even for well-known frameworks. Training data may not reflect recent API changes, removed features, or new patterns. A plan built on stale knowledge produces R3 deviations during execution.

---

## 2. Expertise Capture

Write lessons to `.planning/expertise/<agent>.md` after each phase.

### Format

```markdown
### [phase-N] Short title

- **What happened:** concrete situation (file, error, surprise)
- **Lesson:** what to do differently / what worked well
- **Impact:** HIGH | MEDIUM | LOW
```

### Rules

- Only write lessons a future fresh-context agent would benefit from
- Don't log routine successes — only surprises and recurring failures
- On FAIL: the lesson is mandatory
- On PASS with R1/R2 deviations: log what the plan missed
- Cap at 15 entries per file. When full: merge similar entries, drop LOW-impact ones
- If file doesn't exist, create from `templates/expertise.md`

---

## 3. Post-Agent Review Checklist

After every agent-generated code, check:

- [ ] Are modules deep? (simple interface, rich implementation)
- [ ] Any information leaks? (internal details exposed in exports)
- [ ] Any change amplification? (one change requires touching too many files)
- [ ] Does it follow hexagonal arch? (providers don't leak into services)
- [ ] Do I understand why each line exists? (no "programming by coincidence")
- [ ] Is there YAGNI code to remove?
- [ ] Tests exist and pass?
- [ ] Provider-agnostic? (no provider name in schema or service layer)
- [ ] Can any errors be eliminated by design? (branded types, narrower interfaces)
- [ ] Are barrel exports curated (not `export *`)?
- [ ] Would a new developer (or agent) understand the module boundary from `index.ts` alone?
