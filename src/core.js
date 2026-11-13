// Pure logic for Calshare: dates, day masks, compact encoding, overlaps and messages.
// No DOM access here, so it runs in Node for tests.

// A day's mask: 0 = not free. Bit 0 = free. Bits 1-3 = optional time-of-day tags.
// Free with no tags means "any time".
export const FREE = 1, MORNING = 2, AFTERNOON = 4, EVENING = 8;
export const TAG_BITS = MORNING | AFTERNOON | EVENING;
export const TAGS = [
  { bit: MORNING, key: 'morning', label: 'Morning', short: 'AM' },
  { bit: AFTERNOON, key: 'afternoon', label: 'Afternoon', short: 'PM' },
  { bit: EVENING, key: 'evening', label: 'Evening', short: 'Eve' },
];
export const MAX_MONTHS = 3;
export const STALE_DAYS = 14;

const pad = n => String(n).padStart(2, '0');

// ---- Dates (calendar dates only, computed in UTC so time zones never shift a day) ----
export function isoFromParts(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
export function todayIso(now = new Date()) { return isoFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate()); }
export function monthOf(iso) { return iso.slice(0, 7); }
export function parseIso(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
export function isoFromDate(dt) { return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function daysInMonth(month) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function rangeMonths(start, count) { return Array.from({ length: count }, (_, i) => addMonths(start, i)); }
export function rangeDays(start, count) {
  const out = [];
  for (const mo of rangeMonths(start, count)) for (let d = 1; d <= daysInMonth(mo); d++) out.push(`${mo}-${pad(d)}`);
  return out;
}
export function dayOffset(start, iso) { return Math.round((parseIso(iso) - parseIso(`${start}-01`)) / 86400000); }
export function isoAtOffset(start, off) { const dt = parseIso(`${start}-01`); dt.setUTCDate(dt.getUTCDate() + off); return isoFromDate(dt); }
// Monday = 0 ... Sunday = 6
export function weekdayIndex(iso) { return (parseIso(iso).getUTCDay() + 6) % 7; }

// ---- Day masks ----
export const isFree = m => (m & FREE) === FREE;
export const tagsOf = m => m & TAG_BITS;

// Tap a day with the current brush. "any" toggles the whole day; a tag toggles that tag.
export function paint(mask, brush) {
  if (brush === 0) return mask === FREE ? 0 : FREE;
  if (!isFree(mask)) return FREE | brush;
  const next = mask ^ brush;
  return tagsOf(next) ? next : (tagsOf(mask) & brush ? 0 : next);
}

// Two masks meet when both are free and their times are compatible.
export function meet(a, b) {
  if (!isFree(a) || !isFree(b)) return 0;
  const ta = tagsOf(a), tb = tagsOf(b);
  if (!ta) return FREE | tb;
  if (!tb) return FREE | ta;
  const both = ta & tb;
  return both ? FREE | both : 0;
}

export function overlap(daysA, daysB) {
  const out = {};
  for (const iso of Object.keys(daysA)) { const m = meet(daysA[iso], daysB[iso] || 0); if (m) out[iso] = m; }
  return out;
}

export function tagWords(mask) {
  const t = tagsOf(mask);
  if (!t) return 'any time';
  const words = TAGS.filter(x => t & x.bit).map(x => x.label.toLowerCase());
  return words.length > 1 ? words.slice(0, -1).join(', ') + ' or ' + words.at(-1) : words[0];
}

// ---- Compact encoding: one hex digit per day across the range, trailing zeros trimmed ----
export function encodeDays(days, start, count) {
  let s = '';
  for (const iso of rangeDays(start, count)) s += (days[iso] || 0).toString(16);
  return s.replace(/0+$/, '');
}
export function decodeDays(str, start, count) {
  const days = {}, all = rangeDays(start, count);
  if (typeof str !== 'string' || !/^[0-9a-f]*$/.test(str)) throw new Error('bad days');
  for (let i = 0; i < str.length && i < all.length; i++) { const m = parseInt(str[i], 16); if (isFree(m)) days[all[i]] = m; }
  return days;
}

// ---- Plan <-> wire payload ----
// Plan: { id, step, created, title, start, count, a:{name,days}, b:{name,days}, picks:[iso], final:iso }
// step = the step that produced this link: 1 owner shared, 2 recipient replied, 3 owner picked, 4 recipient confirmed.
export function toWire(plan) {
  const w = { v: 1, i: plan.id, s: plan.step, t: plan.created, m: plan.start, c: plan.count };
  if (plan.title) w.n = plan.title;
  w.a = { n: plan.a.name, d: encodeDays(plan.a.days, plan.start, plan.count) };
  if (plan.b) w.b = { n: plan.b.name, d: encodeDays(plan.b.days, plan.start, plan.count) };
  if (plan.picks?.length) w.p = plan.picks.map(iso => dayOffset(plan.start, iso));
  if (plan.final) w.f = dayOffset(plan.start, plan.final);
  return w;
}

export function fromWire(w) {
  if (!w || w.v !== 1 || !/^\d{4}-\d{2}$/.test(w.m) || !(w.c >= 1 && w.c <= MAX_MONTHS) || !(w.s >= 1 && w.s <= 4) || !w.a) throw new Error('bad plan');
  const plan = {
    id: String(w.i), step: w.s, created: Number(w.t) || 0, title: w.n ? String(w.n).slice(0, 80) : '',
    start: w.m, count: w.c,
    a: { name: String(w.a.n || '').slice(0, 40), days: decodeDays(w.a.d, w.m, w.c) },
  };
  if (w.b) plan.b = { name: String(w.b.n || '').slice(0, 40), days: decodeDays(w.b.d, w.m, w.c) };
  plan.picks = Array.isArray(w.p) ? w.p.map(o => isoAtOffset(w.m, o | 0)) : [];
  if (w.f != null) plan.final = isoAtOffset(w.m, w.f | 0);
  return plan;
}

// Whose turn a link at this step hands over to: 'b' after steps 1 and 3, 'a' after step 2, nobody once done.
export const turnAfter = step => (step === 1 || step === 3 ? 'b' : step === 2 ? 'a' : null);

export function isStale(plan, now = Date.now()) { return plan.created > 0 && now - plan.created > STALE_DAYS * 86400000; }

// ---- Text ----
export function formatDay(iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }, locale) {
  return parseIso(iso).toLocaleDateString(locale, { ...opts, timeZone: 'UTC' });
}
export function formatMonth(month, locale) {
  return parseIso(`${month}-01`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const shortDay = iso => formatDay(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const about = plan => (plan.title ? ` for ${plan.title}` : '');
const passNote = '(The passphrase is the one we agreed, sent separately.)';

export function draftMessage(plan, link) {
  const A = plan.a.name || 'I', B = plan.b?.name || '';
  switch (plan.step) {
    case 1: return `Hi${B ? ' ' + B : ''}! Can we find a day${about(plan)}? I've marked the days I'm free here. Add yours and send the link back:\n${link}\n${passNote}`;
    case 2: {
      const n = Object.keys(overlap(plan.a.days, plan.b.days)).length;
      return `Here are my days${about(plan)}. ${n ? `We overlap on ${n} day${n === 1 ? '' : 's'}.` : `It doesn't look like we overlap yet.`} Pick the ones that suit you:\n${link}`;
    }
    case 3: {
      const list = plan.picks.map(shortDay).join(', ');
      return `I've narrowed it down${about(plan)}: ${list}. Choose the one you'd like and it's settled:\n${link}`;
    }
    default: return finalSummary(plan, link);
  }
}

export function finalSummary(plan, link) {
  const mask = meet(plan.a.days[plan.final] || 0, plan.b?.days[plan.final] || 0);
  const when = formatDay(plan.final, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = tagsOf(mask) ? ` (${tagWords(mask)})` : '';
  const who = [plan.a.name, plan.b?.name].filter(Boolean).join(' & ');
  const what = plan.title ? `${plan.title} is on` : `we're meeting on`;
  return `It's settled: ${what} ${when}${time}.${who ? `\n— ${who}` : ''}${link ? `\n${link}` : ''}`;
}

export function icsFor(plan, now = new Date()) {
  const d = plan.final.replace(/-/g, '');
  const next = isoFromDate(new Date(parseIso(plan.final).getTime() + 86400000)).replace(/-/g, '');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = s => s.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const who = [plan.a.name, plan.b?.name].filter(Boolean).join(' & ');
  const mask = meet(plan.a.days[plan.final] || 0, plan.b?.days[plan.final] || 0);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calshare//EN', 'BEGIN:VEVENT',
    `UID:${plan.id}-${d}@calshare`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
    `SUMMARY:${esc(plan.title || (who ? `Meet: ${who}` : 'Meet up'))}`,
    `DESCRIPTION:${esc(`Agreed with Calshare${who ? ' by ' + who : ''}. Time: ${tagWords(mask)}.`)}`,
    'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}
