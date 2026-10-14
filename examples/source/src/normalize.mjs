export function normalize(value) {
  return String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}
