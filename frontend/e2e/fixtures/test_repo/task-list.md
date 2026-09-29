# Task list fixture

Fixture for `task_list.spec.ts`, which measures where the task-list stylesheet
puts a checkbox, over the real app.

- [ ] open task
- [x] done task
  - [ ] nested open
  - [x] nested done

The list below is written by hand, with the class GFM puts on a task's item.
The item's style asks for no box of its own, and a 600px font size that makes
its checkbox a 630px square. The sanitizer refuses `display: contents` now, so
the item keeps its box and the style goes. One test puts the style back from a
script, past the sanitizer, to measure the stylesheet's own guard. Nothing the
item holds may leave the scroll container either way.

<ul id="boxless"><li class="task-list-item" style="display:contents;font-size:600px"><input type="checkbox" checked disabled>x</li></ul>

The spacer below keeps the document scrollable past the list, however the list
lays out.

<div style="height:3000px"></div>

The end of the document.
