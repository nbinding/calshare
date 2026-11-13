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

// Tapping a calendar day cycles: not free → any time → morning → afternoon → evening → not free.
// A day with a combination of times (set with the per-day buttons) is past the end of the cycle, so it clears.
export const CYCLE = [0, FREE, FREE | MORNING, FREE | AFTERNOON, FREE | EVENING];
export function cycle(mask) {
  const i = CYCLE.indexOf(mask);
  return i < 0 ? 0 : CYCLE[(i + 1) % CYCLE.length];
}

// Set a free day's time from its own buttons: 0 = any time; a tag toggles, and removing the last tag means any time.
export function setTime(mask, bit) {
  if (!bit) return FREE;
  const next = (mask | FREE) ^ bit;
  return tagsOf(next) ? next : FREE;
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
// Plan: { id, step, created, title, start, count, group, a:{name,days,v}, b:{name,days,id,v}, picks:[iso], finals:[iso], people:[{name,id,days}] }
// step = the step that produced this link: 1 organiser shared, 2 guest replied, 3 organiser picked, 4 settled.
// group: one invite link went to several guests; the organiser collects replies and locks in the final days (step 4) directly.
// v counts edits to that person's own days, so a reply to an older link never overwrites newer days.
// b.id / people[].id is a random id made on the guest's device, so two guests with the same name stay separate.
const ver = v => (Number.isInteger(v) && v > 0 ? v : 0);
const cleanId = id => (typeof id === 'string' && /^[A-Za-z0-9_-]{4,32}$/.test(id) ? id : '');

export function toWire(plan) {
  const enc = days => encodeDays(days, plan.start, plan.count);
  const w = { v: 1, i: plan.id, s: plan.step, t: plan.created, m: plan.start, c: plan.count };
  if (plan.title) w.n = plan.title;
  if (plan.group) w.g = 1;
  w.a = { n: plan.a.name, d: enc(plan.a.days) };
  if (plan.a.v) w.a.v = plan.a.v;
  if (plan.b) {
    w.b = { n: plan.b.name, d: enc(plan.b.days) };
    if (plan.b.id) w.b.u = plan.b.id;
    if (plan.b.v) w.b.v = plan.b.v;
  }
  if (plan.picks?.length) w.p = plan.picks.map(iso => dayOffset(plan.start, iso));
  if (plan.finals?.length) w.f = plan.finals.map(iso => dayOffset(plan.start, iso));
  if (plan.people?.length) w.q = plan.people.map(x => ({ n: x.name, u: x.id, d: enc(x.days) }));
  return w;
}

export function fromWire(w) {
  if (!w || w.v !== 1 || !/^\d{4}-\d{2}$/.test(w.m) || !(w.c >= 1 && w.c <= MAX_MONTHS) || !(w.s >= 1 && w.s <= 4) || !w.a) throw new Error('bad plan');
  const name = n => String(n || '').slice(0, 40), dec = d => decodeDays(d, w.m, w.c);
  const plan = {
    id: String(w.i), step: w.s, created: Number(w.t) || 0, title: w.n ? String(w.n).slice(0, 80) : '',
    start: w.m, count: w.c, group: w.g === 1,
    a: { name: name(w.a.n), days: dec(w.a.d), v: ver(w.a.v) },
  };
  if (w.b) plan.b = { name: name(w.b.n), days: dec(w.b.d), id: cleanId(w.b.u), v: ver(w.b.v) };
  plan.picks = Array.isArray(w.p) ? w.p.map(o => isoAtOffset(w.m, o | 0)) : [];
  // f was a single offset in the first release; it is now a list.
  if (w.f != null) plan.finals = (Array.isArray(w.f) ? w.f : [w.f]).map(o => isoAtOffset(w.m, o | 0));
  if (Array.isArray(w.q)) plan.people = w.q.slice(0, 50).map(x => ({ name: name(x?.n), id: cleanId(x?.u), days: dec(x?.d) }));
  return plan;
}

// ---- Groups ----
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// A short, stable code from a guest's hidden id, shown only to tell people with the same name apart.
export function shortCode(id, len = 2) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let out = '';
  for (let i = 0; i < len; i++) { out += CODE_CHARS[h & 31]; h >>>= 5; }
  return out;
}

// Labels for a list of people: a name on its own, or "Sam · K7" when the name is shared.
export function labelPeople(people) {
  const key = p => p.name.trim().toLowerCase();
  const count = {};
  for (const p of people) count[key(p)] = (count[key(p)] || 0) + 1;
  const labels = {};
  for (const p of people) {
    const shown = p.name.trim() || 'Guest';
    if (count[key(p)] < 2) { labels[p.id] = shown; continue; }
    const twins = people.filter(x => key(x) === key(p));
    const len = new Set(twins.map(x => shortCode(x.id))).size === twins.length ? 2 : 4;
    labels[p.id] = `${shown} · ${shortCode(p.id, len)}`;
  }
  return labels;
}

// For each day the organiser is free: who else can make it, and the time that suits them all.
export function groupDays(aDays, people) {
  const out = {};
  for (const iso of Object.keys(aDays)) {
    const free = people.filter(p => meet(aDays[iso], p.days[iso] || 0));
    if (!free.length) continue;
    let mask = aDays[iso];
    for (const p of free) { const m = meet(mask, p.days[iso]); if (m) mask = m; }
    out[iso] = { mask, free: free.map(p => p.id) };
  }
  return out;
}

// Whose turn a link at this step hands over to: 'b' after steps 1 and 3, 'a' after step 2, nobody once settled.
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
const passNote = "It's locked with a passphrase, which I'll send you in a separate message.";

export function draftMessage(plan, link, { update = false } = {}) {
  const B = plan.b?.name || '';
  switch (plan.step) {
    case 1:
      if (update) return `I've updated my days${about(plan)}. Please use this link instead of the one I sent before (same passphrase):\n${link}`;
      if (plan.group) return `Hi all! Can we find a day${about(plan)}? I've marked the days I'm free here. Open the link, add your days and send it back to me:\n${link}\n${passNote}`;
      return `Hi${B ? ' ' + B : ''}! Can we find a day${about(plan)}? I've marked the days I'm free here. Add yours and send the link back:\n${link}\n${passNote}`;
    case 2: {
      const n = Object.keys(overlap(plan.a.days, plan.b.days)).length;
      const lead = update ? `I've updated my days${about(plan)}. Use this link instead of my earlier one.` : `Here are my days${about(plan)}.`;
      if (plan.group) return `${lead} ${n ? `I can do ${n} of your days.` : `I can't do any of your days, sorry.`}\n${link}`;
      return `${lead} ${n ? `We overlap on ${n} day${n === 1 ? '' : 's'}.` : `It doesn't look like we overlap yet.`} Pick the ones that suit you:\n${link}`;
    }
    case 3: {
      const list = plan.picks.map(shortDay).join(', ');
      return `${update ? `I've changed the options${about(plan)}` : `I've narrowed it down${about(plan)}`}: ${list}. Choose the one you'd like (or more than one) and it's settled:\n${link}`;
    }
    default: return (update ? 'Change of plan! ' : '') + finalSummary(plan, link);
  }
}

const everyone = plan => [plan.a.name, ...(plan.group ? (plan.people || []).map(p => p.name) : [plan.b?.name])].filter(Boolean);
const joinNames = names => (names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names.at(-1) : names[0] || '');
// The agreed time on a day, and for groups how many of everyone can make it.
function dayInfo(plan, iso) {
  if (!plan.group) return { mask: meet(plan.a.days[iso] || 0, plan.b?.days[iso] || 0) };
  const g = groupDays({ [iso]: plan.a.days[iso] || FREE }, plan.people || [])[iso];
  return { mask: g?.mask || plan.a.days[iso] || FREE, going: (g?.free.length || 0) + 1, of: (plan.people || []).length + 1 };
}
export function dayNote(plan, iso) {
  const { mask, going, of } = dayInfo(plan, iso);
  return [tagsOf(mask) ? tagWords(mask) : '', going ? `${going} of ${of} can make it` : ''].filter(Boolean).join(', ');
}
const longDay = iso => formatDay(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function finalSummary(plan, link) {
  const finals = plan.finals || [];
  const who = joinNames(everyone(plan));
  const line = iso => { const n = dayNote(plan, iso); return `${longDay(iso)}${n ? ` (${n})` : ''}`; };
  let body;
  if (finals.length === 1) body = `It's settled: ${plan.title ? `${plan.title} is on` : `we're meeting on`} ${line(finals[0])}.`;
  else body = `It's settled${plan.title ? ` for ${plan.title}` : ''}. We're meeting on ${finals.length} days:\n${finals.map(d => `• ${line(d)}`).join('\n')}`;
  return `${body}${who ? `\n— ${who}` : ''}${link ? `\n${link}` : ''}`;
}

export function icsFor(plan, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const esc = s => s.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const who = joinNames(everyone(plan));
  const events = (plan.finals || []).flatMap(iso => {
    const d = iso.replace(/-/g, '');
    const next = isoFromDate(new Date(parseIso(iso).getTime() + 86400000)).replace(/-/g, '');
    return ['BEGIN:VEVENT', `UID:${plan.id}-${d}@calshare`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${esc(plan.title || (who ? `Meet: ${who}` : 'Meet up'))}`,
      `DESCRIPTION:${esc(`Agreed with Calshare${who ? ' by ' + who : ''}. Time: ${tagWords(dayInfo(plan, iso).mask)}.`)}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT'];
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calshare//EN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}
