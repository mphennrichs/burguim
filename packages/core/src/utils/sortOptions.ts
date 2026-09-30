export interface SortableOption {
  value: string;
  label: string;
}

// A catch-all ("Todos"/"Todas"/"Nenhum"/"Selecione...") always uses an empty
// value or the literal "all" across this app's dropdowns - it stays pinned
// first regardless of alphabetical order, same as any normal <select>'s
// placeholder would.
function isPinnedFirst(option: SortableOption): boolean {
  return option.value === '' || option.value === 'all';
}

// An inline "create new" action (CREATE_NEW_ITEM, CREATE_NEW_COURSE, ...)
// isn't data to sort alongside real options - it stays pinned last, where
// SearchableSelect already renders it with its own separator.
function isPinnedLast(option: SortableOption): boolean {
  return option.value.startsWith('CREATE_NEW_') || option.value.startsWith('ADD_ANOTHER_');
}

/**
 * Sorts a dropdown's options alphabetically by label (pt-BR collation, so
 * accents sort naturally) - keeping a leading catch-all ("Todos"/"Selecione...")
 * pinned first and a trailing "+ Criar novo" action pinned last. Use this for
 * any dropdown that's just a plain list of named things (roles, branches,
 * categories, items, payment methods) - NOT for one whose order is itself
 * meaningful (a status workflow, a chronological/period filter, a numeric
 * granularity, or a "biggest unit first" purchase-unit picker).
 */
export function sortOptionsAlphabetically<T extends SortableOption>(options: T[]): T[] {
  const first = options.filter(isPinnedFirst);
  const last = options.filter(isPinnedLast);
  const middle = options.filter((o) => !isPinnedFirst(o) && !isPinnedLast(o));
  middle.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
  return [...first, ...middle, ...last];
}
