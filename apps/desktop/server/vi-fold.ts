// 1.9: Vietnamese without diacritics ("ca phe den") must find "cà phê đen". NFD strips tone and vowel marks; đ/Đ has no decomposition.
export function foldVietnamese(text: string): string {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[đĐ]/g, "d").toLowerCase();
}

export function foldedTerms(text: string): string[] {
  const out: string[] = [];
  for (const raw of foldVietnamese(text).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || out.includes(raw)) continue;
    out.push(raw);
  }
  return out;
}
