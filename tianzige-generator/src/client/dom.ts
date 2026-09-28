// SvgNode tree -> real DOM. createElementNS + text nodes only, never raw markup,
// so nothing a teacher pastes can ever become markup.

import type { SvgNode } from '../shared/svg';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function toDom(node: SvgNode | string): Node {
  if (typeof node === 'string') return document.createTextNode(node);
  const el = document.createElementNS(SVG_NS, node.tag);
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === 'xmlns' || k.toLowerCase().startsWith('on')) continue;
    el.setAttribute(k, String(v));
  }
  for (const child of node.children) el.appendChild(toDom(child));
  return el;
}
