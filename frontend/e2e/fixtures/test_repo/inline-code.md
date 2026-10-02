# Inline code that wraps

| The agent runs | What happens |
| :--- | :--- |
| `gh pr view 32`, `gh issue list`, `gh run view --log`, `gh workflow list`, `gh repo view`, `gh release list`, `gh api repos/OWNER/REPO/…` and other reads | It runs as if it ran on your machine. |
| A search whose words could reach another repository: a `repo:`, `org:`, `user:` or `owner:` in the query, a parenthesis, or the word `OR` or `NOT`, in `gh search`, or in `gh pr list`, `gh issue list` or `gh discussion list` with `--search` or a filter | Never runs. |

A paragraph with `gh pr view 32`, `gh issue list`, `gh run view --log`, `gh workflow list`, `gh repo view`, `gh release list`, `gh api repos/OWNER/REPO/…`, `gh pr comment`, `gh issue edit`, `gh pr merge` and `gh api -X POST …` runs over several lines.
