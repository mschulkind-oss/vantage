# Working Directory Diffs

Design document for Vantage's uncommitted change (working directory diff) feature.

## Problem

Showing only committed diffs from git history leaves a blind spot: users can't see uncommitted changes — the most common state when actively editing files. Vantage surfaces working-directory diffs so that in-progress edits are visible alongside committed history.

## Design

### File Status Categories

Every file in the repo has one of these statuses (from `git status --porcelain`):

| Status | Meaning | Diff Source |
|--------|---------|-------------|
| `modified` | Tracked file with uncommitted changes | `git diff HEAD -- <path>` |
| `added` | New file staged for commit | `git diff HEAD -- <path>` |
| `deleted` | Tracked file deleted in working tree | `git diff HEAD -- <path>` |
| `untracked` | New file not yet tracked by git | Synthetic diff (all `+` lines) |
| `null` | Clean tracked file (no changes) | N/A |

### API

**`GET /api/git/status?path=<file>`** → `FileStatus`

Returns both the last commit touching this file AND the current working tree status:

```json
{
  "last_commit": {
    "hexsha": "abc123...",
    "author_name": "...",
    "date": "...",
    "message": "..."
  },
  "git_status": "modified"
}
```

**`GET /api/git/diff/working?path=<file>`** → `FileDiff`

Returns the uncommitted diff for a file. Uses a sentinel `commit_hexsha: "working"` to distinguish from committed diffs.

### Backend Implementation

In `git.GitService`:

- **`WorkingDiff(path)`**: Runs `git diff HEAD -- <path>` for tracked files. For untracked files, it generates a synthetic all-add diff where every line is a `+` (add) line, read straight from the file content.
- The diff is returned as a standard `model.FileDiff` with `commit_hexsha="working"` as a sentinel value.
- As with every git operation, the service shells out to the `git` binary with an explicit argument slice and degrades to an empty result rather than erroring on failure.

### Frontend Implementation

**ViewerPage header bar:**
- A green badge appears when a file has uncommitted changes (modified/added) or is untracked
- Clicking the badge opens the working directory diff in `DiffViewer`
- The existing commit SHA link still opens the last committed diff

**DiffViewer:**
- Detects working diffs via `diff.commit_hexsha === "working"`
- Shows a green header ("Uncommitted Changes") for working diffs vs amber for committed diffs
- No SHA displayed for working diffs

### Sentinel Value

We use `commit_hexsha: "working"` as a sentinel to distinguish working directory diffs from committed diffs. This avoids adding a separate field to the `FileDiff` model and is checked in both backend and frontend code.

## File Changes

```
internal/git/service.go                 # WorkingDiff() + untracked synthetic diff
internal/api/git_handlers.go            # GET /git/diff/working, /git/status
internal/model/models.go                # FileStatus.GitStatus, FileDiff sentinel
frontend/src/stores/useGitStore.ts      # fetchWorkingDiff(), fileGitStatus
frontend/src/types/index.ts             # FileStatus interface
frontend/src/pages/ViewerPage.tsx       # Modified badge, click handlers
frontend/src/components/DiffViewer.tsx   # Working diff header styling
```
