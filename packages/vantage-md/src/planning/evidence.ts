/**
 * Evidence the scanner reads once so no client has to parse a document itself:
 * a question unit's source fingerprint (the one the server computes and checks,
 * `internal/review/observation.go` `BuildUnit`), the ids a Decision Ledger's
 * first column holds, and the hashes of a document's anchorable blocks.
 */
import type { Nodes, Root, RootContent } from "mdast";
import { VANTAGE_OQ_ID } from "../vantageDirectives.js";

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/**
 * SHA-256 of `text` as UTF-8, synchronously (WebCrypto is async and absent on
 * an insecure origin), as the first 128 bits in 32 lowercase hex digits: the
 * server's `review.ContentHash`.
 */
export function contentHash(text: string): string {
  const data = new TextEncoder().encode(text);
  const padded = new Uint8Array((((data.length + 9 + 63) >> 6) << 6) >>> 0);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          (K[i] ?? 0) +
          (w[i] ?? 0)) >>>
        0;
      const t2 =
        ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => {
      h[i] = ((h[i] ?? 0) + v) >>> 0;
    });
  }
  return Array.from(h.subarray(0, 4), (v) =>
    v.toString(16).padStart(8, "0"),
  ).join("");
}

/**
 * The fingerprint of the unit on file lines `startLine`..`endLine` (1-based,
 * inclusive) of `source`: the hash of those lines, each less a trailing CR,
 * joined by "\n". The server computes the same from the file
 * (`review.BuildUnit`), and a client sends this as `unit_fingerprint`.
 */
export function unitFingerprint(
  source: string,
  startLine: number,
  endLine: number,
): string {
  const lines = source.split("\n").map((l) => l.replace(/\r$/, ""));
  if (startLine < 1 || endLine < startLine || endLine > lines.length) return "";
  return contentHash(lines.slice(startLine - 1, endLine).join("\n"));
}

/** FNV-1a over UTF-16 code units' low bytes: a comment anchor's block hash. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The hash a comment anchor stores for a block whose visible text is `text`. */
export function blockTextHash(text: string): string {
  return fnv1a(text.replace(/\s+/gu, " ").trim().toLowerCase());
}

const LEDGER_HEADING = /^decision ledger\s*$/i;

/**
 * The ids in the first column of every table under a heading named "Decision
 * Ledger" (to the next heading of the same or a higher level): what a
 * compacted question leaves. Unique, in order.
 */
export function ledgerIds(root: Root, textOf: (n: Nodes) => string): string[] {
  const ids = new Set<string>();
  let depth: number | undefined;
  for (const node of root.children as RootContent[]) {
    if (node.type === "heading") {
      if (depth !== undefined && node.depth <= depth) depth = undefined;
      if (depth === undefined && LEDGER_HEADING.test(textOf(node).trim())) {
        depth = node.depth;
      }
      continue;
    }
    if (depth === undefined || node.type !== "table") continue;
    for (const row of node.children.slice(1)) {
      const cell = row.children[0];
      const id = cell === undefined ? "" : textOf(cell).trim();
      if (VANTAGE_OQ_ID.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Each anchorable block's hash against the file line it starts on, or 0 where
 * the same hash is held by more than one block: so a client can tell a block
 * that is the only one of its text from one it cannot place. A paragraph of a
 * tight list item is no block of its own (the renderer unwraps it).
 */
export function blockLines(
  root: Root,
  lineOffset: number,
  textOf: (n: Nodes) => string,
): Record<string, number> {
  const lines: Record<string, number> = {};
  const add = (node: Nodes): void => {
    const start = node.position?.start.line;
    if (start === undefined) return;
    const hash = blockTextHash(textOf(node));
    lines[hash] = Object.hasOwn(lines, hash) ? 0 : start + lineOffset;
  };
  const walk = (node: Nodes, tight: boolean): void => {
    switch (node.type) {
      case "paragraph":
        if (!tight) add(node);
        return;
      case "heading":
      case "blockquote":
      case "code":
      case "table":
      case "tableCell":
      case "listItem":
        add(node);
    }
    if (!("children" in node)) return;
    const unwrap = node.type === "listItem" && node.spread !== true;
    for (const child of node.children as Nodes[]) walk(child, unwrap);
  };
  walk(root, false);
  return lines;
}
