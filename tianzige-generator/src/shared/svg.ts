// A tiny element tree. The sheet renderer builds one of these; the browser
// turns it into real DOM nodes (createElementNS, never raw markup) and the
// Worker turns it into an escaped string for the agent API. One renderer, two
// outputs, so the printed sheet and the API sheet cannot drift apart.

export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children: Array<SvgNode | string>;
}

export function h(
  tag: string,
  attrs: Record<string, string | number | undefined> = {},
  children: Array<SvgNode | string> = [],
): SvgNode {
  const clean: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) clean[k] = v;
  return { tag, attrs: clean, children };
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const SAFE_NAME = /^[a-zA-Z][a-zA-Z0-9:-]*$/;

/** Serialize a tree to markup. Tag and attribute names are checked, all values escaped. */
export function toMarkup(node: SvgNode | string): string {
  if (typeof node === 'string') return escapeXml(node);
  if (!SAFE_NAME.test(node.tag)) throw new Error(`bad tag ${node.tag}`);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => {
      if (!SAFE_NAME.test(k) || k.toLowerCase().startsWith('on')) throw new Error(`bad attribute ${k}`);
      return ` ${k}="${escapeXml(String(v))}"`;
    })
    .join('');
  return `<${node.tag}${attrs}>${node.children.map(toMarkup).join('')}</${node.tag}>`;
}

/** Round to 2 decimals for compact markup. */
export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
