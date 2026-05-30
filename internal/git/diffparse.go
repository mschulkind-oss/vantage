package git

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/mschulkind-oss/vantage/internal/model"
)

// hunkHeaderRe matches a unified-diff hunk header like "@@ -1,5 +1,7 @@",
// capturing the old and new starting line numbers. The optional ",count" parts
// are tolerated but not captured.
var hunkHeaderRe = regexp.MustCompile(`^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@`)

// intPtr returns a pointer to a copy of n, for the *int line-number fields.
func intPtr(n int) *int { return &n }

// parseDiff turns raw "git diff" output into a slice of [model.DiffHunk].
//
// Each hunk begins with an "@@ … @@" header line, which is emitted as a
// DiffLine of type "header" with both line numbers null. Subsequent lines are
// classified by their leading character:
//
//   - "+" ⇒ "add"     (new_line_no set, old_line_no null)
//   - "-" ⇒ "delete"  (old_line_no set, new_line_no null)
//   - " " or empty ⇒ "context" (both line numbers set)
//
// Line numbers advance from the header's starting positions. Lines before the
// first header (the "diff --git"/"index"/"---"/"+++" preamble) are ignored,
// matching the behavior of the original parser: classification only begins once
// a header has been seen and current lines exist.
func parseDiff(rawDiff string) []model.DiffHunk {
	var hunks []model.DiffHunk
	var currentLines []model.DiffLine
	var currentHeader string
	oldLineNo := 0
	newLineNo := 0

	for _, line := range strings.Split(rawDiff, "\n") {
		switch {
		case strings.HasPrefix(line, "@@"):
			if len(currentLines) > 0 {
				hunks = append(hunks, model.DiffHunk{Header: currentHeader, Lines: currentLines})
			}
			currentHeader = line
			currentLines = nil

			if m := hunkHeaderRe.FindStringSubmatch(line); m != nil {
				// Errors are impossible: the regex only matches digit runs.
				oldLineNo, _ = strconv.Atoi(m[1])
				newLineNo, _ = strconv.Atoi(m[2])
			}

			currentLines = append(currentLines, model.DiffLine{
				Type:      "header",
				Content:   line,
				OldLineNo: nil,
				NewLineNo: nil,
			})
		case len(currentLines) > 0:
			switch {
			case strings.HasPrefix(line, "+"):
				currentLines = append(currentLines, model.DiffLine{
					Type:      "add",
					Content:   line[1:],
					OldLineNo: nil,
					NewLineNo: intPtr(newLineNo),
				})
				newLineNo++
			case strings.HasPrefix(line, "-"):
				currentLines = append(currentLines, model.DiffLine{
					Type:      "delete",
					Content:   line[1:],
					OldLineNo: intPtr(oldLineNo),
					NewLineNo: nil,
				})
				oldLineNo++
			case strings.HasPrefix(line, " ") || line == "":
				content := line
				if strings.HasPrefix(line, " ") {
					content = line[1:]
				}
				currentLines = append(currentLines, model.DiffLine{
					Type:      "context",
					Content:   content,
					OldLineNo: intPtr(oldLineNo),
					NewLineNo: intPtr(newLineNo),
				})
				oldLineNo++
				newLineNo++
			}
		}
	}

	if len(currentLines) > 0 {
		hunks = append(hunks, model.DiffHunk{Header: currentHeader, Lines: currentLines})
	}

	return hunks
}
