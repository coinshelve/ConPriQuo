/**
 * A small configure-price-quote engine for the homepage's worked example.
 *
 * The product ("HX-6 handling unit"), its parts and its prices are fictional and exist
 * only to demonstrate the kinds of logic ConPriQuo builds in Oracle CPQ: constraint
 * and recommendation rules, an attribute-driven bill of materials, tiered and
 * negotiated discounting, and discount-based approval routing.
 *
 * Pure functions, no DOM access: the same module drives the HTML panels, the 3D
 * model and the unit tests.
 */

export type Reach = 'standard' | 'long';
export type Tool = 'gripper' | 'vacuum' | 'hook';
export type Power = 'diesel' | 'electric';

export interface Selection {
  reach: Reach;
  tool: Tool;
  power: Power;
  /** Units on the quote, 1 to MAX_QUANTITY. */
  quantity: number;
  /** Negotiated discount in whole percent, 0 to MAX_DISCOUNT. */
  discount: number;
}

export const MAX_QUANTITY = 12;
export const MAX_DISCOUNT = 25;

export const DEFAULT_SELECTION: Selection = {
  reach: 'standard',
  tool: 'gripper',
  power: 'diesel',
  quantity: 4,
  discount: 6,
};

export interface OptionState<T extends string> {
  value: T;
  label: string;
  detail: string;
  /** Added to the unit list price when selected; 0 when included in the base unit. */
  price: number;
  available: boolean;
  /** Why a constraint rule has made the option unavailable. Empty when available. */
  reason: string;
}

export type RuleKind = 'constraint' | 'recommendation' | 'bom' | 'pricing' | 'approval';

export interface FiredRule {
  id: string;
  kind: RuleKind;
  /** Plain-language statement of what the rule did. */
  text: string;
}

export interface BomLine {
  part: string;
  description: string;
  quantity: number;
  unitPrice: number;
  /** "model" is the base unit, "selection" follows a choice, "rule" was added by a rule. */
  source: 'model' | 'selection' | 'rule';
  ruleId?: string;
}

export interface ApprovalStep {
  role: string;
  /** Discount percentage above which this approver is required. */
  threshold: number;
  required: boolean;
}

export interface Pricing {
  unitList: number;
  volumePercent: number;
  volumeAmount: number;
  negotiatedPercent: number;
  negotiatedAmount: number;
  unitNet: number;
  quantity: number;
  total: number;
  listTotal: number;
}

export interface Evaluation {
  selection: Selection;
  reach: OptionState<Reach>[];
  tool: OptionState<Tool>[];
  power: OptionState<Power>[];
  ballastBlocks: number;
  pumpKit: boolean;
  bom: BomLine[];
  pricing: Pricing;
  approvals: ApprovalStep[];
  approvalRequired: boolean;
  rules: FiredRule[];
}

const PRICE = {
  base: 186000,
  longReach: 24500,
  ballast: 5200,
  gripper: 13900,
  vacuum: 17600,
  hook: 6400,
  pumpKit: 8300,
  electric: 21000,
} as const;

/** Every part the HX-6 can resolve to, in bill-of-materials order. */
export const CATALOG: readonly { part: string; description: string; unitPrice: number }[] = [
  { part: 'HX6-BASE', description: 'HX-6 base unit with 9 m arm', unitPrice: PRICE.base },
  // An extension, not a second arm: the base unit already carries the 9 m arm.
  { part: 'HX6-ARM-14', description: 'Arm extension, 9 m to 14 m', unitPrice: PRICE.longReach },
  { part: 'HX6-BAL-01', description: 'Additional ballast block', unitPrice: PRICE.ballast },
  { part: 'HX6-TL-GRP', description: 'Two-jaw gripper', unitPrice: PRICE.gripper },
  { part: 'HX6-TL-VAC', description: 'Vacuum lifter', unitPrice: PRICE.vacuum },
  { part: 'HX6-TL-HOK', description: 'Load hook', unitPrice: PRICE.hook },
  { part: 'HX6-PMP-KIT', description: 'Vacuum pump kit', unitPrice: PRICE.pumpKit },
  { part: 'HX6-PWR-E', description: 'Electric power pack', unitPrice: PRICE.electric },
];

/** Volume tiers: the first tier whose minimum is met, scanning from the largest. */
export const VOLUME_TIERS: readonly { min: number; percent: number }[] = [
  { min: 10, percent: 8 },
  { min: 6, percent: 5 },
  { min: 3, percent: 3 },
  { min: 1, percent: 0 },
];

/** Approval chain: every step whose threshold the negotiated discount exceeds is required. */
export const APPROVAL_CHAIN: readonly { role: string; threshold: number }[] = [
  { role: 'Sales manager', threshold: 10 },
  { role: 'Finance director', threshold: 18 },
];

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

/** Returns a selection that satisfies every constraint, changing as little as possible. */
export function normalise(input: Selection): Selection {
  const next: Selection = {
    reach: input.reach === 'long' ? 'long' : 'standard',
    tool: input.tool === 'vacuum' || input.tool === 'hook' ? input.tool : 'gripper',
    power: input.power === 'electric' ? 'electric' : 'diesel',
    quantity: clampInt(input.quantity, 1, MAX_QUANTITY),
    discount: clampInt(input.discount, 0, MAX_DISCOUNT),
  };
  // Constraint C-01: the hook is not offered with long reach. Reach wins; tool falls back.
  if (next.reach === 'long' && next.tool === 'hook') next.tool = 'gripper';
  return next;
}

export function volumePercentFor(quantity: number): number {
  for (const tier of VOLUME_TIERS) if (quantity >= tier.min) return tier.percent;
  return 0;
}

export function evaluate(input: Selection): Evaluation {
  const selection = normalise(input);
  const { reach, tool, power, quantity, discount } = selection;
  const rules: FiredRule[] = [];

  // ---- Configure: constraint rules decide what can be chosen
  const hookBlocked = reach === 'long';
  const longBlocked = tool === 'hook';

  const reachOptions: OptionState<Reach>[] = [
    { value: 'standard', label: 'Standard', detail: '9 m', price: 0, available: true, reason: '' },
    {
      value: 'long',
      label: 'Long',
      detail: '14 m',
      price: PRICE.longReach,
      available: !longBlocked,
      reason: longBlocked ? 'Not offered with the hook. Lifting capacity at 14 m falls below the hook rating.' : '',
    },
  ];
  const toolOptions: OptionState<Tool>[] = [
    { value: 'gripper', label: 'Gripper', detail: 'Two-jaw', price: PRICE.gripper, available: true, reason: '' },
    { value: 'vacuum', label: 'Vacuum lifter', detail: 'Suction pad', price: PRICE.vacuum, available: true, reason: '' },
    {
      value: 'hook',
      label: 'Hook',
      detail: 'Load hook',
      price: PRICE.hook,
      available: !hookBlocked,
      reason: hookBlocked ? 'Not offered with long reach. Lifting capacity at 14 m falls below the hook rating.' : '',
    },
  ];
  const powerOptions: OptionState<Power>[] = [
    { value: 'diesel', label: 'Diesel', detail: 'Stage V', price: 0, available: true, reason: '' },
    { value: 'electric', label: 'Electric', detail: 'Tethered', price: PRICE.electric, available: true, reason: '' },
  ];

  if (hookBlocked) {
    rules.push({ id: 'C-01', kind: 'constraint', text: 'Long reach selected, so the hook is withdrawn from the tool list.' });
  } else if (longBlocked) {
    rules.push({ id: 'C-01', kind: 'constraint', text: 'Hook selected, so long reach is withdrawn from the reach list.' });
  }

  // ---- Recommendation rules derive values the seller should not have to work out
  const ballastBlocks = reach === 'long' ? 2 : 1;
  if (reach === 'long') {
    rules.push({ id: 'R-04', kind: 'recommendation', text: 'Long reach needs a second ballast block. Ballast set to 2.' });
  }
  const pumpKit = tool === 'vacuum' && power === 'diesel';
  if (tool === 'vacuum') {
    rules.push(
      pumpKit
        ? { id: 'B-07', kind: 'bom', text: 'A vacuum lifter on a diesel unit needs its own pump. Pump kit added to the bill of materials.' }
        : { id: 'B-07', kind: 'bom', text: 'A vacuum lifter on an electric unit runs from the main supply. No pump kit needed.' },
    );
  }

  // ---- Attribute-driven bill of materials: each attribute value resolves to parts
  const included: Record<string, { source: BomLine['source']; ruleId?: string }> = {
    'HX6-BASE': { source: 'model' },
  };
  if (reach === 'long') {
    included['HX6-ARM-14'] = { source: 'selection' };
    included['HX6-BAL-01'] = { source: 'rule', ruleId: 'R-04' };
  }
  if (tool === 'gripper') included['HX6-TL-GRP'] = { source: 'selection' };
  if (tool === 'vacuum') included['HX6-TL-VAC'] = { source: 'selection' };
  if (tool === 'hook') included['HX6-TL-HOK'] = { source: 'selection' };
  if (pumpKit) included['HX6-PMP-KIT'] = { source: 'rule', ruleId: 'B-07' };
  if (power === 'electric') included['HX6-PWR-E'] = { source: 'selection' };

  const bom: BomLine[] = CATALOG.filter((item) => included[item.part]).map((item) => ({
    part: item.part,
    description: item.description,
    quantity: 1,
    unitPrice: item.unitPrice,
    ...included[item.part],
  }));

  // ---- Price: list, volume tier, negotiated discount. Whole units, no currency: the figures are illustrative.
  const unitList = bom.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const volumePercent = volumePercentFor(quantity);
  const volumeAmount = Math.round((unitList * volumePercent) / 100);
  const afterVolume = unitList - volumeAmount;
  const negotiatedAmount = Math.round((afterVolume * discount) / 100);
  const unitNet = afterVolume - negotiatedAmount;
  const pricing: Pricing = {
    unitList,
    volumePercent,
    volumeAmount,
    negotiatedPercent: discount,
    negotiatedAmount,
    unitNet,
    quantity,
    total: unitNet * quantity,
    listTotal: unitList * quantity,
  };
  if (volumePercent > 0) {
    rules.push({ id: 'P-02', kind: 'pricing', text: `Quantity ${quantity} reaches the ${volumePercent}% volume tier.` });
  }

  // ---- Approvals: each level whose authority the negotiated discount exceeds
  const approvals: ApprovalStep[] = APPROVAL_CHAIN.map((step) => ({ ...step, required: discount > step.threshold }));
  const approvalRequired = approvals.some((step) => step.required);
  if (approvalRequired) {
    const needed = approvals.filter((step) => step.required).map((step) => step.role.toLowerCase());
    rules.push({
      id: 'A-03',
      kind: 'approval',
      text: `A ${discount}% discount is above seller authority. Needs approval from ${needed.join(' and ')}.`,
    });
  }

  return {
    selection,
    reach: reachOptions,
    tool: toolOptions,
    power: powerOptions,
    ballastBlocks,
    pumpKit,
    bom,
    pricing,
    approvals,
    approvalRequired,
    rules,
  };
}

const moneyFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "186,000": grouped thousands, no currency. The figures are illustrative and carry no unit. */
export function money(value: number): string {
  return moneyFormat.format(Math.round(value));
}

/** A stable reference derived from the configuration, so the document feels like a record. */
export function quoteReference(selection: Selection): string {
  const s = normalise(selection);
  const code =
    (s.reach === 'long' ? 2 : 1) * 1000 +
    (s.tool === 'gripper' ? 1 : s.tool === 'vacuum' ? 2 : 3) * 100 +
    (s.power === 'electric' ? 2 : 1) * 10 +
    (s.quantity % 10);
  return `HX6-${code}-${String(s.quantity).padStart(2, '0')}${String(s.discount).padStart(2, '0')}`;
}
