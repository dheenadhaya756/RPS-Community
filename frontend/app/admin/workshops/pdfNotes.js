export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function pageCount(bytes) {
  let text = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  const pages = text.match(/\/Type\s*\/Page(?!s)/g);
  if (pages && pages.length) return pages.length;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}

export function measurePdfBytes(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pages = pageCount(buf);
  return { pages: pages || null, sizeBytes: buf.length, sizeLabel: formatSize(buf.length) };
}

export async function measurePdf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('read');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pages = pageCount(bytes);
  return {
    pages: pages ? String(pages) : '',
    size: formatSize(bytes.length),
  };
}
