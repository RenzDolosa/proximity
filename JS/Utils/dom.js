// Tiny DOM query helpers, scoped to an optional root (defaults to document).
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
