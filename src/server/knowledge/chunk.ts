/**
 * Deterministic chunking (Fase 7). Splits on paragraph boundaries first,
 * packing consecutive paragraphs up to `maxChars`; a paragraph longer than
 * `maxChars` on its own is hard-split. No model call, no dependency.
 */
export function chunkText(content: string, maxChars = 1500): string[] {
  const paragraphs = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = '';
  for (const p of paragraphs) {
    const piece = buf ? `${buf}\n\n${p}` : p;
    if (piece.length <= maxChars) {
      buf = piece;
      continue;
    }
    if (buf) chunks.push(buf);
    if (p.length <= maxChars) {
      buf = p;
    } else {
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      buf = '';
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [content.slice(0, maxChars)];
}
