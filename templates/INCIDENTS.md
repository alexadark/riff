# Production Incidents

Log every production incident here. Ask Claude to "log incident" or "incident review" — see `protocols/INCIDENT.md` for the full flow. Quarterly review translates these into framework rules.

## Format

Each entry:

- `## YYYY-MM-DD — short title`
- **Phase:** N (slug from ROADMAP)
- **Miss type:** `security-reviewer` | `adversarial-reviewer` | `taste rule` | `test gap` | `external API change` | `other`
- **Severity:** `critical` | `high` | `medium` | `low`
- **What happened:** 2-3 sentences
- **Root cause:** 1-2 sentences
- **Prevention rule:** what change to `taste.md` / agent / hook would have caught this

---

## 2026-01-15 — Example: invitation token replay

- **Phase:** 94 (auth-invites)
- **Miss type:** security-reviewer
- **Severity:** high
- **What happened:** Expired invite tokens could be reused after the expiry timestamp because the `consumeInvite` query ignored the `expires_at` column.
- **Root cause:** Sonnet security reviewer scanned for "expired" string but missed the SQL clause omission. Adversarial Codex caught it on re-run.
- **Prevention rule:** Add to `taste/security.md`: any invite/reset/share token query MUST filter on both `consumed_at IS NULL` AND `expires_at > NOW()`. Add adversarial trigger on `consumeInvite` / `consumeReset` / `consumeShare` patterns.
