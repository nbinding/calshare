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
  const plan = { id: 'abc123', step: 3, created: 1, title: 'Dinner', start: '2026-11', count: 2,
    a: { name: 'Sam', days: { '2026-11-20': 1, '2026-12-01': 9 } },
    b: { name: 'Alex', days: { '2026-11-20': 5, '2026-12-01': 1 } }, picks: ['2026-11-20', '2026-12-01'] };
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
  assert.equal(C.turnAfter(1), 'b'); assert.equal(C.turnAfter(2), 'a'); assert.equal(C.turnAfter(4), null);
});

test('seal/open with passphrase', async () => {
  const code = await seal({ hi: 1 }, 'oak-river', 1000);
  assert.deepEqual(await open(code, 'oak-river', 1000), { hi: 1 });
  await assert.rejects(open(code, 'wrong', 1000), WrongPassphrase);
});
