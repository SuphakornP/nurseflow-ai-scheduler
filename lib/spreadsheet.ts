const FORMULA_PREFIX = /^[=+\-@]/;

export function spreadsheetSafeText(value: unknown): string {
  const text = String(value ?? "");
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function csvCell(value: unknown): string {
  return `"${spreadsheetSafeText(value).replaceAll('"', '""')}"`;
}
