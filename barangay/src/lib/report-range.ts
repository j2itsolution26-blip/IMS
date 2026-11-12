import { parseManilaDate, toDateInput } from './dates';
import { defaultFrom } from './reports';

const MAX_DAYS = 366;

/** Inclusive from/to dates (Manila) → half-open instant range. */
export function readRange(from?: string, to?: string) {
  const fromStr = from && parseManilaDate(from) ? from : defaultFrom();
  const toStr = to && parseManilaDate(to) ? to : toDateInput(new Date());
  let start = parseManilaDate(fromStr)!;
  let end = new Date(parseManilaDate(toStr)!.getTime() + 86_400_000);
  if (end <= start) [start, end] = [new Date(end.getTime() - 86_400_000), new Date(start.getTime() + 86_400_000)];
  if (end.getTime() - start.getTime() > MAX_DAYS * 86_400_000) start = new Date(end.getTime() - MAX_DAYS * 86_400_000);
  return { start, end, from: toDateInput(start), to: toDateInput(new Date(end.getTime() - 1)) };
}
