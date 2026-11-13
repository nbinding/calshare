import { seal, open, WrongPassphrase, suggestPassphrase } from './share.js';
// Shared UI helpers from the nbinding design system (pinned copy in src/ds, see src/ds/VERSION).
import { esc as h, toast, copy as copyText, prefs as nbPrefs, mark } from './ds/js/nb.js';
import {
  FREE, TAGS, MAX_MONTHS, cycle, setTime, meet, overlap, isFree, tagsOf, tagWords, isMaybe, setMaybe, timeWords,
  todayIso, monthOf, addMonths, rangeMonths, rangeDays, daysInMonth, weekdayIndex, parseIso,
  toWire, fromWire, turnAfter, isStale, formatDay, formatMonth, draftMessage, finalSummary, icsFor,
  decodeDays, encodeDays, shortCode, labelPeople, groupDays, dayNote,
} from './core.js';

// ---------- Local storage (this device only) ----------
const STORE = 'calshare-v1';
function loadStore() { try { return JSON.parse(localStorage.getItem(STORE)) || { plans: {} }; } catch { return { plans: {} }; } }
function saveStore(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode: carry on without saving */ } }
// A record per plan: role, passphrase, latest link and plan, plus for groups the organiser's
// invite link and every reply (keyed by the guest's hidden id), and a guest's own id.
function remember(plan, role, pass, hash, extra = {}) {
  const s = loadStore();
  s.plans[plan.id] = { ...s.plans[plan.id], role, pass, hash, wire: toWire(plan), updated: Date.now(), ...extra };
  saveStore(s);
}
function repliesOf(rec, plan) {
  return Object.entries(rec?.replies || {}).map(([id, x]) => {
    try { return { id, name: x.n, v: x.v || 0, days: decodeDays(x.d, plan.start, plan.count) }; } catch { return null; }
  }).filter(Boolean);
}
function forget(id) { const s = loadStore(); delete s.plans[id]; saveStore(s); }
function recordFor(id) { return loadStore().plans[id]; }

// ---------- Helpers ----------
const $app = document.getElementById('app');
const IRREGULAR = { person: 'people', reply: 'replies' };
const plural = (n, w) => `${n} ${n === 1 ? w : IRREGULAR[w] || (w.endsWith('ch') ? w + 'es' : w + 's')}`;
const randomId = (n = 6) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
const baseUrl = () => location.href.split('#')[0];
const clone = p => fromWire(JSON.parse(JSON.stringify(toWire(p))));
const futureDays = (days, today) => Object.keys(days).filter(d => d >= today).sort();
const nameOf = (plan, who, fallback) => (plan[who]?.name || '').trim() || fallback;

const icon = {
  left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  copy: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  cal: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  settings: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  theme: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>',
  dice: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/></svg>',
};

// ---------- State ----------
const S = {
  view: 'home',      // home | unlock | compose | respond | pick | confirm | collect | waiting | done
  editing: false,    // re-sending after a link was already shared
  plan: null, role: null, pass: '', hash: '',
  monthIdx: 0,
  sent: null,        // { link, text, step } once a link has been made in this view
  error: '', busy: false, notice: '', newer: null, showPass: false,
};
let focusKey = null;

function set(patch) { Object.assign(S, patch); render(); }

// ---------- Display and accessibility (adapted from stead-mobile; kept for this tab's session) ----------
const PREF_KEY = 'calshare-display-v1';
const defaultPrefs = { size: 100, font: 'default', theme: 'system', dateHelp: false, spacing: false, motion: false };
function readPrefs() {
  try {
    const p = JSON.parse(sessionStorage.getItem(PREF_KEY)) || {};
    return {
      size: [100, 115, 130, 150].includes(p.size) ? p.size : 100,
      font: ['default', 'sans', 'dyslexic'].includes(p.font) ? p.font : 'default',
      theme: ['system', 'light', 'dark'].includes(p.theme) ? p.theme : 'system',
      dateHelp: p.dateHelp === true, spacing: p.spacing === true, motion: p.motion === true,
    };
  } catch { return { ...defaultPrefs }; }
}
let prefs = readPrefs();
// The design system applies them as data-nb-* attributes and --nb-text-scale on <html>.
function applyPrefs() { nbPrefs.apply(prefs, PREF_KEY); }
applyPrefs();

function displayDialog() {
  const opt = (key, value, label, sub = '') => `<button type="button" data-act="pref" data-key="${key}" data-value="${value}" data-focus="pref-${key}-${value}" aria-pressed="${prefs[key] === value}">${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
  const toggle = (key, title, desc) => `<label class="nb-toggle"><input type="checkbox" data-act="pref-toggle" data-key="${key}" data-focus="pref-${key}" ${prefs[key] ? 'checked' : ''}><span class="nb-toggle__text"><strong>${title}</strong><small>${desc}</small></span></label>`;
  return `<div class="nb-scrim" data-act="close-display"></div>
  <div class="nb-dialog dialog" role="dialog" aria-modal="true" aria-labelledby="display-h">
    <div class="nb-dialog__head"><h2 class="nb-dialog__title" id="display-h">Display and accessibility</h2><button class="nb-icon-button" data-act="close-display" data-focus="close-display" aria-label="Close">${icon.close}</button></div>
    <p class="nb-small">Make Calshare comfortable for you. These settings stay in this tab for the current browser session, including refreshes. Your plans are saved separately.</p>
    <fieldset class="nb-field"><legend class="nb-field__label">Text size</legend><div class="nb-options">${[[100, 'Standard'], [115, 'Large'], [130, 'Larger'], [150, 'Largest']].map(([v, l]) => opt('size', v, l, v + '%')).join('')}</div><p class="nb-small">Browser zoom also works.</p></fieldset>
    <fieldset class="nb-field"><legend class="nb-field__label">Reading font</legend><div class="nb-options">${opt('font', 'default', 'Original')}${opt('font', 'sans', 'Plain sans')}${opt('font', 'dyslexic', 'OpenDyslexic')}</div><p class="nb-small">Choose whichever feels easiest to read. OpenDyslexic is included with the app.</p></fieldset>
    <fieldset class="nb-field"><legend class="nb-field__label">Appearance</legend><div class="nb-options">${opt('theme', 'system', 'Use device')}${opt('theme', 'light', 'Light')}${opt('theme', 'dark', 'Dark')}</div></fieldset>
    ${toggle('dateHelp', 'Help with dates', 'Show the weekday inside every day, label today in words and draw outlines more strongly.')}
    ${toggle('spacing', 'More breathing room', 'Increase line height, letter spacing and spacing between words.')}
    ${toggle('motion', 'Reduce motion', 'Remove animations and transitions.')}
    <div class="settings-preview" aria-hidden="true"><span class="nb-context">Reading preview</span><p><strong>Saturday 21 November</strong></p><p class="nb-small">Both free in the evening</p></div>
    <div class="nb-dialog__actions"><button class="nb-button nb-button--secondary" data-act="reset-display">Reset display settings</button><button class="nb-button" data-act="close-display">Done</button></div>
  </div>`;
}

// ---------- Rendering pieces ----------
const brand = () => `<a class="nb-brand" href="${h(baseUrl())}" data-act="home" aria-label="Calshare, your plans">${mark()}<span>calshare</span></a>`;

function crumb() {
  if (S.view === 'home') return 'Home';
  if (S.view === 'unlock') return 'Open a plan';
  const total = S.plan?.group ? 3 : 4;
  return shownStep > total ? 'Settled' : `Step ${shownStep} of ${total}${S.view === 'waiting' ? ' · Waiting' : ''}`;
}

function header() {
  return `<header class="nb-topbar topbar">
    ${brand()}
    <div class="nb-breadcrumb">Calshare <span aria-hidden="true">/</span> <strong>${h(crumb())}</strong></div>
    <div class="nb-topbar__actions">
      ${S.view !== 'home' && Object.keys(loadStore().plans).length ? `<a class="nb-chip" href="${h(baseUrl())}" data-act="home">Your plans</a>` : ''}
      <button class="nb-chip" data-act="open-display" data-focus="open-display" aria-label="Display and accessibility settings" aria-haspopup="dialog">${icon.settings}<span>Display</span></button>
    </div>
  </header>`;
}

function stepLabels(plan) {
  const A = nameOf(plan, 'a', 'Organiser'), B = nameOf(plan, 'b', 'Guest');
  return plan.group
    ? [[`${A} invites`, 'Sends one link to everyone'], ['Everyone adds days', 'Each person replies separately'], [`${A} locks it in`, 'Picks the days that suit most']]
    : [[`${A} shares`, 'Marks free days and sends the link'], [`${B} adds days`, 'Marks theirs and sends it back'], [`${A} picks`, 'Chooses from the shared days'], [`${B} confirms`, 'Locks in the final days']];
}
let shownStep = 0; // the step the current view is on; read by the desktop sidebar and breadcrumb

function stepper(plan, step) {
  const labels = stepLabels(plan).map(x => x[0]);
  if (plan.group) step = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 }[step];
  shownStep = step;
  return `<ol class="nb-stepper" aria-label="Progress">${labels.map((l, i) => {
    const n = i + 1;
    return `<li ${n < step ? 'data-state="done"' : ''} ${n === step ? 'aria-current="step"' : ''}>${h(l)}</li>`;
  }).join('')}</ol>`;
}

// Desktop sidebar, after stead-mobile: brand, where you are, and the privacy note. Hidden on phones.
function sidebar() {
  const p = S.plan, inPlan = p && !['home', 'unlock'].includes(S.view);
  let nav;
  if (inPlan) {
    const steps = stepLabels(p), cur = shownStep;
    nav = `<ol class="nb-nav side-steps" aria-label="Plan steps">${steps.map(([t, d], i) => {
      const n = i + 1;
      return `<li><span class="nb-nav__item" ${n < cur ? 'data-state="done"' : ''} ${n === cur ? 'aria-current="step"' : ''}><span class="nb-nav__num">${n < cur ? '✓' : String(n).padStart(2, '0')}</span><span><strong>${h(t)}</strong><small>${h(d)}</small></span></span></li>`;
    }).join('')}</ol>`;
  } else {
    const plans = Object.entries(loadStore().plans).sort((x, y) => y[1].updated - x[1].updated).slice(0, 5);
    nav = `<nav aria-label="Plans"><button class="nb-nav__item" ${S.view === 'home' ? 'aria-current="page"' : ''} data-act="new"><span class="nb-nav__num">+</span><span><strong>Start a plan</strong><small>Mark your days and share a link</small></span></button>
      ${plans.map(([, r]) => { let q; try { q = fromWire(r.wire); } catch { return ''; } return `<a class="nb-nav__item" href="#${h(r.hash)}"><span class="nb-nav__num">${q.step === 4 ? '✓' : '·'}</span><span><strong>${h(q.title || nameOf(q, 'a', 'Plan'))}</strong><small>${q.step === 4 ? 'Settled' : q.group ? 'Group plan' : 'In progress'}</small></span></a>`; }).join('')}</nav>`;
  }
  const total = p?.group ? 3 : 4, done = inPlan ? Math.min(shownStep - 1, total) : 0;
  return `<aside class="nb-sidebar sidebar" aria-label="Calshare">
    ${brand()}
    <p class="nb-sidebar__label">Private, day-level scheduling</p>
    ${nav}
    <div class="sidebar-bottom">
      ${inPlan ? `<div class="progress-label"><span>${p.title ? h(p.title) : 'This plan'}</span><span>${done} / ${total}</span></div><progress class="nb-progress" value="${done}" max="${total}" aria-label="Steps done">${done} of ${total}</progress>` : ''}
      <p class="nb-privacy">${icon.lock}<span>Encrypted in your browser.<br>Nothing is sent to a server.</span></p>
    </div>
  </aside>`;
}

function banners() {
  const out = [];
  if (S.newer) out.push(`<div class="nb-note"><p><strong>This is an older link.</strong> You already have a later step of this plan saved on this device.</p><button class="nb-text-button" data-act="open-newer">Open the latest</button></div>`);
  if (S.plan && isStale(S.plan) && S.view !== 'done') {
    const days = Math.floor((Date.now() - S.plan.created) / 86400000);
    out.push(`<div class="nb-note"><p><strong>This link is ${days} days old.</strong> Plans may have changed since it was sent, so check it's still current.</p></div>`);
  }
  if (S.notice) out.push(`<div class="nb-note"><p>${S.notice}</p></div>`);
  return out.join('');
}

// Calendar. mode: 'edit' (paint my days), 'pick' (choose among overlaps), 'view'
function calendar({ mine = {}, theirs = {}, allowed = null, picked = [], mode = 'edit', readonly = false, counts = null, lead: intro = '' }) {
  const p = S.plan, months = rangeMonths(p.start, p.count), today = todayIso();
  const idx = Math.min(S.monthIdx, months.length - 1), mo = months[idx];
  const lead = weekdayIndex(`${mo}-01`);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="nb-cell nb-cell--blank" aria-hidden="true"></span>');
  for (let d = 1; d <= daysInMonth(mo); d++) {
    const iso = `${mo}-${String(d).padStart(2, '0')}`;
    const m = mine[iso] || 0, t = theirs[iso] || 0, past = iso < today;
    const both = meet(m, t);
    const cls = ['nb-cell'];
    let label = formatDay(iso), pressed = null, disabled = past || readonly;
    let tagMask = m;
    if (mode === 'edit') {
      if (both) cls.push('nb-cell--both'); else if (isFree(m)) cls.push('nb-cell--mine'); else if (isFree(t)) cls.push('nb-cell--theirs');
      if (isMaybe(m)) cls.push('nb-cell--maybe');
      pressed = isFree(m);
      if (!isFree(m)) tagMask = t;
      label += isFree(m) ? `, you're free ${timeWords(m)}` : ', not marked';
      if (isFree(t)) label += `, they're free ${timeWords(t)}`;
    } else {
      const ok = allowed && allowed[iso];
      tagMask = ok || 0;
      if (picked.includes(iso)) { cls.push('nb-cell--chosen'); pressed = true; } else if (ok) { cls.push('nb-cell--choosable'); pressed = false; } else disabled = true;
      if (ok) label += counts ? `, ${counts[iso].replace('/', ' of ')} can make it, ${timeWords(ok)}` : `, both free ${timeWords(ok)}`;
      if (mode === 'view') disabled = true;
    }
    if (past) cls.push('nb-cell--past');
    if (iso === today) cls.push('nb-cell--today');
    const unsure = isMaybe(tagMask);
    const tags = counts?.[iso] || (tagsOf(tagMask) ? TAGS.filter(x => tagMask & x.bit).map(x => x.label[0]).join('') : '');
    cells.push(`<button class="${cls.join(' ')}" data-act="day" data-day="${iso}" data-focus="day-${iso}" ${disabled ? 'disabled' : ''} ${pressed != null ? `aria-pressed="${pressed}"` : ''} aria-label="${h(label)}"><span class="nb-cell__wd" aria-hidden="true">${iso === today ? 'Today' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekdayIndex(iso)]}</span><span class="nb-cell__num">${d}</span>${tags ? `<span class="nb-cell__tags">${tags}</span>` : ''}${unsure ? '<span class="nb-cell__q" aria-hidden="true">?</span>' : ''}</button>`);
  }
  const [mName, mYear] = formatMonth(mo).split(' ');
  return `<div class="nb-cal calendar ${mode}${mode === 'edit' ? '' : ' nb-cal--compact'}">
    <div class="nb-cal__head">
      <h3 class="nb-cal__month" aria-live="polite">${h(mName)} <span class="nb-cal__year">${h(mYear || '')}</span></h3>
      <span class="nb-cal__nav">
        <button class="nb-icon-button" data-act="month" data-i="${idx - 1}" ${idx === 0 ? 'disabled' : ''} aria-label="Previous month">${icon.left}</button>
        <button class="nb-icon-button" data-act="month" data-i="${idx + 1}" ${idx === months.length - 1 ? 'disabled' : ''} aria-label="Next month">${icon.right}</button>
      </span>
    </div>
    ${intro ? `<p class="nb-cal__lead">${intro}</p>` : ''}
    <div class="nb-cal__grid nb-cal__weekdays" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="nb-cal__grid">${cells.join('')}</div>
  </div>`;
}

// One short line instead of a guide panel: tapping cycles times; holding (or the button, for keyboards) opens the sheet.
function tapHint(mine) {
  const n = futureDays(mine, todayIso()).length;
  return `<div class="tap-hint"><p class="nb-hint">Tap a day again for morning, afternoon or evening. Hold it for maybe, or more than one time.</p>
    ${n ? `<button class="nb-text-button" data-act="open-sheet" data-focus="open-sheet">Times and maybes</button>` : ''}</div>`;
}

// Per-day times, shown in the bottom sheet: one row per day, each with its own buttons.
function dayTimes(mine, days, theirs = null, theirName = '') {
  const opts = [{ bit: 0, label: 'Any time' }, ...TAGS];
  if (!days.length) return '<p class="nb-small">Mark some days first, then set a time for each one here.</p>';
  return `<ul class="day-times">${days.map(iso => {
    const m = mine[iso] || FREE, short = formatDay(iso, { weekday: 'short', day: 'numeric', month: 'short' });
    const t = theirs && theirs[iso] ? `<small>${h(theirName)}: ${h(timeWords(theirs[iso]))}</small>` : '';
    return `<li><div class="dt-head"><strong>${h(short)}</strong>${t}<button class="dt-remove" data-act="remove-day" data-day="${iso}" aria-label="Remove ${h(formatDay(iso))}">${icon.close}</button></div>
      <div class="dt-chips" role="group" aria-label="Time on ${h(formatDay(iso))}">${opts.map(o => {
        const on = o.bit ? !!(m & o.bit) : !tagsOf(m);
        return `<button data-act="time" data-day="${iso}" data-bit="${o.bit}" data-focus="time-${iso}-${o.bit}" aria-pressed="${on}">${o.label}</button>`;
      }).join('')}</div>
      <div class="dt-sure" role="group" aria-label="How sure on ${h(formatDay(iso))}">
        <button data-act="sure" data-day="${iso}" data-maybe="0" data-focus="sure-${iso}-0" aria-pressed="${!isMaybe(m)}">Free</button>
        <button data-act="sure" data-day="${iso}" data-maybe="1" data-focus="sure-${iso}-1" aria-pressed="${isMaybe(m)}"><span class="q-mini" aria-hidden="true">?</span>Maybe</button>
      </div></li>`;
  }).join('')}</ul>`;
}

// Bottom sheet for one day (opened by holding it) or every marked day (from the button).
function sheet() {
  const p = S.plan, mine = myDays(), theirs = S.role === 'a' ? p.b?.days : p.a.days;
  const theirName = S.role === 'a' ? nameOf(p, 'b', 'They') : nameOf(p, 'a', 'They');
  const days = S.sheet === 'all' ? futureDays(mine, todayIso()) : (mine[S.sheet] ? [S.sheet] : []);
  const title = S.sheet === 'all' ? 'Times and maybes' : formatDay(S.sheet);
  return `<div class="nb-scrim" data-act="close-sheet"></div>
  <div class="nb-sheet sheet ${S.sheet === 'all' ? '' : 'single'}" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
    <div class="nb-sheet__grip" aria-hidden="true"></div>
    <h2 class="nb-sheet__title" id="sheet-h">${h(title)}</h2>
    ${dayTimes(mine, days, theirs, theirName)}
    <button class="nb-button nb-button--block" data-act="close-sheet" data-focus="sheet-done">Done</button>
  </div>`;
}

function quickActions() {
  return `<div class="nb-row quick"><button class="nb-chip nb-chip--sm" data-act="fill" data-kind="weekends">+ Weekends</button><button class="nb-chip nb-chip--sm" data-act="fill" data-kind="weekdays">+ Weekdays</button><button class="nb-chip nb-chip--sm" data-act="fill" data-kind="clear">Clear month</button></div>`;
}

function legend(withTheirs, theirName) {
  return `<ul class="nb-key" aria-label="Key">
    ${withTheirs ? `<li><span class="nb-swatch nb-swatch--theirs"></span>${h(theirName)}</li>` : ''}
    <li><span class="nb-swatch nb-swatch--mine"></span>${withTheirs ? 'You' : 'Free'}</li>
    ${withTheirs ? '<li><span class="nb-swatch nb-swatch--both"></span>Both of you</li>' : ''}
    <li><span class="nb-swatch nb-swatch--maybe">?</span>Maybe</li>
  </ul>`;
}

// Sticky summary at the bottom of the calendar screens: the count, a hint, and the one next action.
function dock(summary, detail, button) {
  return `<div class="nb-dock dock"><div class="nb-dock__row"><strong class="nb-dock__summary">${summary}</strong>${detail ? `<span class="nb-dock__detail">${detail}</span>` : ''}</div>${S.error ? `<p class="nb-field__error" role="alert">${h(S.error)}</p>` : ''}${button}</div>`;
}

function dayList(days, { picked = null, radio = false, name = 'day', act = null } = {}) {
  const list = Object.keys(days).sort();
  if (!list.length) return '';
  return `<ul class="nb-choices day-list">${list.map(iso => {
    const on = picked?.includes(iso);
    const control = picked ? `<input type="${radio ? 'radio' : 'checkbox'}" name="${name}" data-act="${act || (radio ? 'choose' : 'toggle-pick')}" data-day="${iso}" ${on ? 'checked' : ''}>` : '';
    return `<li><label class="${picked ? 'nb-choice' : 'nb-list__row'}">${control}<span class="nb-choice__text"><strong>${h(formatDay(iso))}</strong><small>${h(timeWords(days[iso]))}</small></span></label></li>`;
  }).join('')}</ul>`;
}

function linkField(link) {
  return `<div class="nb-field linkbox"><label class="nb-field__label" for="link-only">Link on its own</label>
    <textarea id="link-only" class="nb-textarea nb-textarea--mono link-only" readonly rows="3" data-select spellcheck="false">${h(link)}</textarea>
    <p class="nb-small">If the copy buttons don't work in your browser, tap the link above, then select all and copy it.</p></div>`;
}

function sharePanel() {
  const { link, text, step } = S.sent;
  const p = S.plan, other = S.role === 'a' ? nameOf(p, 'b', 'them') : nameOf(p, 'a', 'them');
  const canShare = typeof navigator.share === 'function';
  const title = step === 4 ? (p.group ? 'Send it to everyone' : 'Send the confirmation') : p.group && step === 1 ? 'Send it to everyone you\'re inviting' : `Send it to ${h(other)}`;
  const long = link.length > 1800 ? `<p class="nb-small warn">This link is ${link.length} characters long. Most apps cope, but if it arrives broken, mark fewer days or months.</p>` : '';
  const twoBeats = step === 1 && S.role === 'a';
  const preview = text.split('\n').filter(l => !l.includes(link)).join('\n').replace(/:\n/g, '.\n').replace(/:$/, '.');
  const send = `<button class="nb-button nb-button--block" data-act="${canShare ? 'native-share' : 'copy-message'}">${canShare ? icon.share + 'Send the link' : icon.copy + 'Copy the message'}</button>`;
  return `<section class="share" aria-labelledby="share-h">
    <h2 id="share-h" class="nb-sr-only">${title}</h2>
    ${S.sent.code ? `<p class="nb-code-box reply-code">Your reply code: <strong>${h(S.sent.code)}</strong> <span class="nb-small">If someone else in the group has your name, this tells ${h(nameOf(p, 'a', 'the organiser'))} which reply is yours.</span></p>` : ''}
    <div class="nb-beat">
      <p class="nb-beat__head">${twoBeats ? '<span class="nb-beat__n">1</span>' : ''}${twoBeats ? 'Your days' : p.group && step === 1 ? 'Send the same link to each person, or to a group chat' : `Send it to ${h(other)}`}</p>
      <p class="nb-preview">${h(preview)}</p>
      ${send}
    </div>
    ${twoBeats ? `<div class="nb-beat">
      <p class="nb-beat__head"><span class="nb-beat__n">2</span>The words that open it</p>
      <p class="nb-words">${h(S.pass)}</p>
      <p class="nb-small">Send these in a separate message, or just say them. Anyone with the link and these words can open the plan.</p>
      <button class="nb-button nb-button--secondary nb-button--block" data-act="copy-pass">${icon.copy}Copy the words</button>
    </div>` : ''}
    ${step === 4 ? `<button class="nb-button nb-button--secondary nb-button--block" data-act="ics">${icon.cal}Add to my calendar</button>` : ''}
    <details class="nb-disclosure"><summary>Edit the message</summary>
      <label class="nb-sr-only" for="msg">Message</label>
      <textarea class="nb-textarea" id="msg" rows="6" data-input="message">${h(text)}</textarea>
      <button class="nb-button nb-button--secondary nb-button--block" data-act="copy-message">${icon.copy}Copy message</button>
    </details>
    <details class="nb-disclosure"><summary>Show the link</summary>
      ${linkField(link)}
      <button class="nb-button nb-button--secondary nb-button--block" data-act="copy-link">${icon.copy}Copy link only</button>
    </details>
    ${long}
  </section>`;
}

// ---------- Views ----------
function viewHome() {
  const plans = Object.entries(loadStore().plans).sort((x, y) => y[1].updated - x[1].updated);
  const rows = plans.map(([id, r]) => {
    let p; try { p = fromWire(r.wire); } catch { return ''; }
    const A = nameOf(p, 'a', 'Organiser'), B = nameOf(p, 'b', 'your guest');
    const me = r.role, turn = turnAfter(p.step), n = Object.keys(r.replies || {}).length;
    const status = p.step === 4 ? `Settled: ${p.finals.map(d => formatDay(d, { weekday: 'short', day: 'numeric', month: 'short' })).join(', ')}`
      : p.group && me === 'a' ? (n ? `${plural(n, 'reply')} so far` : 'Waiting for replies')
      : turn === me ? 'Your turn' : `Waiting for ${me === 'a' ? B : A}`;
    const name = p.title || (p.group ? `${A}'s group plan` : `${A}${p.b ? ' & ' + nameOf(p, 'b', '') : ''}`);
    return `<li class="nb-list__row plan-row"><a class="nb-list__main" href="#${h(r.hash)}"><strong>${h(name)}</strong><small>${h(status)}</small></a>
      <button class="nb-text-button" data-act="forget" data-id="${h(id)}" aria-label="Forget this plan">Forget</button></li>`;
  }).join('');
  return `<main class="page home">
    <p class="nb-context">Private, day-level scheduling</p>
    <h1 class="nb-display">Find a day that <em>works for everyone.</em></h1>
    <p class="nb-lead">Mark the days you're free, send a link, and settle on a date in four quick messages. No accounts, no server, nothing to install.</p>
    <button class="nb-button" data-act="new">${icon.cal}Start a plan</button>
    ${rows ? `<div class="nb-section"><span>Your plans</span></div><ul class="nb-list plans">${rows}</ul>` : ''}
    <div class="nb-section"><span>How it works</span></div>
    <ol class="nb-steps">
      <li><span class="nb-steps__n">1</span><div><h2 class="nb-h3">You share</h2><p>Pick the days you're free, lock them with a passphrase and send the link.</p></div></li>
      <li><span class="nb-steps__n">2</span><div><h2 class="nb-h3">They add theirs</h2><p>They see your days, mark their own and send the link back.</p></div></li>
      <li><span class="nb-steps__n">3</span><div><h2 class="nb-h3">You pick</h2><p>Only the days you're both free are shown. Choose one or a few.</p></div></li>
      <li><span class="nb-steps__n">4</span><div><h2 class="nb-h3">They confirm</h2><p>They lock in the final day, or several, and get a ready-made message to send.</p></div></li>
    </ol>
    <p class="nb-small how-group"><strong>Planning with a group?</strong> Choose "A group" when you start. Everyone gets the same link, sends their days back to you, and you lock in the day that suits the most people.</p>
    <p class="nb-privacy">${icon.lock}<span>Your days are encrypted in your browser and travel after the <code>#</code> in the link, which is never sent to any server. Plans you open are kept on this device only, until you forget them.</span></p>
  </main>`;
}

function viewUnlock() {
  return `<main class="page narrow">
    <p class="nb-context">A plan was shared with you</p>
    <h1 class="nb-display">Enter the <em>passphrase.</em></h1>
    <p class="nb-lead">It should have arrived separately from the link. Ask the sender if you don't have it.</p>
    <form class="card" data-form="unlock">
      <label class="nb-field"><span class="nb-field__label">Passphrase</span>
        <input class="nb-input" id="pass" type="${S.showPass ? 'text' : 'password'}" autocomplete="off" autocapitalize="none" spellcheck="false" value="${h(S.pass)}" data-input="pass" required>
      </label>
      <label class="nb-toggle"><input type="checkbox" data-act="show-pass" ${S.showPass ? 'checked' : ''}> Show passphrase</label>
      ${S.error ? `<p class="nb-field__error" role="alert">${h(S.error)}</p>` : ''}
      <button class="nb-button" type="submit" ${S.busy ? 'disabled' : ''}>${icon.lock}${S.busy ? 'Unlocking…' : 'Open plan'}</button>
    </form>
  </main>`;
}

function viewCompose() {
  const p = S.plan, mine = p.a.days, n = futureDays(mine, todayIso()).length;
  const theirs = p.b?.days || {}, B = nameOf(p, 'b', 'They');
  if (S.sent) return `<main class="page">${stepper(p, 1)}${banners()}<h1 class="nb-display">${S.editing ? 'Your new link.' : 'Two things to send.'}</h1>${sharePanel()}
    <button class="nb-text-button" data-act="unsend">${icon.left}Change my days</button></main>`;
  if (S.details) return `<main class="page narrow details">
    ${stepper(p, 1)}${banners()}
    <button class="nb-text-button back" data-act="back-cal">${icon.left}Your days</button>
    <p class="nb-context">${plural(n, 'day')} free${p.title ? ` · ${h(p.title)}` : ''}</p>
    <h1 class="nb-display">${S.editing ? 'Send the update.' : 'Almost there.'}</h1>
    <label class="nb-field"><span class="nb-field__label">Your name</span><input class="nb-input" data-input="a-name" value="${h(p.a.name)}" maxlength="40" autocomplete="given-name" placeholder="e.g. Sam"></label>
    <label class="nb-field"><span class="nb-field__label">What's it for? <small>Optional</small></span><input class="nb-input" data-input="title" value="${h(p.title)}" maxlength="80" placeholder="Dinner, a call, the hike"></label>
    ${p.b || S.editing ? '' : `<div class="nb-field"><span class="nb-field__label" id="who-l">Who's it for?</span><div class="nb-segmented" role="radiogroup" aria-labelledby="who-l">
      <button role="radio" aria-checked="${!p.group}" data-act="group" data-on="0">One person</button><button role="radio" aria-checked="${!!p.group}" data-act="group" data-on="1">A group</button></div>
      ${p.group ? '<p class="nb-small">Everyone gets the same link and sends their days back to you. Then you lock in the day that suits most people.</p>' : ''}</div>`}
    <div class="nb-field"><span class="nb-field__label" id="pass-l">The words that open it</span>
      <div class="nb-input-row"><input class="nb-input nb-input--mono" aria-labelledby="pass-l" data-input="pass" value="${h(S.pass)}" autocapitalize="none" spellcheck="false"><button class="nb-icon-button" data-act="reroll" aria-label="Suggest new words">${icon.dice}</button></div>
      <p class="nb-small">${S.editing ? 'Keep the same words so they don\'t need new ones.' : `${p.group ? 'Everyone' : 'They'}'ll need these to open the link. You send them separately.`}</p></div>
    ${S.error ? `<p class="nb-field__error" role="alert">${h(S.error)}</p>` : ''}
    <button class="nb-button nb-button--block" data-act="send" ${S.busy ? 'disabled' : ''}>${icon.lock}${S.busy ? 'Locking…' : S.editing ? 'Create my new link' : 'Create my link'}</button>
  </main>`;
  return `<main class="page compose">
    ${stepper(p, 1)}${banners()}
    ${S.editing ? '<p class="nb-context">Editing your days</p>' : ''}
    <h1 class="nb-sr-only">When are you free?</h1>
    ${calendar({ mine, theirs, lead: p.b ? `${h(B)}'s days are hatched the other way.` : "Tap the days you're free." })}
    ${tapHint(mine)}
    ${quickActions()}
    ${p.b ? legend(true, B) : ''}
    ${dock(n ? plural(n, 'day') + ' free' : 'No days yet', n ? '' : 'Tap a day to start', `<button class="nb-button nb-button--block" data-act="details">${S.editing ? 'Next' : 'Send to someone'}${icon.right}</button>`)}
  </main>`;
}

function viewRespond() {
  const p = S.plan, A = nameOf(p, 'a', 'They'), today = todayIso();
  const theirs = futureDays(p.a.days, today);
  const matches = futureDays(overlap(p.a.days, p.b.days), today);
  if (S.sent) return `<main class="page">${stepper(p, 2)}${banners()}<h1 class="nb-display">Send it <em>back.</em></h1>${sharePanel()}
    <button class="nb-text-button" data-act="unsend">${icon.left}Change my days</button></main>`;
  const short = d => `${formatDay(d, { weekday: 'short' })} ${parseIso(d).getUTCDate()}`;
  const list = matches.slice(0, 3).map(short).join(', ') + (matches.length > 3 ? '…' : '');
  return `<main class="page respond">
    ${stepper(p, 2)}${banners()}
    <p class="nb-context">${p.title ? `${h(p.title)} with ${h(A)}` : `From ${h(A)}`}${S.editing ? ' · Editing' : ''}</p>
    <h1 class="nb-display">When can you?</h1>
    ${p.group ? `<p class="nb-small">${h(A)} has invited a few people. Only ${h(A)} sees your reply.</p>` : ''}
    ${calendar({ mine: p.b.days, theirs: p.a.days, lead: `${h(A)} is free on ${plural(theirs.length, 'day')}. Tap the ones you can do.` })}
    ${tapHint(p.b.days)}
    ${quickActions()}
    ${legend(true, A)}
    <label class="nb-field name-field"><span class="nb-field__label">Your name</span><input class="nb-input" data-input="b-name" value="${h(p.b.name)}" maxlength="40" autocomplete="given-name" placeholder="e.g. Alex"></label>
    ${dock(matches.length ? `${plural(matches.length, 'day')} match` : 'No matches yet', h(list), `<button class="nb-button nb-button--block" data-act="send" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Locking…' : `Send ${S.editing ? 'my new days' : 'back'} to ${h(A)}`}${icon.right}</button>`)}
  </main>`;
}

function viewPick() {
  const p = S.plan, B = nameOf(p, 'b', 'They'), today = todayIso();
  const shared = Object.fromEntries(Object.entries(overlap(p.a.days, p.b.days)).filter(([d]) => d >= today));
  const n = Object.keys(shared).length;
  if (S.sent) return `<main class="page">${stepper(p, 3)}${banners()}<p class="nb-context">Step 3 of 4</p><h1 class="nb-display">Over to <em>${h(B)}.</em></h1>${sharePanel()}
    <button class="nb-text-button" data-act="unsend">${icon.left}Change my picks</button></main>`;
  if (!n) return `<main class="page">${stepper(p, 3)}${banners()}
    <p class="nb-context">Step 3 of 4 · Your turn</p>
    <h1 class="nb-display">No days <em>in common.</em></h1>
    <p class="nb-lead">${h(B)} replied, but none of your free days line up. You can add more days and send it back to them.</p>
    <section class="card">${calendar({ mine: p.a.days, theirs: p.b.days, readonly: true })}${legend(true, B)}</section>
    <button class="nb-button nb-button--block" data-act="revise">${icon.cal}Add more days</button></main>`;
  return `<main class="page">
    ${stepper(p, 3)}${banners()}
    <p class="nb-context">Step 3 of 4 · Your turn</p>
    <h1 class="nb-display">You're both free on <em>${plural(n, 'day')}.</em></h1>
    <p class="nb-lead">Pick the day you'd like, or a few to let ${h(B)} choose.</p>
    <section class="card">
      ${calendar({ allowed: shared, picked: p.picks, mode: 'pick' })}
      <div class="quick"><button class="nb-text-button" data-act="pick-all">Select all</button><button class="nb-text-button" data-act="pick-none">Clear</button></div>
    </section>
    <section class="card"><h2>Shared days <span class="count">${p.picks.length} picked</span></h2>${dayList(shared, { picked: p.picks })}</section>
    ${S.error ? `<p class="nb-field__error" role="alert">${h(S.error)}</p>` : ''}
    <button class="nb-button nb-button--block" data-act="send" ${S.busy || !p.picks.length ? 'disabled' : ''}>${icon.share}${S.busy ? 'Locking…' : p.picks.length === 1 ? `Propose this day` : `Send ${p.picks.length || ''} options`}</button>
    <button class="nb-text-button" data-act="revise">Change my free days instead</button>
  </main>`;
}

function viewConfirm() {
  const p = S.plan, A = nameOf(p, 'a', 'They'), today = todayIso();
  const opts = Object.fromEntries(p.picks.filter(d => d >= today).map(d => [d, meet(p.a.days[d] || 0, p.b.days[d] || 0) || FREE]));
  const n = Object.keys(opts).length;
  if (S.sent) return `<main class="page">${stepper(p, 4)}${banners()}<p class="nb-context">All done</p><h1 class="nb-display">It's <em>settled.</em></h1>${finalCard()}${sharePanel()}</main>`;
  return `<main class="page">
    ${stepper(p, 4)}${banners()}
    <p class="nb-context">Step 4 of 4 · Your turn</p>
    <h1 class="nb-display">${n === 1 ? `${h(A)} suggests <em>one day.</em>` : `Choose from <em>${plural(n, 'day')}.</em>`}</h1>
    <p class="nb-lead">${n ? `Lock in one day, or several if you're planning a few at once. You'll get a summary to send back.` : 'These days have passed. Change your days and send them back.'}</p>
    ${n ? `<section class="card"><h2>Days to lock in <span class="count">${S.choices.length} chosen</span></h2>${dayList(opts, { picked: S.choices, name: 'final', act: 'toggle-final' })}
      ${n > 1 ? `<div class="quick"><button class="nb-text-button" data-act="final-all">Select all</button><button class="nb-text-button" data-act="final-none">Clear</button></div>` : ''}</section>` : ''}
    ${S.error ? `<p class="nb-field__error" role="alert">${h(S.error)}</p>` : ''}
    ${n ? `<button class="nb-button nb-button--block" data-act="send" ${S.busy || !S.choices.length ? 'disabled' : ''}>${icon.cal}${S.busy ? 'Locking…' : S.choices.length > 1 ? `Lock in ${S.choices.length} days` : 'Lock in this day'}</button>` : ''}
    <button class="nb-text-button" data-act="revise">None of these work: change my days</button>
  </main>`;
}

// Organiser's view of a group plan: every reply so far, and how many can make each day.
function viewCollect() {
  const p = S.plan, today = todayIso(), people = S.people || [], labels = labelPeople(people);
  const all = groupDays(p.a.days, people);
  const days = Object.fromEntries(Object.entries(all).filter(([d]) => d >= today));
  const counts = Object.fromEntries(Object.entries(days).map(([d, g]) => [d, `${g.free.length + 1}/${people.length + 1}`]));
  const n = Object.keys(days).length, everyone = Object.keys(days).filter(d => days[d].free.length === people.length);
  if (S.sent) return `<main class="page">${stepper(p, 5)}${banners()}<p class="nb-context">All done</p><h1 class="nb-display">It's <em>settled.</em></h1>${finalCard()}${sharePanel()}</main>`;
  const replies = `<section class="card"><h2>Replies <span class="count">${plural(people.length, 'person')}</span></h2>
    ${people.length ? `<ul class="nb-list replies">${people.map(x => `<li class="nb-list__row"><strong class="nb-list__main">${h(labels[x.id])}</strong><small class="nb-list__aside">${plural(futureDays(x.days, today).length, 'day')} free</small></li>`).join('')}</ul>` : '<p class="nb-small">No replies yet. When someone sends their link back, open it and their days appear here.</p>'}
    ${S.invite ? `<button class="nb-text-button" data-act="show-invite">${icon.share}Send the invite to more people</button>` : ''}</section>`;
  const head = `${stepper(p, 3)}${banners()}<p class="nb-context">Step 3 of 3 · ${S.editing ? 'Editing' : 'Your turn'}</p>`;
  if (!n) return `<main class="page">${head}
    <h1 class="nb-display">${people.length ? `No days <em>that work yet.</em>` : `Waiting for <em>replies.</em>`}</h1>
    <p class="nb-lead">${people.length ? 'Nobody who replied can make any of your days. You can add more days and send everyone a new link.' : 'Open each reply link as it arrives. You can lock in a day once people have replied.'}</p>
    ${replies}${people.length ? `<button class="nb-button nb-button--block" data-act="revise">${icon.cal}Add more days</button>` : ''}</main>`;
  const list = `<ul class="nb-choices day-list">${Object.keys(days).sort().map(iso => {
    const on = p.picks.includes(iso), g = days[iso];
    return `<li><label class="nb-choice"><input type="checkbox" data-act="toggle-pick" data-day="${iso}" ${on ? 'checked' : ''}><span class="nb-choice__text"><strong>${h(formatDay(iso))}</strong>
      <small>${g.free.length + 1} of ${people.length + 1} can make it${g.maybe.length + (isMaybe(p.a.days[iso]) ? 1 : 0) ? ` (${g.maybe.length + (isMaybe(p.a.days[iso]) ? 1 : 0)} maybe)` : ''}${tagsOf(g.mask) ? ` · ${h(tagWords(g.mask))}` : ''}</small>
      <small class="who">${h([nameOf(p, 'a', 'You') + ' (you)' + (isMaybe(p.a.days[iso]) ? '?' : ''), ...g.free.map(id => labels[id] + (g.maybe.includes(id) ? '?' : ''))].join(', '))}</small></span></label></li>`;
  }).join('')}</ul>`;
  return `<main class="page">${head}
    <h1 class="nb-display">${plural(people.length, 'person')} ${people.length === 1 ? 'has' : 'have'} <em>replied.</em></h1>
    <p class="nb-lead">Numbers show how many can make each day, including you. Lock in one day or several. More replies can still come in: open them and this updates.</p>
    ${replies}
    <section class="card">
      ${calendar({ allowed: Object.fromEntries(Object.entries(days).map(([d, g]) => [d, g.mask])), picked: p.picks, mode: 'pick', counts })}
      <div class="quick">${everyone.length ? `<button class="nb-text-button" data-act="pick-everyone">Days everyone can do (${everyone.length})</button>` : ''}<button class="nb-text-button" data-act="pick-none">Clear</button></div>
    </section>
    <section class="card"><h2>Days that work <span class="count">${p.picks.length} picked</span></h2>${list}</section>
    ${S.error ? `<p class="nb-field__error" role="alert">${h(S.error)}</p>` : ''}
    <button class="nb-button nb-button--block" data-act="send" ${S.busy || !p.picks.length ? 'disabled' : ''}>${icon.cal}${S.busy ? 'Locking…' : p.picks.length > 1 ? `Lock in ${p.picks.length} days` : 'Lock in this day'}</button>
    <button class="nb-text-button" data-act="revise">Change my free days instead</button>
  </main>`;
}

// The settled plan as a poster: the date is the hero.
function finalCard() {
  const p = S.plan, finals = p.finals || [];
  const people = p.group ? (p.people || []) : [], labels = labelPeople(people);
  const who = p.group ? `${plural(people.length + 1, 'person')}` : [p.a.name, p.b?.name].filter(Boolean).join(' & ');
  const rows = finals.map(iso => {
    const dt = parseIso(iso), note = dayNote(p, iso) || 'any time';
    const going = p.group ? [p.a.name, ...(groupDays({ [iso]: p.a.days[iso] || FREE }, people)[iso]?.free || []).map(id => labels[id])].filter(Boolean) : [];
    return `<li><h2 class="nb-sr-only">${h(formatDay(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h2>
      <span class="nb-poster__line" aria-hidden="true">${h(formatDay(iso, { weekday: 'long' }))}</span>
      <span class="nb-poster__day" aria-hidden="true">${dt.getUTCDate()}</span>
      <span class="nb-poster__line" aria-hidden="true">${h(formatDay(iso, { month: 'long', year: 'numeric' }))}</span>
      <p class="nb-poster__note">${h(note[0].toUpperCase() + note.slice(1))}</p>${going.length ? `<p class="nb-poster__note">${h(going.join(', '))}</p>` : ''}</li>`;
  }).join('');
  return `<div class="nb-poster final-card ${finals.length > 1 ? 'nb-poster--multi' : ''}"><p class="nb-poster__what">${h(p.title || 'Meeting')}${who ? ` · ${h(who)}` : ''}</p><ul class="nb-poster__days">${rows}</ul><div class="nb-poster__hatch" aria-hidden="true"></div></div>`;
}

function viewDone() {
  const p = S.plan;
  return `<main class="page">${stepper(p, 5)}${banners()}
    <p class="nb-context">All done</p><h1 class="nb-display">It's <em>settled.</em></h1>
    ${finalCard()}
    <section class="card">
      <textarea class="nb-textarea" rows="4" aria-label="Summary" data-input="message">${h(S.sent?.text || finalSummary(p))}</textarea>
      <div class="nb-row"><button class="nb-button" data-act="copy-message">${icon.copy}Copy summary</button><button class="nb-button nb-button--secondary" data-act="ics">${icon.cal}Add to calendar</button></div>
      ${S.sent?.link ? linkField(S.sent.link) : ''}
    </section>
    ${canEdit() ? `<button class="nb-text-button" data-act="edit">${icon.cal}Change the final days</button>` : ''}
    <button class="nb-text-button" data-act="forget-current">Forget this plan on this device</button>
  </main>`;
}

// Who may change a link they made: the organiser before replies and after picking; the guest after replying
// and after confirming; in a group the organiser can also change the locked-in days.
function canEdit() {
  const p = S.plan, r = S.role;
  if (!p || !r) return false;
  if (p.step === 4) return p.group ? r === 'a' : r === 'b';
  return r === (p.step === 2 ? 'b' : 'a');
}

function viewWaiting() {
  const p = S.plan, groupOrg = p.group && S.role === 'a';
  const other = groupOrg ? 'everyone' : S.role === 'a' ? nameOf(p, 'b', 'your guest') : nameOf(p, 'a', 'the organiser');
  const n = (S.people || []).length;
  const editLabel = p.step === 3 ? 'Change my picks' : 'Edit my days';
  return `<main class="page">${stepper(p, p.step + 1)}${banners()}
    <p class="nb-context">Waiting</p><h1 class="nb-display">Over to <em>${h(other)}.</em></h1>
    <p class="nb-lead">${groupOrg ? `This is your invite link. Open each reply as it arrives${n ? `: ${plural(n, 'person')} so far` : ''}.` : `This is the link you sent. When ${h(other)} replies, open the link they send you.`} You can send it again if it got lost.</p>
    ${groupOrg && n ? `<button class="nb-button nb-button--block" data-act="collect">${icon.cal}See the ${plural(n, 'reply')} and lock in a day</button>` : ''}
    ${canEdit() ? `<button class="nb-button nb-button--secondary nb-button--block edit-btn" data-act="edit">${icon.cal}${editLabel}</button><p class="nb-small edit-note">You'll get a new link to send. The old one still opens, so tell them to use the new one.</p>` : ''}
    ${sharePanel()}</main>`;
}

const views = { home: viewHome, unlock: viewUnlock, compose: viewCompose, respond: viewRespond, pick: viewPick, confirm: viewConfirm, collect: viewCollect, waiting: viewWaiting, done: viewDone };

function render() {
  const active = document.activeElement;
  const keep = focusKey || active?.dataset?.focus || null;
  shownStep = 0;
  const main = views[S.view]().replace('<main class=', '<main id="main" tabindex="-1" class=');
  $app.innerHTML = `<a class="nb-skip" href="#main" data-act="skip">Skip to main content</a><div class="app-shell">${sidebar()}<div class="main-shell">${header()}${main}<footer>Calshare · free days only, never times or details · <a href="https://github.com/nbinding/calshare">Source</a></footer></div></div>` + (S.display ? displayDialog() : '') + (S.sheet && S.plan ? sheet() : '');
  if (keep) document.querySelector(`[data-focus="${keep}"]`)?.focus({ preventScroll: true });
  document.body.classList.toggle('nb-locked', !!(S.display || S.sheet));
  if (S.sheet && !document.querySelector('.sheet')?.contains(document.activeElement)) document.querySelector('.sheet [data-focus=sheet-done]')?.focus();
  if (S.display && !document.querySelector('.dialog')?.contains(document.activeElement)) document.querySelector('.dialog [data-focus=close-display]')?.focus();
  focusKey = null;
}

// Copy with a toast; the design system's copy() falls back to a hidden textarea where the clipboard is blocked.
async function copy(text, msg = 'Copied') { toast(await copyText(text) ? msg : 'Copy failed: select and copy by hand'); }

// ---------- Flow ----------
function startNew() {
  const start = monthOf(todayIso());
  const plan = { id: randomId(), step: 1, created: 0, title: '', start, count: MAX_MONTHS, group: false, a: { name: '', days: {}, v: 0 }, picks: [] };
  history.replaceState(null, '', baseUrl());
  set({ view: 'compose', plan, role: 'a', pass: suggestPassphrase(), hash: '', sent: null, error: '', notice: '', newer: null, monthIdx: 0, choices: [], editing: false, people: [], invite: null, details: false, sheet: null });
  scrollTo(0, 0);
}

function enterPlan(plan, role, pass, hash) {
  const rec = recordFor(plan.id), saved = rec?.wire ? (() => { try { return fromWire(rec.wire); } catch { return null; } })() : null;
  const groupOrg = plan.group && role === 'a';
  const newer = !groupOrg && rec && rec.hash !== hash && (rec.wire?.s || 0) > plan.step ? rec.hash : null;
  const work = clone(plan), extra = {};
  let notice = '';

  // Each person owns their own days: if this device has a newer version of mine than the link carries
  // (I edited after the other person last saw them), keep mine.
  const mine = role === 'a' ? 'a' : 'b';
  if (saved?.[mine] && work[mine] && saved[mine].v > work[mine].v && (mine === 'a' || saved.b?.id === work.b?.id)) {
    work[mine] = saved[mine];
    if (plan.step !== 4) notice = `${role === 'a' ? (plan.group ? 'This reply was' : `${h(nameOf(plan, 'b', 'They'))} replied`) : `${h(nameOf(plan, 'a', 'They'))} answered`} to an earlier version of your days. Your latest days are kept.`;
  }

  // Groups: the organiser files each reply under the guest's hidden id; a newer reply from the same guest replaces the older one.
  let people = [];
  if (groupOrg) {
    const replies = { ...(rec?.replies || {}) };
    if (plan.step === 2 && plan.b?.id) {
      const old = replies[plan.b.id];
      if (!old || (old.v || 0) <= plan.b.v) replies[plan.b.id] = { n: plan.b.name, d: encodeDays(plan.b.days, plan.start, plan.count), v: plan.b.v };
      else notice = `This is an older reply from ${h(plan.b.name || 'a guest')}. Their newer reply is kept.`;
    }
    extra.replies = replies;
    if (plan.step === 1) extra.invite = hash;
    people = repliesOf({ replies }, plan);
    if (plan.step === 2 || plan.step === 1) { // keep the organiser's own latest plan, not the copy inside the reply
      if (saved) { work.a = saved.a.v >= work.a.v ? saved.a : work.a; work.title = saved.title; }
      delete work.b;
      work.step = saved?.step === 4 ? 4 : 1;
      work.finals = saved?.finals; work.people = saved?.people;
      work.picks = saved?.step === 4 ? [...(saved.finals || [])] : [];
      if (saved?.step === 4 && plan.step === 2) notice = notice || 'A new reply arrived after you locked it in. You can change the final days below.';
    }
  }

  const turn = turnAfter(plan.step);
  let view;
  if (groupOrg && plan.step === 2) view = 'collect';
  else if (groupOrg && plan.step === 1) view = work.step === 4 ? 'done' : 'waiting';
  else if (plan.step === 4) view = 'done';
  else if (role !== turn) view = 'waiting';
  else view = { 1: 'respond', 2: 'pick', 3: 'confirm' }[plan.step];

  // A guest keeps one hidden id per plan, so a second reply replaces the first instead of adding a duplicate.
  if (role === 'b') {
    const id = rec?.myId || work.b?.id || randomId(9);
    extra.myId = id;
    if (view === 'respond') {
      if (plan.group && saved?.b && saved.b.id === id) work.b = saved.b; // reopening the invite: start from my last reply
      if (!work.b) work.b = { name: '', days: {}, id, v: 0 };
      work.b.id = id;
    }
  }
  if (view === 'pick') work.picks = work.picks.filter(d => meet(work.a.days[d] || 0, work.b.days[d] || 0));

  const inviteHash = groupOrg ? (extra.invite || rec?.invite || hash) : null;
  // The organiser's latest own link in a group (invite, or the locked-in days) stays the plan's home link.
  const homeHash = groupOrg ? (rec?.role === 'a' && rec.hash ? rec.hash : hash) : hash;
  const link = `${baseUrl()}#${groupOrg && view !== 'done' ? inviteHash : homeHash}`;
  const code = role === 'b' && plan.group ? shortCode(extra.myId) : null;
  const sent = view === 'waiting' ? { link, text: draftMessage(work, link), step: work.step, code }
    : view === 'done' ? { link, text: finalSummary(work, link), step: 4 } : null;
  if (!newer) remember(work, role, pass, homeHash, extra);

  // Show the first month that has something to act on
  const months = rangeMonths(plan.start, plan.count), today = todayIso();
  const focusDays = view === 'pick' ? Object.keys(overlap(work.a.days, work.b.days)) : view === 'collect' ? Object.keys(groupDays(work.a.days, people)) : Object.keys(work.a.days);
  const first = focusDays.filter(d => d >= today).sort()[0] || today;
  const monthIdx = Math.max(0, months.indexOf(monthOf(first)));
  const choices = view === 'confirm' && work.picks.length === 1 ? [...work.picks] : [];
  set({ view, plan: work, role, pass, hash, sent, newer, error: '', busy: false, monthIdx, choices, notice, editing: false, people, invite: inviteHash, details: false, sheet: null });
  scrollTo(0, 0);
}

async function tryOpen(hash, pass) {
  const [, code] = hash.split('.');
  const wire = await open(code, pass);
  const plan = fromWire(wire);
  if (plan.id !== hash.split('.')[0]) throw new Error('bad link');
  return plan;
}

let routedOnce = false; // a fresh visit opens straight on the calendar; the brand link shows your plans
async function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (!hash) { if (!routedOnce || S.view !== 'home') startNew(); routedOnce = true; return; }
  routedOnce = true;
  if (!/^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{40,}$/.test(hash)) {
    set({ view: 'home', notice: '' }); toast("That link looks incomplete. Ask for it to be sent again."); return;
  }
  const rec = recordFor(hash.split('.')[0]);
  if (rec?.pass) {
    set({ view: 'unlock', busy: true, pass: rec.pass, error: '' });
    try { const plan = await tryOpen(hash, rec.pass); enterPlan(plan, rec.role || turnAfter(plan.step) || 'a', rec.pass, hash); return; }
    catch { /* fall through and ask */ }
  }
  set({ view: 'unlock', busy: false, pass: '', error: '', plan: null, sent: null });
  document.getElementById('pass')?.focus();
}

async function unlock() {
  const hash = decodeURIComponent(location.hash.slice(1)), pass = S.pass.trim();
  if (!pass) return set({ error: 'Enter the passphrase.' });
  set({ busy: true, error: '' });
  try {
    const plan = await tryOpen(hash, pass);
    const rec = recordFor(plan.id);
    enterPlan(plan, rec?.role || turnAfter(plan.step) || 'b', pass, hash);
  } catch (e) {
    set({ busy: false, error: e instanceof WrongPassphrase ? "That passphrase doesn't open this link. Check for typos or ask the sender." : 'This link is damaged or incomplete. Ask for it to be sent again.' });
  }
}

async function send() {
  const p = S.plan, today = todayIso();
  let next = clone(p);
  if (S.view === 'compose') {
    if (!p.a.name.trim()) return set({ error: 'Add your name so they know who it is from.' });
    if (!futureDays(p.a.days, today).length) return set({ error: 'Mark at least one day you are free.', details: false });
    if (S.pass.trim().length < 6) return set({ error: 'Use a passphrase of at least 6 characters.' });
    next.step = 1; next.picks = []; delete next.finals; delete next.people;
    if (next.group) delete next.b;
    next.a.v = (p.a.v || 0) + 1;
  } else if (S.view === 'respond') {
    if (!p.b.name.trim()) return set({ error: 'Add your name so they know who replied.' });
    if (!futureDays(p.b.days, today).length) return set({ error: 'Mark at least one day you are free.' });
    next.step = 2; next.picks = []; delete next.finals;
    next.b.v = (p.b.v || 0) + 1;
  } else if (S.view === 'collect') {
    if (!p.picks.length) return set({ error: 'Pick at least one day.' });
    next.step = 4; next.finals = [...p.picks].sort(); next.picks = [];
    next.people = (S.people || []).map(x => ({ name: x.name, id: x.id, days: x.days }));
    delete next.b;
  } else if (S.view === 'pick') {
    if (!p.picks.length) return set({ error: 'Pick at least one day.' });
    next.step = 3; next.picks = [...p.picks].sort(); delete next.finals;
  } else if (S.view === 'confirm') {
    if (!S.choices.length) return set({ error: 'Choose at least one day.' });
    next.step = 4; next.finals = [...S.choices].sort();
  }
  next.a.name = next.a.name.trim(); if (next.b) next.b.name = next.b.name.trim(); next.title = next.title.trim();
  next.created = Date.now();
  set({ busy: true, error: '' });
  try {
    const sealed = await seal(toWire(next), S.pass.trim());
    const hash = `${next.id}.${sealed}`, link = `${baseUrl()}#${hash}`;
    const extra = next.group && S.role === 'a' && next.step === 1 ? { invite: hash } : {};
    if (S.role === 'b' && next.b?.id) extra.myId = next.b.id;
    remember(next, S.role, S.pass.trim(), hash, extra);
    history.replaceState(null, '', `#${hash}`);
    const text = draftMessage(next, link, { update: S.editing });
    const code = next.group && S.role === 'b' ? shortCode(next.b.id) : null;
    set({ busy: false, plan: next, hash, sent: { link, text, step: next.step, code }, pass: S.pass.trim(), invite: extra.invite || S.invite });
    scrollTo(0, 0);
  } catch (e) {
    set({ busy: false, error: 'Could not lock the plan in this browser. Try a recent version of Chrome, Safari, Firefox or Edge.' });
  }
}

// Go back to editing my own days and resend (owner → step 1 again, guest → step 2 again).
function revise() {
  const p = clone(S.plan);
  p.picks = []; delete p.finals;
  if (S.role === 'a' && p.group) set({ view: 'compose', plan: p, sent: null, error: '', editing: true, notice: 'Add more days, then send everyone the new link. Replies you already have are kept.' });
  else if (S.role === 'a') set({ view: 'compose', plan: p, sent: null, error: '', notice: 'Add more days, then send the new link. Their days stay marked with a dashed outline.' });
  else set({ view: 'respond', plan: p, sent: null, error: '', notice: 'Change your days, then send the new link back.' });
  scrollTo(0, 0);
}

// Change a link that was already sent: reopen the step that made it, filled in, and send a new link.
function edit() {
  const p = clone(S.plan), r = S.role;
  const base = { plan: p, sent: null, error: '', notice: '', editing: true, details: false, sheet: null };
  if (p.step === 4 && p.group) { p.picks = [...(p.finals || [])]; delete p.finals; set({ ...base, view: 'collect' }); }
  else if (p.step === 4) { const finals = p.finals || []; delete p.finals; set({ ...base, view: 'confirm', choices: [...finals] }); }
  else if (p.step === 3) set({ ...base, view: 'pick' });
  else if (r === 'b') set({ ...base, view: 'respond' });
  else set({ ...base, view: 'compose' });
  scrollTo(0, 0);
}

function myDays() { return S.role === 'a' ? S.plan.a.days : S.plan.b.days; }

function fill(kind) {
  const p = S.plan, mo = rangeMonths(p.start, p.count)[S.monthIdx], today = todayIso(), days = myDays();
  for (const iso of rangeDays(mo, 1)) {
    if (iso < today) continue;
    const wd = weekdayIndex(iso);
    if (kind === 'clear') delete days[iso];
    else if ((kind === 'weekends') === (wd >= 5)) days[iso] = days[iso] || FREE;
  }
  render();
}

// ---------- Events ----------
$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const p = S.plan;
  switch (act) {
    case 'home': e.preventDefault(); history.pushState(null, '', baseUrl()); set({ view: 'home', plan: null, sent: null, notice: '', newer: null }); break;
    case 'skip': e.preventDefault(); document.getElementById('main')?.focus(); break;
    case 'open-display': set({ display: true }); break;
    case 'close-display': focusKey = 'open-display'; set({ display: false }); break;
    case 'pref': { const k = el.dataset.key, v = el.dataset.value; prefs = { ...prefs, [k]: k === 'size' ? Number(v) : v }; applyPrefs(); render(); break; }
    case 'reset-display': prefs = { ...defaultPrefs }; applyPrefs(); focusKey = 'close-display'; render(); toast('Display settings reset'); break;
    case 'new': startNew(); break;
    case 'time': { const d = myDays(), iso = el.dataset.day; d[iso] = setTime(d[iso] || FREE, Number(el.dataset.bit)); focusKey = el.dataset.focus; render(); break; }
    case 'remove-day': delete myDays()[el.dataset.day]; if (S.sheet && S.sheet !== 'all') { focusKey = `day-${S.sheet}`; S.sheet = null; } render(); break;
    case 'sure': { const d = myDays(), iso = el.dataset.day; d[iso] = setMaybe(d[iso] || FREE, el.dataset.maybe === '1'); focusKey = el.dataset.focus; render(); break; }
    case 'count': p.count = Number(el.dataset.c); trimToRange(); set({ monthIdx: Math.min(S.monthIdx, p.count - 1) }); break;
    case 'month': { const i = Number(el.dataset.i); if (i >= 0 && i < p.count) set({ monthIdx: i }); break; }
    case 'day': {
      const iso = el.dataset.day;
      if (heldDay === iso) { heldDay = null; break; } // the hold already opened the sheet
      focusKey = `day-${iso}`;
      if (S.view === 'pick' || S.view === 'collect') { const i = p.picks.indexOf(iso); i >= 0 ? p.picks.splice(i, 1) : p.picks.push(iso); }
      else { const d = myDays(), m = cycle(d[iso] || 0); if (m) d[iso] = m; else delete d[iso]; }
      set({ error: '' }); break;
    }
    case 'fill': fill(el.dataset.kind); break;
    case 'pick-all': p.picks = Object.keys(overlap(p.a.days, p.b.days)).filter(d => d >= todayIso()); render(); break;
    case 'pick-none': p.picks = []; render(); break;
    case 'final-all': set({ choices: p.picks.filter(d => d >= todayIso()), error: '' }); break;
    case 'final-none': set({ choices: [] }); break;
    case 'reroll': set({ pass: suggestPassphrase() }); break;
    case 'send': send(); break;
    case 'unsend': set({ sent: null }); break;
    case 'revise': revise(); break;
    case 'edit': edit(); break;
    case 'details':
      if (!futureDays(myDays(), todayIso()).length) { set({ error: 'Tap at least one day you are free.' }); break; }
      set({ details: true, error: '' }); scrollTo(0, 0); break;
    case 'back-cal': set({ details: false, error: '' }); scrollTo(0, 0); break;
    case 'open-sheet': set({ sheet: 'all' }); break;
    case 'close-sheet': focusKey = S.sheet === 'all' ? 'open-sheet' : `day-${S.sheet}`; set({ sheet: null }); break;
    case 'group': p.group = el.dataset.on === '1'; render(); break;
    case 'collect': set({ view: 'collect', sent: null, notice: '' }); scrollTo(0, 0); break;
    case 'show-invite': { const link = `${baseUrl()}#${S.invite}`; set({ view: 'waiting', plan: { ...clone(p), step: 1 }, sent: { link, text: draftMessage({ ...p, step: 1 }, link), step: 1 } }); scrollTo(0, 0); break; }
    case 'pick-everyone': { const g = groupDays(p.a.days, S.people || []); p.picks = Object.keys(g).filter(d => d >= todayIso() && g[d].free.length === (S.people || []).length); render(); break; }
    case 'copy-message': copy(document.querySelector('[data-input=message]')?.value || S.sent.text, 'Message copied'); break;
    case 'copy-link': copy(S.sent.link, 'Link copied'); break;
    case 'copy-pass': copy(S.pass, 'Passphrase copied'); break;
    case 'native-share': navigator.share({ text: document.querySelector('[data-input=message]')?.value || S.sent.text }).catch(() => {}); break;
    case 'ics': {
      const url = URL.createObjectURL(new Blob([icsFor(p)], { type: 'text/calendar' }));
      Object.assign(document.createElement('a'), { href: url, download: `${(p.title || 'meet-up').replace(/[^\w-]+/g, '-').toLowerCase()}-${p.finals[0]}.ics` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); break;
    }
    case 'forget': forget(el.dataset.id); render(); toast('Forgotten on this device'); break;
    case 'forget-current': forget(p.id); history.pushState(null, '', baseUrl()); set({ view: 'home', plan: null, sent: null }); toast('Forgotten on this device'); break;
    case 'open-newer': location.hash = S.newer; break;
    case 'show-pass': set({ showPass: el.checked }); break;
  }
});

// Holding a day (or right-clicking it) opens its sheet: time, maybe, remove. Tapping still cycles the time.
let holdTimer = null, heldDay = null;
const editingDays = () => ['compose', 'respond'].includes(S.view) && !S.sent && !S.details;
function openDaySheet(iso, fromHold) {
  const d = myDays();
  if (!d[iso]) d[iso] = FREE;
  heldDay = fromHold ? iso : null; // a hold is followed by a click on release, which must not also cycle the day
  set({ sheet: iso, error: '' });
}
$app.addEventListener('pointerdown', e => {
  const el = e.target.closest('.calendar.edit [data-act=day]');
  if (!el || el.disabled || !editingDays()) return;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => openDaySheet(el.dataset.day, true), 480);
});
for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'scroll']) $app.addEventListener(ev, () => clearTimeout(holdTimer), true);
$app.addEventListener('pointerup', () => { if (heldDay) setTimeout(() => { heldDay = null; }, 0); });
$app.addEventListener('contextmenu', e => {
  const el = e.target.closest('.calendar.edit [data-act=day]');
  if (!el || el.disabled || !editingDays()) return;
  e.preventDefault(); clearTimeout(holdTimer);
  if (S.sheet !== el.dataset.day) openDaySheet(el.dataset.day);
});

$app.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'pref-toggle') { prefs = { ...prefs, [el.dataset.key]: el.checked }; applyPrefs(); render(); return; }
  if (el.dataset.act === 'toggle-pick') {
    const p = S.plan, iso = el.dataset.day, i = p.picks.indexOf(iso);
    if (el.checked && i < 0) p.picks.push(iso); if (!el.checked && i >= 0) p.picks.splice(i, 1);
    render();
  } else if (el.dataset.act === 'toggle-final') {
    const iso = el.dataset.day, c = S.choices.filter(d => d !== iso);
    if (el.checked) c.push(iso);
    set({ choices: c, error: '' });
  }
  else if (el.dataset.input === 'start') { S.plan.start = el.value; trimToRange(); set({ monthIdx: 0 }); }
});

$app.addEventListener('input', e => {
  const el = e.target, k = el.dataset.input, p = S.plan;
  if (k === 'a-name') p.a.name = el.value;
  else if (k === 'b-name') p.b.name = el.value;
  else if (k === 'title') p.title = el.value;
  else if (k === 'pass') S.pass = el.value;
  else if (k === 'message' && S.sent) S.sent.text = el.value;
});

$app.addEventListener('focusin', e => {
  if (e.target.matches('[data-select]')) setTimeout(() => { try { e.target.setSelectionRange(0, e.target.value.length); } catch {} }, 0);
});

$app.addEventListener('submit', e => { e.preventDefault(); if (e.target.dataset.form === 'unlock') unlock(); });

function trimToRange() {
  const p = S.plan, keep = new Set(rangeDays(p.start, p.count));
  for (const who of ['a', 'b']) if (p[who]) for (const d of Object.keys(p[who].days)) if (!keep.has(d)) delete p[who].days[d];
}

addEventListener('keydown', e => {
  if (!S.display && !S.sheet) return;
  if (e.key === 'Escape') {
    if (S.display) { focusKey = 'open-display'; set({ display: false }); }
    else { focusKey = S.sheet === 'all' ? 'open-sheet' : `day-${S.sheet}`; set({ sheet: null }); }
    return;
  }
  if (e.key === 'Tab') { // keep focus inside the dialog or sheet
    const f = [...document.querySelectorAll(S.display ? '.dialog button, .dialog input' : '.sheet button')];
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  }
});

// hashchange and popstate can both fire for one navigation; route once.
let routeQueued = false;
function queueRoute() { if (routeQueued) return; routeQueued = true; setTimeout(() => { routeQueued = false; route(); }, 0); }
addEventListener('hashchange', queueRoute);
addEventListener('popstate', queueRoute);
route();
