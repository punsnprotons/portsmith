import { normalize } from './normalize.mjs';

export function filterRows(rows, query) {
  const search = normalize(query);
  return rows.filter(row => !search || normalize(row.name).includes(search));
}
