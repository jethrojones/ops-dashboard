// Minimal 5-field cron parser + next-fire computation. Used by:
//  - The scheduler tick (decides what to enqueue this minute).
//  - The PUT /api/workflows/:id/schedule endpoint (validates input,
//    computes the next fire to seed the schedules row).
//
// Supported syntax:
//   *             — any value
//   N             — exactly N
//   N-M           — range
//   N,M,O         — list
//   */N           — every Nth from 0
//   N-M/S         — every S from N to M (range+step)
//
// Anything else (named months, '?', '@daily', timezone tags, etc.) is
// unsupported — `computeNextRun` returns null, and validators can reject.

const FIELD_COUNT = 5;
const LOOKAHEAD_MINUTES = 60 * 24 * 7; // up to one week ahead

/**
 * Return true if the 5-field expression parses with our supported syntax.
 * Cheaper than computeNextRun (no minute-by-minute walk).
 */
export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== FIELD_COUNT) return false;
  return parts.every(p => isValidCronPart(p));
}

/**
 * Return the ISO timestamp of the next time the cron expression fires
 * after `from` (defaults to now), or null if the expression is unsupported
 * or doesn't fire in the next week.
 */
export function computeNextRun(expr: string, from: Date = new Date()): string | null {
  try {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== FIELD_COUNT) return null;
    const [minPart, hourPart, /* dom */, /* mon */, dowPart] = parts;

    if (!isValidCronPart(minPart) || !isValidCronPart(hourPart) || !isValidCronPart(dowPart)) {
      return null;
    }

    const next = new Date(from);
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);

    for (let i = 0; i < LOOKAHEAD_MINUTES; i++) {
      const dow = next.getUTCDay();
      const hour = next.getUTCHours();
      const min = next.getUTCMinutes();

      if (matchesCronPart(dowPart, dow) &&
          matchesCronPart(hourPart, hour) &&
          matchesCronPart(minPart, min)) {
        return next.toISOString();
      }

      next.setMinutes(next.getMinutes() + 1);
    }
    return null;
  } catch {
    return null;
  }
}

function isValidCronPart(part: string): boolean {
  if (part === '*') return true;
  if (/^\*\/\d+$/.test(part)) return true;
  if (/^\d+-\d+\/\d+$/.test(part)) return true;
  if (/^\d+-\d+$/.test(part)) return true;
  if (/^\d+(,\d+)+$/.test(part)) return true;
  if (/^\d+$/.test(part)) return true;
  return false;
}

export function matchesCronPart(part: string, value: number): boolean {
  if (part === '*') return true;
  if (part.startsWith('*/')) return value % parseInt(part.slice(2), 10) === 0;
  // Range+step: e.g. "9-17/2" means every 2 units from 9 to 17
  if (part.includes('-') && part.includes('/')) {
    const [range, stepStr] = part.split('/');
    const [lo, hi] = range.split('-').map(Number);
    const step = parseInt(stepStr, 10);
    if (value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  }
  if (part.includes('-')) { const [lo, hi] = part.split('-').map(Number); return value >= lo && value <= hi; }
  if (part.includes(',')) return part.split(',').map(Number).includes(value);
  return parseInt(part, 10) === value;
}
