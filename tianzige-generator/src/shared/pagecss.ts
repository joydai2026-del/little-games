// The only CSS that depends on the teacher's paper pick: page size, margins,
// and the printed size of one page SVG. Used by the browser (set as a <style>
// element's textContent) and by the Worker's standalone sheet.

import { PAPERS, type PaperId } from './config';

export function pageCss(paperId: PaperId): string {
  const p = PAPERS[paperId];
  const w = `${p.width - 2 * p.margin}${p.unit}`;
  const hgt = `${p.height - 2 * p.margin}${p.unit}`;
  return [
    `@page { size: ${p.cssSize}; margin: ${p.margin}${p.unit}; }`,
    `@media print { .sheet-page { width: ${w}; height: ${hgt}; } }`,
  ].join('\n');
}
