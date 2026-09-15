/**
 * Strips the spacing printed on a pack so codes compare as a scanner reads them.
 *
 * An EAN-13 reads "4 800365 221029" on the label but scans as
 * "4800365221029", and a catalogue ends up holding either form depending on
 * whether the code was typed or scanned when the product was added.
 *
 * Lives here rather than beside the product queries so the till can use it too
 * — those queries are server-only.
 */
export function normalizeBarcode(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase();
}
