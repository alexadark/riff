# Execution protocol

This protocol defines shared execution behavior. The active stage runner and its ordering are defined by `protocols/RIFF-NEXT.md`; the operator view is `docs/RIFF-MANUAL.md`.

## Before work

1. Confirm a bounded outcome, permitted surfaces, exclusions, and checks.
2. Inspect the relevant project files before proposing changes.
3. Use existing project tooling and conventions where they fit the request.
4. Stop for a material ambiguity, unsafe boundary, or missing acceptance condition.

## During work

- Treat the validated plan's ownership and smoke commands as the execution boundary.
- Make only changes required by the assigned task. An incidental import does not expand ownership.
- Record a small obvious correction as a deviation in the summary.
- Stop and surface an architectural change rather than quietly broadening the plan.
- Capture a genuinely out-of-scope idea as follow-up work; do not build it in the current stage.

## Evidence and completion

Completion requires the runner's validated plan, worker outcome, mechanical gates, boundary check, independent review, repeated mechanics, and persisted state. A worker claim alone is never completion evidence.

The native runner executes declared waves in order and preserves staged output between waves. It does not treat a wave declaration as permission for concurrent mutation.

## Legacy Claude command workflow

Historical command-era instructions for inline planning, sub-agent fan-out, named model selection, external delegation, scratch shortcuts, or conversational promotion are not part of the native execution protocol. Use them only when deliberately operating that legacy command workflow, and keep its runtime details out of shared execution instructions.

### 1. Confidence Gate

Compatibility anchor only. Legacy commands own their own confidence prompt behavior.

### Step 4 planner orchestration

Compatibility anchor only. Native planning is specified by `protocols/RIFF-NEXT.md`.

### Step 4b plan adversarial review

Compatibility anchor only. Native review is specified by `protocols/RIFF-NEXT.md`.

### Step 5 executor orchestration

Compatibility anchor only. Native worker dispatch is adapter-owned.

### Step 5b simplifier orchestration

Compatibility anchor only. It is not a native transition.

### Project Scope

Compatibility anchor only. Native scope is the explicit bounded request and validated plan boundary.
