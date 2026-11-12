/** RFC 4180 CSV, with formula-injection guarding for spreadsheet apps. */
export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let s = String(cell);
          if (typeof cell === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}
