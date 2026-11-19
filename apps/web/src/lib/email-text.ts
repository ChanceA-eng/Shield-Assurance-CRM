export function emailHtmlToText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match: string, url: string, label: string) => {
      const text = label.replace(/<[^>]*>/g, '').trim();
      return text === url ? url : `${text} (${url})`;
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|h[1-6]|tr|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<br\b[^>]*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|lt|gt|amp|quot|apos|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/gi, (match: string, entity: string) => {
      const names: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '--', hellip: '...' };
      if (!entity.startsWith('#')) return names[entity.toLowerCase()] ?? match;
      const value = entity.toLowerCase().startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : match;
    });
}

export function readableEmail(body: string): { text: string; quoted: string | null } {
  const text = body.replace(/\r\n?/g, '\n').replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[\u200b\ufeff]/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const lines = text.split('\n');
  const boundary = lines.findIndex((line, index) => {
    if (index === 0 || !lines.slice(0, index).some((value) => value.trim())) return false;
    const wrappedReply = /^\(?On /i.test(line.trim()) && lines.slice(index, index + 6).some((candidate, offset) => {
      if (!/wrote:\)?\s*$/i.test(candidate)) return false;
      const header = lines.slice(index, index + offset + 1).join(' ').replace(/\s+/g, ' ').trim();
      return /^\(?On .{1,1000}wrote:\)?$/i.test(header)
        && (offset === 0 || /@|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|20\d{2})\b/i.test(header));
    });
    return wrappedReply
      || /^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}$/i.test(line.trim())
      || (/^From:\s*.+/i.test(line) && lines.slice(index + 1, index + 6).some((value) => /^(?:Sent|Date|To|Subject):\s*.+/i.test(value)))
      || (/^>/.test(line) && lines.slice(index).filter((value) => value.trim()).every((value) => /^>/.test(value)));
  });
  return boundary < 0 ? { text, quoted: null } : {
    text: lines.slice(0, boundary).join('\n').trimEnd(), quoted: lines.slice(boundary).join('\n'),
  };
}
