# Keyboard Shortcuts

Vantage supports keyboard shortcuts for fast navigation. Press `?` at any time to see the full list in-app.

## Global Shortcuts

| Key       | Action                                                        |
| --------- | ------------------------------------------------------------- |
| `?`       | Show keyboard shortcuts help                                  |
| `t`       | Open the fuzzy file picker (current project)                  |
| `Shift+T` | Search files across all projects                              |
| `r`       | Recently changed files (current project)                      |
| `Shift+R` | Recently changed files (all projects)                         |
| `Shift+P` | Open the project picker to switch repos                       |
| `b`       | Toggle the sidebar                                            |
| `h`       | Open commit history for the current file                      |
| `d`       | View the latest diff for the current file                     |
| `y`       | Copy the absolute file path to clipboard                      |
| `Shift+D` | Toggle dark mode                                              |
| `j`       | Scroll down                                                   |
| `k`       | Scroll up                                                     |
| `g g`     | Scroll to the top of the page                                 |
| `Shift+G` | Scroll to the bottom of the page                              |
| `g h`     | Go to the home page (root directory)                          |
| `g r`     | Go to recent files page                                       |
| `Escape`  | Close any open modal (file picker, diff viewer, diagram zoom) |

Two-key sequences (like `g g`) have an 800ms timeout — press both keys in quick succession.

## File Picker

When the file picker is open:

| Key           | Action                           |
| ------------- | -------------------------------- |
| Type anything | Filter files with fuzzy matching |
| `↑` / `↓`     | Move through the results         |
| `Enter`       | Open the selected file           |
| `Escape`      | Close the picker                 |

The file picker uses fuzzy matching — you don't need to type the exact filename. For example, typing `gstart` would match `getting-started.md`.

## Recently Changed Files

`r` and `Shift+R` open the same list of recently changed files, with who changed
each one, in which commit, and when. `r` lists the current project's; `Shift+R`
lists every project's, with each file's project shown beside its folder. When
the list is open:

| Key                         | Action                                 |
| --------------------------- | -------------------------------------- |
| `↑` / `↓`                   | Move through the files                 |
| `Enter`                     | Open the highlighted file              |
| `Alt+Enter` or `Ctrl+Enter` | Open the highlighted file in a new tab |
| `Escape`                    | Close the list                         |

## Mermaid Diagrams

Click the maximize button (↗) on any Mermaid diagram to view it at full size in a modal. Press `Escape` to close.
