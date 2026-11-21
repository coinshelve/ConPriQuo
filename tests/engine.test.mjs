// Unit tests for the configure-price-quote engine behind the worked example.
// Run with: npm test   (Node strips the TypeScript types on import)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  APPROVAL_CHAIN,
  CATALOG,
  DEFAULT_SELECTION,
  MAX_DISCOUNT,
  MAX_QUANTITY,
  evaluate,
  money,
  normalise,
  quoteReference,
  volumePercentFor,
} from '../src/scripts/cpq/engine.ts';

const parts = (evaluation) => evaluation.bom.map((line) => line.part);
const select = (patch) => evaluate({ ...DEFAULT_SELECTION, ...patch });

test('default selection resolves to the base unit and a gripper', () => {
  const e = evaluate(DEFAULT_SELECTION);
  assert.deepEqual(parts(e), ['HX6-BASE', 'HX6-TL-GRP']);
  assert.equal(e.ballastBlocks, 1);
  assert.equal(e.pumpKit, false);
  assert.equal(e.approvalRequired, false);
});

test('recommendation rule: long reach adds a second ballast block to the bill of materials', () => {
  const e = select({ reach: 'long' });
  assert.equal(e.ballastBlocks, 2);
  assert.ok(parts(e).includes('HX6-ARM-14'));
  const ballast = e.bom.find((line) => line.part === 'HX6-BAL-01');
  assert.equal(ballast?.source, 'rule');
  assert.equal(ballast?.ruleId, 'R-04');
  assert.ok(e.rules.some((rule) => rule.id === 'R-04' && rule.kind === 'recommendation'));
});

test('BOM rule: a vacuum lifter needs a pump kit on diesel but not on electric', () => {
  const diesel = select({ tool: 'vacuum', power: 'diesel' });
  assert.equal(diesel.pumpKit, true);
  assert.ok(parts(diesel).includes('HX6-PMP-KIT'));

  const electric = select({ tool: 'vacuum', power: 'electric' });
  assert.equal(electric.pumpKit, false);
  assert.ok(!parts(electric).includes('HX6-PMP-KIT'));
  assert.ok(parts(electric).includes('HX6-PWR-E'));
});

test('constraint rule: hook and long reach exclude each other, with a reason', () => {
  const long = select({ reach: 'long' });
  const hook = long.tool.find((option) => option.value === 'hook');
  assert.equal(hook.available, false);
  assert.ok(hook.reason.length > 10);

  const hooked = select({ tool: 'hook' });
  const longOption = hooked.reach.find((option) => option.value === 'long');
  assert.equal(longOption.available, false);
  assert.ok(longOption.reason.length > 10);
});

test('an invalid combination is normalised rather than quoted', () => {
  const fixed = normalise({ ...DEFAULT_SELECTION, reach: 'long', tool: 'hook' });
  assert.equal(fixed.reach, 'long');
  assert.equal(fixed.tool, 'gripper');
});

test('inputs are clamped to their ranges', () => {
  assert.equal(normalise({ ...DEFAULT_SELECTION, quantity: 0 }).quantity, 1);
  assert.equal(normalise({ ...DEFAULT_SELECTION, quantity: 999 }).quantity, MAX_QUANTITY);
  assert.equal(normalise({ ...DEFAULT_SELECTION, discount: -5 }).discount, 0);
  assert.equal(normalise({ ...DEFAULT_SELECTION, discount: 80 }).discount, MAX_DISCOUNT);
  assert.equal(normalise({ ...DEFAULT_SELECTION, quantity: Number.NaN }).quantity, 1);
});

test('volume tiers step at 3, 6 and 10 units', () => {
  assert.equal(volumePercentFor(1), 0);
  assert.equal(volumePercentFor(2), 0);
  assert.equal(volumePercentFor(3), 3);
  assert.equal(volumePercentFor(6), 5);
  assert.equal(volumePercentFor(9), 5);
  assert.equal(volumePercentFor(10), 8);
});

test('pricing arithmetic: list, volume tier, negotiated discount, total', () => {
  const e = select({ quantity: 4, discount: 6 });
  const p = e.pricing;
  assert.equal(p.unitList, 186000 + 13900);
  assert.equal(p.volumePercent, 3);
  assert.equal(p.volumeAmount, Math.round((p.unitList * 3) / 100));
  assert.equal(p.negotiatedAmount, Math.round(((p.unitList - p.volumeAmount) * 6) / 100));
  assert.equal(p.unitNet, p.unitList - p.volumeAmount - p.negotiatedAmount);
  assert.equal(p.total, p.unitNet * 4);
  assert.equal(p.listTotal, p.unitList * 4);
  assert.ok(p.total < p.listTotal);
});

test('approval routing follows the negotiated discount', () => {
  const [manager, finance] = APPROVAL_CHAIN;
  const within = select({ discount: manager.threshold });
  assert.equal(within.approvalRequired, false);

  const oneLevel = select({ discount: manager.threshold + 1 });
  assert.equal(oneLevel.approvalRequired, true);
  assert.deepEqual(oneLevel.approvals.map((step) => step.required), [true, false]);

  const twoLevels = select({ discount: finance.threshold + 1 });
  assert.deepEqual(twoLevels.approvals.map((step) => step.required), [true, true]);
  assert.ok(twoLevels.rules.some((rule) => rule.kind === 'approval'));
  // The rule uses the same approval wording as the route status on the page.
  const approval = twoLevels.rules.find((rule) => rule.kind === 'approval');
  assert.match(approval.text, /Needs approval from sales manager and finance director\.$/);
  assert.ok(!twoLevels.rules.some((rule) => /sign-?off/i.test(rule.text)));
});

test('long reach is listed as an extension of the base arm, not a second arm', () => {
  const e = select({ reach: 'long' });
  const arm = e.bom.find((line) => line.part === 'HX6-ARM-14');
  assert.equal(arm?.description, 'Arm extension, 9 m to 14 m');
});

test('every bill-of-materials line comes from the catalogue, in catalogue order', () => {
  const order = CATALOG.map((item) => item.part);
  for (const reach of ['standard', 'long']) {
    for (const tool of ['gripper', 'vacuum', 'hook']) {
      for (const power of ['diesel', 'electric']) {
        const e = select({ reach, tool, power });
        const indexes = parts(e).map((part) => order.indexOf(part));
        assert.ok(indexes.every((index) => index >= 0));
        assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
        assert.equal(e.pricing.unitList, e.bom.reduce((sum, line) => sum + line.unitPrice, 0));
      }
    }
  }
});

test('helpers: money formatting and a stable quote reference', () => {
  assert.equal(money(729076), '729,076');
  assert.equal(quoteReference(DEFAULT_SELECTION), quoteReference({ ...DEFAULT_SELECTION }));
  assert.notEqual(quoteReference(DEFAULT_SELECTION), quoteReference({ ...DEFAULT_SELECTION, reach: 'long' }));
});
