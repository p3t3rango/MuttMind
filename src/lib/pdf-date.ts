/**
 * Parse a PDF metadata date string into an ISO UTC string.
 * PDF spec format: `D:YYYYMMDDHHmmss[OHH'mm']` where O is `+`, `-`, or `Z`.
 * Components after the year are optional and default to 0 (month/day default to 01).
 * Returns null on malformed input.
 */
export function parsePdfDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('D:')) return null;
  const m = raw.match(
    /^D:(\d{4})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2}))?)?)?)?)?(Z|[+-]\d{2}'\d{2}')?$/,
  );
  if (!m) return null;
  const [, Y, Mo = '01', D = '01', H = '00', Mi = '00', S = '00', tz] = m;
  let isoTz = 'Z';
  if (tz && tz !== 'Z') {
    isoTz = `${tz[0]}${tz.slice(1, 3)}:${tz.slice(4, 6)}`;
  }
  const iso = `${Y}-${Mo}-${D}T${H}:${Mi}:${S}${isoTz}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
