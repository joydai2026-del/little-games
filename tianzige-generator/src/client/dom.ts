// SvgNode tree -> real DOM. createElementNS + text nodes only, never raw markup,
// so nothing a teacher pastes can ever become markup.

import type { SvgNode } from '../shared/svg';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function toDom(node: SvgNode | string): Node {
  if (typeof node === 'string') return document.createTextNode(node);
  const el = document.createElementNS(SVG_NS, node.tag);
  for (const [k, v] of Object.entries(node.attrs)) {
    const name = k.toLowerCase();
    if (name === 'xmlns' || name.startsWith('on') || name === 'style') continue;
    // The only link on a sheet is <use href="#id"> to a shape on the same page.
    if ((name === 'href' || name === 'xlink:href') && !/^#[a-z0-9-]+$/i.test(String(v))) continue;
    el.setAttribute(k, String(v));
  }
  for (const child of node.children) el.appendChild(toDom(child));
  return el;
}
