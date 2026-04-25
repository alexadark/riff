#!/bin/bash
# RIFF Security Pre-Commit Hook
# Blocks commits containing common security issues
# Install: cp this to .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ISSUES_FOUND=0

# Get staged files (only check what's being committed)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo "RIFF Security Scan..."

# Check 1: Hardcoded secrets
echo -n "  Checking for hardcoded secrets... "
SECRET_PATTERNS=(
  'AKIA[0-9A-Z]{16}'                    # AWS Access Key
  'sk-[a-zA-Z0-9]{20,}'                 # OpenAI/Stripe secret key
  'sk_live_[a-zA-Z0-9]+'                # Stripe live key
  'ghp_[a-zA-Z0-9]{36}'                 # GitHub personal token
  'gho_[a-zA-Z0-9]{36}'                 # GitHub OAuth token
  'xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+'    # Slack bot token
  'password\s*[:=]\s*["\x27][^"\x27]+'  # Hardcoded passwords
  'secret\s*[:=]\s*["\x27][^"\x27]+'    # Hardcoded secrets
  'api[_-]?key\s*[:=]\s*["\x27][^"\x27]{10,}' # API keys
)

for file in $STAGED_FILES; do
  # Skip binary files, lock files, and test fixtures
  if [[ "$file" =~ \.(png|jpg|gif|ico|woff|woff2|ttf|eot|lock)$ ]] || \
     [[ "$file" =~ (test|spec|fixture|mock|__tests__) ]] || \
     [[ "$file" =~ ^\.planning/ ]] || \
     [[ "$file" =~ ^(docs|specs)/ && "$file" =~ \.md$ ]]; then
    continue
  fi

  for pattern in "${SECRET_PATTERNS[@]}"; do
    if git diff --cached "$file" | grep -qEi "$pattern" 2>/dev/null; then
      echo ""
      echo -e "  ${RED}BLOCKED: Possible secret in $file${NC}"
      echo "  Pattern: $pattern"
      ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
  done
done

if [ $ISSUES_FOUND -eq 0 ]; then
  echo "OK"
fi

# Check 2: console.log in production code
echo -n "  Checking for console.log... "
CONSOLE_FOUND=0
for file in $STAGED_FILES; do
  if [[ "$file" =~ \.(ts|tsx|js|jsx)$ ]] && \
     ! [[ "$file" =~ (test|spec|__tests__|scripts/) ]]; then
    if git diff --cached "$file" | grep -q '^\+.*console\.log' 2>/dev/null; then
      if [ $CONSOLE_FOUND -eq 0 ]; then
        echo ""
      fi
      echo -e "  ${YELLOW}WARNING: console.log in $file${NC}"
      CONSOLE_FOUND=$((CONSOLE_FOUND + 1))
    fi
  fi
done

if [ $CONSOLE_FOUND -eq 0 ]; then
  echo "OK"
fi

# Check 3: TypeScript 'any' type
echo -n "  Checking for 'any' types... "
ANY_FOUND=0
for file in $STAGED_FILES; do
  if [[ "$file" =~ \.(ts|tsx)$ ]] && \
     ! [[ "$file" =~ (test|spec|\.d\.ts) ]]; then
    if git diff --cached "$file" | grep -qE '^\+.*(:\s*any\b|as\s+any\b|<any>)' 2>/dev/null; then
      if [ $ANY_FOUND -eq 0 ]; then
        echo ""
      fi
      echo -e "  ${YELLOW}WARNING: 'any' type in $file${NC}"
      ANY_FOUND=$((ANY_FOUND + 1))
    fi
  fi
done

if [ $ANY_FOUND -eq 0 ]; then
  echo "OK"
fi

# Check 4: .env files being committed
echo -n "  Checking for .env files... "
for file in $STAGED_FILES; do
  if [[ "$file" =~ ^\.env ]] && ! [[ "$file" =~ \.example$ ]]; then
    echo ""
    echo -e "  ${RED}BLOCKED: .env file staged for commit: $file${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  fi
done

if [ $ISSUES_FOUND -eq 0 ]; then
  echo "OK"
fi

# Check 5: Commit scope (too many files = probably not atomic)
echo -n "  Checking commit scope... "
FILE_COUNT=$(echo "$STAGED_FILES" | wc -l | tr -d ' ')
if [ "$FILE_COUNT" -gt 15 ]; then
  echo ""
  echo -e "  ${YELLOW}WARNING: $FILE_COUNT files staged. Is this really one atomic task?${NC}"
  echo "  RIFF rule: every task ends in exactly one focused commit."
  CONSOLE_FOUND=$((CONSOLE_FOUND + 1))  # Count as warning
else
  echo "OK ($FILE_COUNT files)"
fi

# Check 6: Orphan files (new files not imported anywhere)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/orphan-file-check.sh" ]; then
  bash "$SCRIPT_DIR/orphan-file-check.sh"
fi

# Check 6b: REGISTRY.md staleness reminder
if [ -f "$SCRIPT_DIR/registry-reminder.sh" ]; then
  bash "$SCRIPT_DIR/registry-reminder.sh" || ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

# Check 6c: Migration gate (apply pending migrations when migration files are staged)
if [ -z "${RIFF_SKIP_MIGRATION_GATE:-}" ] && [ -f "$SCRIPT_DIR/migration-gate.sh" ]; then
  source "$SCRIPT_DIR/migration-gate.sh"
  ISSUES_FOUND=$((ISSUES_FOUND + $?))
fi

# Check 7: Tests pass
echo -n "  Running test suite... "
TEST_OUTPUT=$(npx vitest run 2>&1)
TEST_EXIT=$?
if [ $TEST_EXIT -ne 0 ]; then
  echo ""
  echo -e "  ${RED}BLOCKED: Tests failing${NC}"
  echo "$TEST_OUTPUT" | tail -10
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  echo "OK"
fi

# Final verdict
echo ""
if [ $ISSUES_FOUND -gt 0 ]; then
  echo -e "${RED}RIFF Security: $ISSUES_FOUND blocking issue(s) found. Commit rejected.${NC}"
  echo "Fix the issues above and try again."
  exit 1
else
  if [ $((CONSOLE_FOUND + ANY_FOUND)) -gt 0 ]; then
    echo -e "${YELLOW}RIFF Security: $((CONSOLE_FOUND + ANY_FOUND)) warning(s). Commit allowed.${NC}"
  else
    echo "RIFF Security: All clear."
  fi
  exit 0
fi
