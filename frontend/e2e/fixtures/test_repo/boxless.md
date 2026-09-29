# Boxless fixture

Fixture for `boxless.spec.ts`, which measures, over the real app, that nothing
a stylesheet positions against a document's element leaves the document's
scroll container when that element is written with no box of its own.

The paragraph and the heading below are written by hand. Each carries the tone
a `<!-- vantage: block tone=… -->` directive stamps, and a style that asks for
no box. The tone's rule is a `::before` placed against the element it belongs
to, and the heading's link anchor is placed against the heading.

<div style="height:300px"></div>

<p id="boxless-paragraph" data-vantage-tone="important" style="display:contents">A toned paragraph with no box.</p>

<h2 id="boxless-heading" data-vantage-tone="caution" style="display:contents;font-size:200px">H</h2>

The spacer below keeps the document scrollable past both, however they lay
out.

<div style="height:3000px"></div>

The end of the document.
