import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core.js';
import { seal, open, WrongPassphrase } from '../src/share.js';

test('paint toggles days and tags', () => {
  assert.equal(C.paint(0, 0), C.FREE);
  assert.equal(C.paint(C.FREE, 0), 0);
  assert.equal(C.paint(0, C.MORNING), C.FREE | C.MORNING);
  assert.equal(C.paint(C.FREE | C.MORNING, C.EVENING), C.FREE | C.MORNING | C.EVENING);
  assert.equal(C.paint(C.FREE | C.MORNING, C.MORNING), 0);
  assert.equal(C.paint(C.FREE, C.MORNING), C.FREE | C.MORNING);
  assert.equal(C.paint(C.FREE | C.MORNING, 0), C.FREE);
});

test('tapping a day cycles through its times', () => {
  const { FREE: F, MORNING: M, AFTERNOON: A, EVENING: E } = C;
  const seen = []; let m = 0;
  for (let i = 0; i < 5; i++) seen.push(m = C.cycle(m));
  assert.deepEqual(seen, [F, F | M, F | A, F | E, 0]);
  assert.equal(C.cycle(F | M | E), 0); // a combination clears
});

test('setTime gives each day its own time', () => {
  const { FREE: F, MORNING: M, EVENING: E } = C;
  assert.equal(C.setTime(F | M, 0), F);           // any time clears tags
  assert.equal(C.setTime(F, M), F | M);
  assert.equal(C.setTime(F | M, E), F | M | E);
  assert.equal(C.setTime(F | M, M), F);           // removing the last time leaves the day free, any time
});

test('meet respects time-of-day tags', () => {
  const { FREE: F, MORNING: M, AFTERNOON: A, EVENING: E } = C;
  assert.equal(C.meet(F, F), F);
  assert.equal(C.meet(F, F | E), F | E);
  assert.equal(C.meet(F | M | E, F | E), F | E);
  assert.equal(C.meet(F | M, F | A), 0);
  assert.equal(C.meet(0, F), 0);
});

test('date helpers cross year boundaries', () => {
  assert.equal(C.addMonths('2026-11', 2), '2027-01');
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.rangeDays('2026-11', 3).length, 30 + 31 + 31);
  assert.equal(C.isoAtOffset('2026-11', 31), '2026-12-02');
  assert.equal(C.dayOffset('2026-11', '2027-01-01'), 61);
  assert.equal(C.weekdayIndex('2026-11-16'), 0); // Monday
});

test('encode/decode days round trip and stays compact', () => {
  const days = { '2026-11-14': 1, '2026-12-25': 1 | 8, '2027-01-31': 1 | 2 | 4 };
  const s = C.encodeDays(days, '2026-11', 3);
  assert.equal(s.length, 92);
  assert.deepEqual(C.decodeDays(s, '2026-11', 3), days);
  assert.equal(C.encodeDays({}, '2026-11', 1), '');
  assert.throws(() => C.decodeDays('zz', '2026-11', 1));
});

test('plan wire round trip', () => {
  const plan = { id: 'abc123', step: 3, created: 1, title: 'Dinner', start: '2026-11', count: 2, group: false,
    a: { name: 'Sam', days: { '2026-11-20': 1, '2026-12-01': 9 }, v: 2 },
    b: { name: 'Alex', days: { '2026-11-20': 5, '2026-12-01': 1 }, id: 'guestId01', v: 1 }, picks: ['2026-11-20', '2026-12-01'] };
  const back = C.fromWire(JSON.parse(JSON.stringify(C.toWire(plan))));
  assert.deepEqual(back, plan);
  assert.deepEqual(C.overlap(plan.a.days, plan.b.days), { '2026-11-20': 5, '2026-12-01': 9 });
  assert.throws(() => C.fromWire({ v: 2 }));
});

test('messages and ics', () => {
  const plan = { id: 'x', step: 4, created: 1, title: 'Dinner', start: '2026-11', count: 1,
    a: { name: 'Sam', days: { '2026-11-20': 9 } }, b: { name: 'Alex', days: { '2026-11-20': 1 } }, picks: ['2026-11-20'], finals: ['2026-11-20'] };
  const s = C.finalSummary(plan, 'L');
  assert.match(s, /Dinner is on Friday.*2026 \(evening\)/);
  assert.match(s, /Sam & Alex/);
  const ics = C.icsFor(plan);
  assert.match(ics, /DTSTART;VALUE=DATE:20261120/);
  assert.match(ics, /DTEND;VALUE=DATE:20261121/);
  const multi = { ...plan, b: { name: 'Alex', days: { '2026-11-20': 1, '2026-11-27': 1 } }, a: { name: 'Sam', days: { '2026-11-20': 9, '2026-11-27': 1 } }, finals: ['2026-11-20', '2026-11-27'] };
  assert.match(C.finalSummary(multi), /meeting on 2 days:\n• Friday.*\(evening\)\n• Friday/);
  assert.equal(C.icsFor(multi).match(/BEGIN:VEVENT/g).length, 2);
  const w = C.toWire(multi); assert.deepEqual(w.f, [19, 26]);
  assert.deepEqual(C.fromWire({ ...w, f: 19 }).finals, ['2026-11-20']); // first-release links
  const first = C.draftMessage({ ...plan, step: 1, b: undefined }, 'L');
  assert.match(first, /\nL\nIt's locked with a passphrase, which I'll send you in a separate message\.$/);
  assert.doesNotMatch(first, /agreed/);
  assert.equal(C.turnAfter(1), 'b'); assert.equal(C.turnAfter(2), 'a'); assert.equal(C.turnAfter(4), null);
});

test('seal/open with passphrase', async () => {
  const code = await seal({ hi: 1 }, 'oak-river', 1000);
  assert.deepEqual(await open(code, 'oak-river', 1000), { hi: 1 });
  await assert.rejects(open(code, 'wrong', 1000), WrongPassphrase);
});

test('links from before groups and versions still open', () => {
  const old = { v: 1, i: 'x', s: 2, t: 1, m: '2026-11', c: 1, a: { n: 'Sam', d: '0000000000000000000' + '1' }, b: { n: 'Alex', d: '1' } };
  const plan = C.fromWire(old);
  assert.equal(plan.group, false);
  assert.equal(plan.a.v, 0);
  assert.deepEqual(plan.b, { name: 'Alex', days: { '2026-11-01': 1 }, id: '', v: 0 });
  assert.equal(C.fromWire({ ...old, b: { n: 'A', d: '1', u: '<bad id>' } }).b.id, '');
});

test('group plans: labels, counts and final summary', () => {
  const { FREE: F, MORNING: M, EVENING: E } = C;
  const people = [
    { name: 'Sam', id: 'aaaa1111', days: { '2026-11-20': F, '2026-11-21': F | E } },
    { name: 'sam ', id: 'bbbb2222', days: { '2026-11-20': F | M } },
    { name: 'Jo', id: 'cccc3333', days: { '2026-11-22': F } },
  ];
  const labels = C.labelPeople(people);
  assert.match(labels.aaaa1111, /^Sam · [A-Z2-9]{2,4}$/);
  assert.match(labels.bbbb2222, /^sam · [A-Z2-9]{2,4}$/);
  assert.notEqual(labels.aaaa1111.split(' · ')[1], labels.bbbb2222.split(' · ')[1]);
  assert.equal(labels.cccc3333, 'Jo');
  assert.equal(C.shortCode('aaaa1111'), C.shortCode('aaaa1111'));

  const org = { '2026-11-20': F, '2026-11-21': F | M, '2026-11-23': F };
  const g = C.groupDays(org, people);
  assert.deepEqual(g['2026-11-20'], { mask: F | M, free: ['aaaa1111', 'bbbb2222'] });
  assert.equal(g['2026-11-21'], undefined); // organiser morning vs Sam evening
  assert.equal(g['2026-11-23'], undefined); // nobody else free

  const plan = { id: 'grp', step: 4, created: 1, title: 'Hike', start: '2026-11', count: 1, group: true,
    a: { name: 'Nat', days: org, v: 0 }, picks: [], finals: ['2026-11-20'], people };
  const back = C.fromWire(JSON.parse(JSON.stringify(C.toWire(plan))));
  assert.equal(back.group, true);
  assert.deepEqual(back.people.map(p => p.id), ['aaaa1111', 'bbbb2222', 'cccc3333']);
  const summary = C.finalSummary(back);
  assert.match(summary, /Hike is on Friday.*\(morning, 3 of 4 can make it\)/);
  assert.match(summary, /— Nat, Sam, sam  & Jo|— Nat, Sam, sam & Jo/);
  assert.match(C.draftMessage({ ...back, step: 1 }, 'L'), /^Hi all!/);
  assert.match(C.icsFor(back), /Time: morning/);
});

test('update messages say to use the new link', () => {
  const plan = { id: 'x', step: 1, created: 1, title: 'Dinner', start: '2026-11', count: 1, a: { name: 'Sam', days: { '2026-11-20': 1 } }, picks: [] };
  assert.match(C.draftMessage(plan, 'L', { update: true }), /^I've updated my days for Dinner\. Please use this link instead.*same passphrase/);
  assert.doesNotMatch(C.draftMessage(plan, 'L', { update: true }), /separate message/);
  const reply = { ...plan, step: 2, b: { name: 'Alex', days: { '2026-11-20': 1 } } };
  assert.match(C.draftMessage(reply, 'L', { update: true }), /^I've updated my days for Dinner\. Use this link instead of my earlier one\. We overlap on 1 day\./);
});
