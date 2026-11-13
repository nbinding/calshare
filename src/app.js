import { seal, open, WrongPassphrase, suggestPassphrase } from './share.js';
import {
  FREE, TAGS, MAX_MONTHS, paint, meet, overlap, isFree, tagsOf, tagWords,
  todayIso, monthOf, addMonths, rangeMonths, rangeDays, daysInMonth, weekdayIndex, parseIso,
  toWire, fromWire, turnAfter, isStale, formatDay, formatMonth, draftMessage, finalSummary, icsFor,
} from './core.js';

// ---------- Local storage (this device only) ----------
const STORE = 'calshare-v1';
function loadStore() { try { return JSON.parse(localStorage.getItem(STORE)) || { plans: {} }; } catch { return { plans: {} }; } }
function saveStore(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* private mode: carry on without saving */ } }
function remember(plan, role, pass, hash) {
  const s = loadStore();
  s.plans[plan.id] = { role, pass, hash, wire: toWire(plan), updated: Date.now() };
  saveStore(s);
}
function forget(id) { const s = loadStore(); delete s.plans[id]; saveStore(s); }
function recordFor(id) { return loadStore().plans[id]; }

// ---------- Helpers ----------
const $app = document.getElementById('app');
const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, w) => `${n} ${n === 1 ? w : w.endsWith('ch') ? w + 'es' : w + 's'}`;
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
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
  view: 'home',      // home | unlock | compose | respond | pick | confirm | waiting | done
  plan: null, role: null, pass: '', hash: '',
  brush: 0, monthIdx: 0,
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
function applyPrefs() {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', prefs.size / 100);
  if (prefs.theme === 'system') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  root.dataset.font = prefs.font;
  root.dataset.dateHelp = String(prefs.dateHelp);
  root.dataset.spacing = String(prefs.spacing);
  root.dataset.motion = String(prefs.motion);
  try { sessionStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* private mode: still applies for this page */ }
}
applyPrefs();

function displayDialog() {
  const opt = (key, value, label, sub = '') => `<button type="button" data-act="pref" data-key="${key}" data-value="${value}" data-focus="pref-${key}-${value}" aria-pressed="${prefs[key] === value}">${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
  const toggle = (key, title, desc) => `<label class="setting-toggle"><input type="checkbox" data-act="pref-toggle" data-key="${key}" data-focus="pref-${key}" ${prefs[key] ? 'checked' : ''}><span><strong>${title}</strong><small>${desc}</small></span></label>`;
  return `<div class="backdrop" data-act="close-display"></div>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="display-h">
    <div class="dialog-head"><h2 id="display-h">Display and accessibility</h2><button class="icon-button" data-act="close-display" data-focus="close-display" aria-label="Close">${icon.close}</button></div>
    <p class="small">Make Calshare comfortable for you. These settings stay in this tab for the current browser session, including refreshes. Your plans are saved separately.</p>
    <fieldset><legend>Text size</legend><div class="setting-options">${[[100, 'Standard'], [115, 'Large'], [130, 'Larger'], [150, 'Largest']].map(([v, l]) => opt('size', v, l, v + '%')).join('')}</div><p class="small">Browser zoom also works.</p></fieldset>
    <fieldset><legend>Reading font</legend><div class="setting-options">${opt('font', 'default', 'Original')}${opt('font', 'sans', 'Plain sans')}${opt('font', 'dyslexic', 'OpenDyslexic')}</div><p class="small">Choose whichever feels easiest to read. OpenDyslexic is included with the app.</p></fieldset>
    <fieldset><legend>Appearance</legend><div class="setting-options">${opt('theme', 'system', 'Use device')}${opt('theme', 'light', 'Light')}${opt('theme', 'dark', 'Dark')}</div></fieldset>
    ${toggle('dateHelp', 'Help with dates', 'Show the weekday inside every day, label today in words and draw outlines more strongly.')}
    ${toggle('spacing', 'More breathing room', 'Increase line height, letter spacing and spacing between words.')}
    ${toggle('motion', 'Reduce motion', 'Remove animations and transitions.')}
    <div class="settings-preview" aria-hidden="true"><span class="eyebrow">Reading preview</span><p><strong>Saturday 21 November</strong></p><p class="small">Both free in the evening</p></div>
    <div class="dialog-actions"><button class="secondary" data-act="reset-display">Reset display settings</button><button class="primary" data-act="close-display">Done</button></div>
  </div>`;
}

// ---------- Rendering pieces ----------
function header() {
  return `<header class="topbar">
    <a class="brand" href="${h(baseUrl())}" data-act="home"><span class="brand-mark">c</span>calshare<span class="brand-period">.</span></a>
    <div class="top-actions">
      <button class="chip-button" data-act="open-display" data-focus="open-display" aria-label="Display and accessibility settings" aria-haspopup="dialog">${icon.settings}<span>Display</span></button>
    </div>
  </header>`;
}

function stepper(plan, step) {
  const A = nameOf(plan, 'a', 'Organiser'), B = nameOf(plan, 'b', 'Guest');
  const labels = [`${A} shares`, `${B} adds days`, `${A} picks`, `${B} confirms`];
  return `<ol class="stepper" aria-label="Progress">${labels.map((l, i) => {
    const n = i + 1, cls = n < step ? 'done' : n === step ? 'current' : '';
    return `<li class="${cls}" ${n === step ? 'aria-current="step"' : ''}><span class="dot">${n < step ? '✓' : n}</span><span class="label">${h(l)}</span></li>`;
  }).join('')}</ol>`;
}

function banners() {
  const out = [];
  if (S.newer) out.push(`<div class="note"><p><strong>This is an older link.</strong> You already have a later step of this plan saved on this device.</p><button class="text-button" data-act="open-newer">Open the latest</button></div>`);
  if (S.plan && isStale(S.plan) && S.view !== 'done') {
    const days = Math.floor((Date.now() - S.plan.created) / 86400000);
    out.push(`<div class="note"><p><strong>This link is ${days} days old.</strong> Plans may have changed since it was sent, so check it's still current.</p></div>`);
  }
  if (S.notice) out.push(`<div class="note"><p>${S.notice}</p></div>`);
  return out.join('');
}

// Calendar. mode: 'edit' (paint my days), 'pick' (choose among overlaps), 'view'
function calendar({ mine = {}, theirs = {}, allowed = null, picked = [], mode = 'edit', readonly = false }) {
  const p = S.plan, months = rangeMonths(p.start, p.count), today = todayIso();
  const idx = Math.min(S.monthIdx, months.length - 1), mo = months[idx];
  const count = (m, src) => Object.keys(src).filter(d => monthOf(d) === m).length;
  const tabs = months.length > 1 ? `<div class="month-tabs" role="tablist">${months.map((m, i) => {
    const n = mode === 'pick' ? count(m, allowed || {}) : count(m, mine);
    return `<button role="tab" aria-selected="${i === idx}" data-act="month" data-i="${i}">${h(formatMonth(m).split(' ')[0].slice(0, 3))}${n ? `<small>${n}</small>` : ''}</button>`;
  }).join('')}</div>` : '';
  const lead = weekdayIndex(`${mo}-01`);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cell blank" aria-hidden="true"></span>');
  for (let d = 1; d <= daysInMonth(mo); d++) {
    const iso = `${mo}-${String(d).padStart(2, '0')}`;
    const m = mine[iso] || 0, t = theirs[iso] || 0, past = iso < today;
    const both = meet(m, t);
    const cls = ['cell'];
    let label = formatDay(iso), pressed = null, disabled = past || readonly;
    let tagMask = m;
    if (mode === 'edit') {
      if (isFree(m)) cls.push('mine');
      if (isFree(t)) cls.push('theirs');
      if (both) cls.push('both');
      pressed = isFree(m);
      if (!isFree(m)) tagMask = t;
      label += isFree(m) ? `, you're free ${tagWords(m)}` : ', not marked';
      if (isFree(t)) label += `, they're free ${tagWords(t)}`;
    } else {
      const ok = allowed && allowed[iso];
      tagMask = ok || 0;
      if (ok) cls.push('allowed'); else disabled = true;
      if (picked.includes(iso)) { cls.push('mine'); pressed = true; } else if (ok) pressed = false;
      if (ok) label += `, both free ${tagWords(ok)}`;
      if (mode === 'view') disabled = true;
    }
    if (past) cls.push('past');
    if (iso === today) cls.push('today');
    const tags = tagsOf(tagMask) ? TAGS.filter(x => tagMask & x.bit).map(x => x.label[0]).join('') : '';
    cells.push(`<button class="${cls.join(' ')}" data-act="day" data-day="${iso}" data-focus="day-${iso}" ${disabled ? 'disabled' : ''} ${pressed != null ? `aria-pressed="${pressed}"` : ''} aria-label="${h(label)}"><span class="wd" aria-hidden="true">${iso === today ? 'Today' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekdayIndex(iso)]}</span><span class="num">${d}</span>${tags ? `<span class="tags">${tags}</span>` : ''}</button>`);
  }
  return `<div class="calendar">
    ${tabs}
    <div class="month-head">
      <button class="icon-button" data-act="month" data-i="${idx - 1}" ${idx === 0 ? 'disabled' : ''} aria-label="Previous month">${icon.left}</button>
      <h3 aria-live="polite">${h(formatMonth(mo))}</h3>
      <button class="icon-button" data-act="month" data-i="${idx + 1}" ${idx === months.length - 1 ? 'disabled' : ''} aria-label="Next month">${icon.right}</button>
    </div>
    <div class="grid weekdays" aria-hidden="true">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="grid days">${cells.join('')}</div>
  </div>`;
}

const HINT_KEY = 'calshare-hint-marking';
function hintDismissed() { try { return localStorage.getItem(HINT_KEY) === 'done'; } catch { return false; } }

// A small picture of a day square, used in the marking guide.
const mini = (n, { on = false, tags = '' } = {}) =>
  `<span class="mini-cell${on ? ' on' : ''}" aria-hidden="true"><span>${n}</span>${tags ? `<small>${tags}</small>` : ''}</span>`;
const arrow = '<span class="mini-arrow" aria-hidden="true">→</span>';

function markingGuide() {
  if (hintDismissed() && !S.showHint) return `<button class="text-button hint-open" data-act="hint-open">How marking days works</button>`;
  return `<aside class="hint" aria-labelledby="hint-h">
    <h3 id="hint-h">How to mark your days</h3>
    <ol>
      <li><div class="hint-pic">${mini(14)}${arrow}${mini(14, { on: true })}</div>
        <p><strong>Tap a day</strong> with <em>Any time</em> selected: you're free all day. Tap it again to clear it.</p></li>
      <li><div class="hint-pic">${mini(14)}${arrow}${mini(14, { on: true, tags: 'M' })}</div>
        <p><strong>Choose Morning, Afternoon or Evening</strong>, then tap a day. Its letter appears on the day.</p></li>
      <li><div class="hint-pic">${mini(14, { on: true, tags: 'M' })}${arrow}${mini(14, { on: true, tags: 'ME' })}</div>
        <p><strong>Tap the same day with another time</strong> to add it too. Tap with a time it already has to remove that time.</p></li>
    </ol>
    <p class="small hint-key"><strong>M</strong> morning · <strong>A</strong> afternoon · <strong>E</strong> evening · no letter means any time</p>
    <button class="secondary hint-done" data-act="hint-done">Got it</button>
  </aside>`;
}

function brushBar() {
  const opts = [{ bit: 0, label: 'Any time', letter: '' }, ...TAGS.map(t => ({ ...t, letter: t.label[0] }))];
  return `${markingGuide()}<div class="brush"><p class="small">Tap days to mark them as</p>
    <div class="segmented" role="radiogroup" aria-label="Mark days as">${opts.map(o =>
      `<button role="radio" aria-checked="${S.brush === o.bit}" data-act="brush" data-bit="${o.bit}">${o.label}${o.letter ? `<span class="brush-letter" aria-hidden="true">${o.letter}</span>` : ''}</button>`).join('')}</div>
  </div>`;
}

function quickActions() {
  return `<div class="quick"><button class="text-button" data-act="fill" data-kind="weekends">+ Weekends</button><button class="text-button" data-act="fill" data-kind="weekdays">+ Weekdays</button><button class="text-button" data-act="fill" data-kind="clear">Clear month</button></div>`;
}

function legend(withTheirs, theirName) {
  return `<ul class="legend" aria-label="Key">
    <li><span class="swatch mine"></span>You're free</li>
    ${withTheirs ? `<li><span class="swatch theirs"></span>${h(theirName)} is free</li><li><span class="swatch both"></span>Both free</li>` : ''}
    <li><span class="swatch tagkey">MAE</span>Morning, afternoon, evening</li>
  </ul>`;
}

function dayList(days, { picked = null, radio = false, name = 'day', act = null } = {}) {
  const list = Object.keys(days).sort();
  if (!list.length) return '';
  return `<ul class="day-list">${list.map(iso => {
    const on = picked?.includes(iso);
    const control = picked ? `<input type="${radio ? 'radio' : 'checkbox'}" name="${name}" data-act="${act || (radio ? 'choose' : 'toggle-pick')}" data-day="${iso}" ${on ? 'checked' : ''}>` : '';
    return `<li><label class="${picked ? 'choice' : ''} ${on ? 'selected' : ''}">${control}<span><strong>${h(formatDay(iso))}</strong><small>${h(tagWords(days[iso]))}</small></span></label></li>`;
  }).join('')}</ul>`;
}

function linkField(link) {
  return `<div class="linkbox"><label class="eyebrow" for="link-only">Link on its own</label>
    <textarea id="link-only" class="link-only" readonly rows="3" data-select spellcheck="false">${h(link)}</textarea>
    <p class="small">If the copy buttons don't work in your browser, tap the link above, then select all and copy it.</p></div>`;
}

function sharePanel() {
  const { link, text, step } = S.sent;
  const p = S.plan, other = S.role === 'a' ? nameOf(p, 'b', 'them') : nameOf(p, 'a', 'them');
  const canShare = typeof navigator.share === 'function';
  const title = step === 4 ? 'Send the confirmation' : `Send it to ${h(other)}`;
  const long = link.length > 1800 ? `<p class="small warn">This link is ${link.length} characters long. Most apps cope, but if it arrives broken, mark fewer days or months.</p>` : '';
  return `<section class="card share" aria-labelledby="share-h">
    <h2 id="share-h">${title}</h2>
    <p class="small">Paste this into any chat app. You can edit the words first.</p>
    <label class="sr-only" for="msg">Message</label>
    <textarea id="msg" rows="6" data-input="message">${h(text)}</textarea>
    <div class="actions">
      ${canShare ? `<button class="primary" data-act="native-share">${icon.share}Share…</button>` : ''}
      <button class="${canShare ? 'secondary' : 'primary'}" data-act="copy-message">${icon.copy}Copy message</button>
      <button class="secondary" data-act="copy-link">${icon.copy}Copy link only</button>
    </div>
    ${linkField(link)}
    ${long}
    ${step === 1 && S.role === 'a' ? `<div class="passbox"><span class="eyebrow">Passphrase</span><code>${h(S.pass)}</code><button class="text-button" data-act="copy-pass">${icon.copy}Copy</button>
      <p class="small">Send this separately, for example in a different app or out loud. Anyone with both the link and the passphrase can open the plan.</p></div>` : ''}
    ${step === 4 ? `<button class="secondary wide" data-act="ics">${icon.cal}Add to my calendar</button>` : ''}
  </section>`;
}

// ---------- Views ----------
function viewHome() {
  const plans = Object.entries(loadStore().plans).sort((x, y) => y[1].updated - x[1].updated);
  const rows = plans.map(([id, r]) => {
    let p; try { p = fromWire(r.wire); } catch { return ''; }
    const A = nameOf(p, 'a', 'Organiser'), B = nameOf(p, 'b', 'your guest');
    const me = r.role, turn = turnAfter(p.step);
    const status = p.step === 4 ? `Settled: ${p.finals.map(d => formatDay(d, { weekday: 'short', day: 'numeric', month: 'short' })).join(', ')}`
      : turn === me ? 'Your turn' : `Waiting for ${me === 'a' ? B : A}`;
    return `<li class="plan-row"><a href="#${h(r.hash)}"><strong>${h(p.title || `${A}${p.b ? ' & ' + nameOf(p, 'b', '') : ''}`)}</strong><small>${h(status)}</small></a>
      <button class="text-button" data-act="forget" data-id="${h(id)}" aria-label="Forget this plan">Forget</button></li>`;
  }).join('');
  return `<main class="page home">
    <p class="eyebrow">Private, day-level scheduling</p>
    <h1>Find a day that <em>works for both of you.</em></h1>
    <p class="lead">Mark the days you're free, send a link, and settle on a date in four quick messages. No accounts, no server, nothing to install.</p>
    <button class="primary" data-act="new">${icon.cal}Start a plan</button>
    ${rows ? `<div class="section-rule"><span>Your plans</span></div><ul class="plans">${rows}</ul>` : ''}
    <div class="section-rule"><span>How it works</span></div>
    <ol class="how">
      <li><span class="num">1</span><div><h2>You share</h2><p>Pick the days you're free, lock them with a passphrase and send the link.</p></div></li>
      <li><span class="num">2</span><div><h2>They add theirs</h2><p>They see your days, mark their own and send the link back.</p></div></li>
      <li><span class="num">3</span><div><h2>You pick</h2><p>Only the days you're both free are shown. Choose one or a few.</p></div></li>
      <li><span class="num">4</span><div><h2>They confirm</h2><p>They lock in the final day, or several, and get a ready-made message to send.</p></div></li>
    </ol>
    <p class="privacy">${icon.lock}<span>Your days are encrypted in your browser and travel after the <code>#</code> in the link, which is never sent to any server. Plans you open are kept on this device only, until you forget them.</span></p>
  </main>`;
}

function viewUnlock() {
  return `<main class="page narrow">
    <p class="eyebrow">A plan was shared with you</p>
    <h1>Enter the <em>passphrase.</em></h1>
    <p class="lead">It should have arrived separately from the link. Ask the sender if you don't have it.</p>
    <form class="card" data-form="unlock">
      <label class="field"><span>Passphrase</span>
        <input id="pass" type="${S.showPass ? 'text' : 'password'}" autocomplete="off" autocapitalize="none" spellcheck="false" value="${h(S.pass)}" data-input="pass" required>
      </label>
      <label class="check"><input type="checkbox" data-act="show-pass" ${S.showPass ? 'checked' : ''}> Show passphrase</label>
      ${S.error ? `<p class="error" role="alert">${h(S.error)}</p>` : ''}
      <button class="primary" type="submit" ${S.busy ? 'disabled' : ''}>${icon.lock}${S.busy ? 'Unlocking…' : 'Open plan'}</button>
    </form>
  </main>`;
}

function viewCompose() {
  const p = S.plan, mine = p.a.days, n = futureDays(mine, todayIso()).length;
  const theirs = p.b?.days || {};
  const startOpts = [0, 1, 2].map(i => addMonths(monthOf(todayIso()), i));
  if (S.sent) return `<main class="page">${stepper(p, 1)}${banners()}<p class="eyebrow">Step 1 of 4</p><h1>Your link is <em>ready.</em></h1>${sharePanel()}
    <button class="text-button" data-act="unsend">${icon.left}Change my days</button></main>`;
  return `<main class="page">
    ${stepper(p, 1)}${banners()}
    <p class="eyebrow">Step 1 of 4</p>
    <h1>When are <em>you free?</em></h1>
    <section class="card">
      <label class="field"><span>Your name</span><input data-input="a-name" value="${h(p.a.name)}" maxlength="40" autocomplete="given-name" placeholder="e.g. Sam"></label>
      <label class="field"><span>What's it for? <small>Optional</small></span><input data-input="title" value="${h(p.title)}" maxlength="80" placeholder="e.g. Dinner, a call, the hike"></label>
      ${p.b ? '' : `<div class="field-row">
        <label class="field"><span>Starting</span><select data-input="start">${startOpts.map(m => `<option value="${m}" ${m === p.start ? 'selected' : ''}>${h(formatMonth(m))}</option>`).join('')}</select></label>
        <div class="field"><span id="span-l">Months</span><div class="segmented" role="radiogroup" aria-labelledby="span-l">${[1, 2, 3].slice(0, MAX_MONTHS).map(c => `<button role="radio" aria-checked="${p.count === c}" data-act="count" data-c="${c}">${c}</button>`).join('')}</div></div>
      </div>`}
    </section>
    <section class="card">
      <h2>Your free days <span class="count">${plural(n, 'day')}</span></h2>
      ${brushBar()}
      ${calendar({ mine, theirs })}
      ${quickActions()}
      ${legend(!!p.b, nameOf(p, 'b', 'They'))}
    </section>
    <section class="card">
      <h2>Lock it with a passphrase</h2>
      <p class="small">They'll need this to open the link. Use the suggestion or type your own.</p>
      <div class="pass-row"><input aria-label="Passphrase" data-input="pass" value="${h(S.pass)}" autocapitalize="none" spellcheck="false"><button class="icon-button" data-act="reroll" aria-label="Suggest new words">${icon.dice}</button></div>
      ${S.error ? `<p class="error" role="alert">${h(S.error)}</p>` : ''}
      <button class="primary wide" data-act="send" ${S.busy ? 'disabled' : ''}>${icon.lock}${S.busy ? 'Locking…' : 'Create my link'}</button>
    </section>
  </main>`;
}

function viewRespond() {
  const p = S.plan, A = nameOf(p, 'a', 'They'), today = todayIso();
  const theirs = futureDays(p.a.days, today);
  const both = futureDays(overlap(p.a.days, p.b.days), today).length;
  if (S.sent) return `<main class="page">${stepper(p, 2)}${banners()}<p class="eyebrow">Step 2 of 4</p><h1>Send it <em>back.</em></h1>${sharePanel()}
    <button class="text-button" data-act="unsend">${icon.left}Change my days</button></main>`;
  return `<main class="page">
    ${stepper(p, 2)}${banners()}
    <p class="eyebrow">Step 2 of 4 · Your turn</p>
    <h1>${h(A)} is free on <em>${plural(theirs.length, 'day')}.</em></h1>
    <p class="lead">${p.title ? `For <strong>${h(p.title)}</strong>. ` : ''}Their days have a dashed outline. Mark the days you're free too, and the ones you share are ringed.</p>
    <section class="card"><label class="field"><span>Your name</span><input data-input="b-name" value="${h(p.b.name)}" maxlength="40" autocomplete="given-name" placeholder="e.g. Alex"></label></section>
    <section class="card">
      <h2>Your free days <span class="count">${both ? `${plural(both, 'match')}` : 'No matches yet'}</span></h2>
      ${brushBar()}
      ${calendar({ mine: p.b.days, theirs: p.a.days })}
      ${quickActions()}
      ${legend(true, A)}
    </section>
    ${S.error ? `<p class="error" role="alert">${h(S.error)}</p>` : ''}
    <button class="primary wide" data-act="send" ${S.busy ? 'disabled' : ''}>${icon.share}${S.busy ? 'Locking…' : `Send my days to ${h(A)}`}</button>
  </main>`;
}

function viewPick() {
  const p = S.plan, B = nameOf(p, 'b', 'They'), today = todayIso();
  const shared = Object.fromEntries(Object.entries(overlap(p.a.days, p.b.days)).filter(([d]) => d >= today));
  const n = Object.keys(shared).length;
  if (S.sent) return `<main class="page">${stepper(p, 3)}${banners()}<p class="eyebrow">Step 3 of 4</p><h1>Over to <em>${h(B)}.</em></h1>${sharePanel()}
    <button class="text-button" data-act="unsend">${icon.left}Change my picks</button></main>`;
  if (!n) return `<main class="page">${stepper(p, 3)}${banners()}
    <p class="eyebrow">Step 3 of 4 · Your turn</p>
    <h1>No days <em>in common.</em></h1>
    <p class="lead">${h(B)} replied, but none of your free days line up. You can add more days and send it back to them.</p>
    <section class="card">${calendar({ mine: p.a.days, theirs: p.b.days, readonly: true })}${legend(true, B)}</section>
    <button class="primary wide" data-act="revise">${icon.cal}Add more days</button></main>`;
  return `<main class="page">
    ${stepper(p, 3)}${banners()}
    <p class="eyebrow">Step 3 of 4 · Your turn</p>
    <h1>You're both free on <em>${plural(n, 'day')}.</em></h1>
    <p class="lead">Pick the day you'd like, or a few to let ${h(B)} choose.</p>
    <section class="card">
      ${calendar({ allowed: shared, picked: p.picks, mode: 'pick' })}
      <div class="quick"><button class="text-button" data-act="pick-all">Select all</button><button class="text-button" data-act="pick-none">Clear</button></div>
    </section>
    <section class="card"><h2>Shared days <span class="count">${p.picks.length} picked</span></h2>${dayList(shared, { picked: p.picks })}</section>
    ${S.error ? `<p class="error" role="alert">${h(S.error)}</p>` : ''}
    <button class="primary wide" data-act="send" ${S.busy || !p.picks.length ? 'disabled' : ''}>${icon.share}${S.busy ? 'Locking…' : p.picks.length === 1 ? `Propose this day` : `Send ${p.picks.length || ''} options`}</button>
    <button class="text-button" data-act="revise">Change my free days instead</button>
  </main>`;
}

function viewConfirm() {
  const p = S.plan, A = nameOf(p, 'a', 'They'), today = todayIso();
  const opts = Object.fromEntries(p.picks.filter(d => d >= today).map(d => [d, meet(p.a.days[d] || 0, p.b.days[d] || 0) || FREE]));
  const n = Object.keys(opts).length;
  if (S.sent) return `<main class="page">${stepper(p, 4)}${banners()}<p class="eyebrow">All done</p><h1>It's <em>settled.</em></h1>${finalCard()}${sharePanel()}</main>`;
  return `<main class="page">
    ${stepper(p, 4)}${banners()}
    <p class="eyebrow">Step 4 of 4 · Your turn</p>
    <h1>${n === 1 ? `${h(A)} suggests <em>one day.</em>` : `Choose from <em>${plural(n, 'day')}.</em>`}</h1>
    <p class="lead">${n ? `Lock in one day, or several if you're planning a few at once. You'll get a summary to send back.` : 'These days have passed. Change your days and send them back.'}</p>
    ${n ? `<section class="card"><h2>Days to lock in <span class="count">${S.choices.length} chosen</span></h2>${dayList(opts, { picked: S.choices, name: 'final', act: 'toggle-final' })}
      ${n > 1 ? `<div class="quick"><button class="text-button" data-act="final-all">Select all</button><button class="text-button" data-act="final-none">Clear</button></div>` : ''}</section>` : ''}
    ${S.error ? `<p class="error" role="alert">${h(S.error)}</p>` : ''}
    ${n ? `<button class="primary wide" data-act="send" ${S.busy || !S.choices.length ? 'disabled' : ''}>${icon.cal}${S.busy ? 'Locking…' : S.choices.length > 1 ? `Lock in ${S.choices.length} days` : 'Lock in this day'}</button>` : ''}
    <button class="text-button" data-act="revise">None of these work: change my days</button>
  </main>`;
}

function finalCard() {
  const p = S.plan, finals = p.finals || [];
  const who = [p.a.name, p.b?.name].filter(Boolean).join(' & ');
  const rows = finals.map(iso => {
    const mask = meet(p.a.days[iso] || 0, p.b?.days[iso] || 0), dt = parseIso(iso), tw = tagWords(mask);
    return `<li><div class="tear"><span>${h(dt.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }))}</span><strong>${dt.getUTCDate()}</strong></div>
      <div><h2>${h(formatDay(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h2><p class="small">${h(tw[0].toUpperCase() + tw.slice(1))}</p></div></li>`;
  }).join('');
  return `<div class="final-card"><p class="eyebrow">${h(p.title || 'Meeting')}${finals.length > 1 ? ` · ${finals.length} days` : ''}${who ? ` · ${h(who)}` : ''}</p><ul>${rows}</ul></div>`;
}

function viewDone() {
  const p = S.plan;
  return `<main class="page">${stepper(p, 5)}${banners()}
    <p class="eyebrow">All done</p><h1>It's <em>settled.</em></h1>
    ${finalCard()}
    <section class="card">
      <textarea rows="4" aria-label="Summary" data-input="message">${h(S.sent?.text || finalSummary(p))}</textarea>
      <div class="actions"><button class="primary" data-act="copy-message">${icon.copy}Copy summary</button><button class="secondary" data-act="ics">${icon.cal}Add to calendar</button></div>
      ${S.sent?.link ? linkField(S.sent.link) : ''}
    </section>
    <button class="text-button" data-act="forget-current">Forget this plan on this device</button>
  </main>`;
}

function viewWaiting() {
  const p = S.plan, other = S.role === 'a' ? nameOf(p, 'b', 'your guest') : nameOf(p, 'a', 'the organiser');
  return `<main class="page">${stepper(p, p.step + 1)}${banners()}
    <p class="eyebrow">Waiting</p><h1>Over to <em>${h(other)}.</em></h1>
    <p class="lead">This is the link you sent. When ${h(other)} replies, open the link they send you. You can send this one again if it got lost.</p>
    ${sharePanel()}</main>`;
}

const views = { home: viewHome, unlock: viewUnlock, compose: viewCompose, respond: viewRespond, pick: viewPick, confirm: viewConfirm, waiting: viewWaiting, done: viewDone };

function render() {
  const active = document.activeElement;
  const keep = focusKey || active?.dataset?.focus || null;
  $app.innerHTML = `<a class="skip-link" href="#main" data-act="skip">Skip to main content</a>` + header() + views[S.view]().replace('<main class=', '<main id="main" tabindex="-1" class=') + (S.display ? displayDialog() : '') + `<footer>Calshare · free days only, never times or details · <a href="https://github.com/nbinding/calshare">Source</a></footer>`;
  if (keep) document.querySelector(`[data-focus="${keep}"]`)?.focus({ preventScroll: true });
  document.body.classList.toggle('dialog-open', !!S.display);
  if (S.display && !document.querySelector('.dialog')?.contains(document.activeElement)) document.querySelector('.dialog [data-focus=close-display]')?.focus();
  focusKey = null;
}

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copy(text, msg = 'Copied') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch { toast('Copy failed: select and copy by hand'); ta.remove(); return; }
    ta.remove();
  }
  toast(msg);
}

// ---------- Flow ----------
function startNew() {
  const start = monthOf(todayIso());
  const plan = { id: randomId(), step: 1, created: 0, title: '', start, count: 2, a: { name: '', days: {} }, picks: [] };
  history.replaceState(null, '', baseUrl());
  set({ view: 'compose', plan, role: 'a', pass: suggestPassphrase(), hash: '', sent: null, error: '', notice: '', newer: null, brush: 0, monthIdx: 0, choices: [] });
  scrollTo(0, 0);
}

function enterPlan(plan, role, pass, hash) {
  const rec = recordFor(plan.id);
  const newer = rec && rec.hash !== hash && (rec.wire?.s || 0) > plan.step ? rec.hash : null;
  const turn = turnAfter(plan.step);
  let view;
  if (plan.step === 4) view = 'done';
  else if (role !== turn) view = 'waiting';
  else view = { 1: 'respond', 2: 'pick', 3: 'confirm' }[plan.step];
  const work = clone(plan);
  if (view === 'respond' && !work.b) work.b = { name: '', days: {} };
  if (view === 'pick') work.picks = work.picks.filter(d => meet(work.a.days[d] || 0, work.b.days[d] || 0));
  const link = `${baseUrl()}#${hash}`;
  const sent = view === 'waiting' ? { link, text: draftMessage(plan, link), step: plan.step } : view === 'done' ? { link, text: finalSummary(plan, link), step: 4 } : null;
  if (!newer) remember(plan, role, pass, hash);
  // Show the first month that has something to act on
  const months = rangeMonths(plan.start, plan.count), today = todayIso();
  const focusDays = view === 'pick' ? Object.keys(overlap(plan.a.days, plan.b.days)) : Object.keys(plan.a.days);
  const first = focusDays.filter(d => d >= today).sort()[0] || today;
  const monthIdx = Math.max(0, months.indexOf(monthOf(first)));
  set({ view, plan: work, role, pass, hash, sent, newer, error: '', busy: false, brush: 0, monthIdx, choices: work.picks.length === 1 ? [...work.picks] : [], notice: '' });
  scrollTo(0, 0);
}

async function tryOpen(hash, pass) {
  const [, code] = hash.split('.');
  const wire = await open(code, pass);
  const plan = fromWire(wire);
  if (plan.id !== hash.split('.')[0]) throw new Error('bad link');
  return plan;
}

async function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (!hash) { set({ view: 'home', plan: null, sent: null, error: '', newer: null, notice: '' }); return; }
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
    if (!futureDays(p.a.days, today).length) return set({ error: 'Mark at least one day you are free.' });
    if (S.pass.trim().length < 6) return set({ error: 'Use a passphrase of at least 6 characters.' });
    next.step = 1; next.picks = []; delete next.finals;
  } else if (S.view === 'respond') {
    if (!p.b.name.trim()) return set({ error: 'Add your name so they know who replied.' });
    if (!futureDays(p.b.days, today).length) return set({ error: 'Mark at least one day you are free.' });
    next.step = 2; next.picks = []; delete next.finals;
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
    const code = await seal(toWire(next), S.pass.trim());
    const hash = `${next.id}.${code}`, link = `${baseUrl()}#${hash}`;
    remember(next, S.role, S.pass.trim(), hash);
    history.replaceState(null, '', `#${hash}`);
    const text = draftMessage(next, link);
    set({ busy: false, plan: next, hash, sent: { link, text, step: next.step }, pass: S.pass.trim() });
    scrollTo(0, 0);
  } catch (e) {
    set({ busy: false, error: 'Could not lock the plan in this browser. Try a recent version of Chrome, Safari, Firefox or Edge.' });
  }
}

// Go back to editing my own days and resend (owner → step 1 again, guest → step 2 again).
function revise() {
  const p = clone(S.plan);
  p.picks = []; delete p.finals;
  if (S.role === 'a') set({ view: 'compose', plan: p, sent: null, error: '', notice: 'Add more days, then send the new link. Their days stay marked with a dashed outline.' });
  else set({ view: 'respond', plan: p, sent: null, error: '', notice: 'Change your days, then send the new link back.' });
  scrollTo(0, 0);
}

function myDays() { return S.role === 'a' ? S.plan.a.days : S.plan.b.days; }

function fill(kind) {
  const p = S.plan, mo = rangeMonths(p.start, p.count)[S.monthIdx], today = todayIso(), days = myDays();
  for (const iso of rangeDays(mo, 1)) {
    if (iso < today) continue;
    const wd = weekdayIndex(iso);
    if (kind === 'clear') delete days[iso];
    else if ((kind === 'weekends') === (wd >= 5)) days[iso] = (days[iso] && S.brush ? days[iso] : FREE) | S.brush;
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
    case 'brush': set({ brush: Number(el.dataset.bit) }); break;
    case 'hint-done': try { localStorage.setItem(HINT_KEY, 'done'); } catch {} focusKey = null; set({ showHint: false }); document.querySelector('[data-act=hint-open]')?.focus(); break;
    case 'hint-open': set({ showHint: true }); document.querySelector('.hint-done')?.focus(); break;
    case 'count': p.count = Number(el.dataset.c); trimToRange(); set({ monthIdx: Math.min(S.monthIdx, p.count - 1) }); break;
    case 'month': { const i = Number(el.dataset.i); if (i >= 0 && i < p.count) set({ monthIdx: i }); break; }
    case 'day': {
      const iso = el.dataset.day;
      focusKey = `day-${iso}`;
      if (S.view === 'pick') { const i = p.picks.indexOf(iso); i >= 0 ? p.picks.splice(i, 1) : p.picks.push(iso); }
      else { const d = myDays(), m = paint(d[iso] || 0, S.brush); if (m) d[iso] = m; else delete d[iso]; }
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
  if (!S.display) return;
  if (e.key === 'Escape') { focusKey = 'open-display'; set({ display: false }); return; }
  if (e.key === 'Tab') { // keep focus inside the dialog
    const f = [...document.querySelectorAll('.dialog button, .dialog input')];
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
