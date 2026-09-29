# TOC cover fixture

Fixture for the "keeps the table of contents above the document" test in
`toc.spec.ts`. The table of contents is the app's, but it sits inside the
document's scroll container, so a block of the document carried over it by a
negative margin could paint over it and take its clicks. Each block below
tries, after the headings the table of contents lists. Every one of them paints
in the layer a positioned box paints in: one by its `opacity`, one because a
toned block's rule is placed inside it, one because every heading is
positioned, and one as a link.

## Alpha

## Beta

## Gamma

<div style="opacity:0.99;margin-left:-3000px;margin-top:-600px;width:6000px;height:3000px;background-color:white">An opaque sheet.</div>

<p data-vantage-tone="note" style="margin-left:-3000px;margin-top:-3000px;width:6000px;height:3000px;background-color:white">A toned sheet.</p>

<h4 style="margin-left:-3000px;margin-top:-3000px;width:6000px;height:3000px;background-color:white">A heading sheet</h4>

<a href="https://toc-cover.example.invalid/phish" style="display:block;opacity:0.99;margin-left:-3000px;margin-top:-3000px;width:6000px;height:3000px;background-color:white">Session expired. Sign in again.</a>
