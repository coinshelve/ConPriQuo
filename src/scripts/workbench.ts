/**
 * Binds the worked example's HTML to the configure-price-quote engine. The page is
 * server-rendered for the default selection; this module makes it respond.
 */
import {
  DEFAULT_SELECTION,
  MAX_DISCOUNT,
  MAX_QUANTITY,
  evaluate,
  money,
  quoteReference,
} from './cpq/engine';
import type { Evaluation, FiredRule, Selection } from './cpq/engine';

export interface Workbench {
  current(): Evaluation;
  subscribe(listener: (evaluation: Evaluation) => void): void;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setText(root: ParentNode, key: string, value: string) {
  root.querySelectorAll<HTMLElement>(`[data-out="${key}"]`).forEach((el) => {
    if (el.textContent !== value) el.textContent = value;
  });
}

/** Counts a figure from its previous value to the new one, in tabular digits. */
function tickNumber(el: HTMLElement, to: number, prefix = '') {
  const from = Number(el.dataset.value ?? to);
  el.dataset.value = String(to);
  const write = (value: number) => {
    el.textContent = prefix + money(value);
  };
  if (reducedMotion.matches || from === to) return write(to);
  const start = performance.now();
  const duration = 420;
  const token = String(start);
  el.dataset.tick = token;
  const frame = (now: number) => {
    if (el.dataset.tick !== token) return;
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    write(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function flash(el: Element) {
  el.classList.add('is-new');
  // The class is removed on the next frames so the CSS transition can fade the highlight.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-new')));
}

export function initWorkbench(): Workbench {
  let selection: Selection = { ...DEFAULT_SELECTION };
  let evaluation = evaluate(selection);
  const listeners: ((evaluation: Evaluation) => void)[] = [];
  const root = document.querySelector<HTMLElement>('[data-story]');

  const api: Workbench = {
    current: () => evaluation,
    subscribe: (listener) => listeners.push(listener),
  };
  if (!root) return api;

  const bench = root.querySelector<HTMLFormElement>('[data-bench]');
  const rulesList = root.querySelector<HTMLElement>('[data-rules]');
  const rulesEmpty = root.querySelector<HTMLElement>('[data-rules-empty]');
  const discountInput = root.querySelector<HTMLInputElement>('[data-discount]');
  const route = root.querySelector<HTMLElement>('[data-route]');
  const stamp = root.querySelector<HTMLElement>('[data-stamp]');
  let previousParts = new Set(evaluation.bom.map((line) => line.part));
  let previousRules = new Set(evaluation.rules.map((rule) => rule.id + rule.text));

  // seed numeric outputs so the first change animates from the rendered value
  const seed = (key: string, value: number) =>
    root.querySelectorAll<HTMLElement>(`[data-out="${key}"]`).forEach((el) => (el.dataset.value = String(value)));

  const issued = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
  setText(root, 'issued', issued);

  function renderOptions(e: Evaluation) {
    const groups = { reach: e.reach, tool: e.tool, power: e.power } as const;
    for (const [name, options] of Object.entries(groups)) {
      let reason = '';
      for (const option of options) {
        const input = bench?.querySelector<HTMLInputElement>(`input[name="${name}"][value="${option.value}"]`);
        if (!input) continue;
        input.checked = e.selection[name as 'reach' | 'tool' | 'power'] === option.value;
        if (option.available) {
          input.removeAttribute('aria-disabled');
          input.removeAttribute('aria-describedby');
        } else {
          input.setAttribute('aria-disabled', 'true');
          input.setAttribute('aria-describedby', `reason-${name}`);
          reason = `${option.label}: ${option.reason}`;
        }
      }
      const reasonEl = root!.querySelector<HTMLElement>(`[data-reason="${name}"]`);
      if (reasonEl) {
        reasonEl.id = `reason-${name}`;
        reasonEl.hidden = !reason;
        if (reason && reasonEl.textContent !== reason) reasonEl.textContent = reason;
      }
    }
  }

  function ruleItem(rule: FiredRule) {
    const li = document.createElement('li');
    li.dataset.kind = rule.kind;
    const id = document.createElement('span');
    id.className = 'rules__id mono';
    id.textContent = rule.id;
    const text = document.createElement('span');
    text.textContent = rule.text;
    li.append(id, text);
    return li;
  }

  function renderRules(e: Evaluation) {
    if (!rulesList) return;
    const shown = e.rules.filter((rule) => rule.kind === 'constraint' || rule.kind === 'recommendation' || rule.kind === 'bom');
    const keys = new Set(e.rules.map((rule) => rule.id + rule.text));
    rulesList.querySelectorAll('li[data-kind]').forEach((li) => li.remove());
    for (const rule of shown) {
      const item = ruleItem(rule);
      if (!previousRules.has(rule.id + rule.text)) item.classList.add('is-new');
      rulesList.insertBefore(item, rulesEmpty);
    }
    previousRules = keys;
  }

  function renderBom(e: Evaluation) {
    const included = new Map(e.bom.map((line) => [line.part, line]));
    root!.querySelectorAll<HTMLTableRowElement>('[data-bom] tr[data-part]').forEach((row) => {
      const line = included.get(row.dataset.part!);
      const wasHidden = row.hidden;
      row.hidden = !line;
      const tag = row.querySelector<HTMLElement>('[data-rule-tag]');
      if (tag) {
        tag.hidden = line?.source !== 'rule';
        tag.textContent = line?.ruleId ?? '';
      }
      if (line && wasHidden && !previousParts.has(line.part)) flash(row);
    });
    root!.querySelectorAll<HTMLTableRowElement>('[data-doc-lines] tr[data-part]').forEach((row) => {
      const line = included.get(row.dataset.part!);
      row.hidden = !line;
      if (!line) return;
      const qty = row.querySelector<HTMLElement>('[data-out-qty]');
      const amount = row.querySelector<HTMLElement>('[data-out-amount]');
      if (qty) qty.textContent = String(e.pricing.quantity);
      if (amount) amount.textContent = money(line.unitPrice * e.pricing.quantity);
    });
    previousParts = new Set(e.bom.map((line) => line.part));
  }

  function renderPricing(e: Evaluation) {
    const p = e.pricing;
    const tick = (key: string, value: number, prefix = '') =>
      root!.querySelectorAll<HTMLElement>(`[data-out="${key}"]`).forEach((el) => tickNumber(el, value, prefix));

    tick('unitList', p.unitList);
    tick('unitList2', p.unitList);
    tick('volumeAmount', p.volumeAmount, '−');
    tick('negotiatedAmount', p.negotiatedAmount, '−');
    tick('unitNet', p.unitNet);
    tick('total', p.total);
    tick('total2', p.total);
    tick('listTotal', p.listTotal);
    tick('discountTotal', p.listTotal - p.total, '−');
    tick('mapTotal', p.total);
    tick('mapNet', p.unitNet);

    setText(root!, 'quantity', String(p.quantity));
    setText(root!, 'quantity2', String(p.quantity));
    setText(root!, 'mapQty', String(p.quantity));
    setText(root!, 'mapLines', String(e.bom.length));
    setText(root!, 'volumePercent', `${p.volumePercent}%`);
    setText(root!, 'negotiatedPercent', `${p.negotiatedPercent}%`);
    setText(root!, 'discount', `${p.negotiatedPercent}%`);
    setText(root!, 'volumeNote', p.volumePercent > 0 ? `${p.volumePercent}% volume tier` : 'No volume tier yet');

    if (discountInput) {
      if (Number(discountInput.value) !== p.negotiatedPercent) discountInput.value = String(p.negotiatedPercent);
      discountInput.style.setProperty('--fill', `${(p.negotiatedPercent / MAX_DISCOUNT) * 100}%`);
      discountInput.setAttribute('aria-valuetext', `${p.negotiatedPercent} percent`);
    }
    root!.querySelectorAll<HTMLButtonElement>('[data-qty]').forEach((button) => {
      const delta = Number(button.dataset.qty);
      button.disabled = delta < 0 ? p.quantity <= 1 : p.quantity >= MAX_QUANTITY;
    });
  }

  function renderApprovals(e: Evaluation) {
    const needed = e.approvals.filter((step) => step.required);
    if (route) {
      route.dataset.state = e.approvalRequired ? 'required' : 'clear';
      for (const step of e.approvals) {
        const node = route.querySelector<HTMLElement>(`[data-approver="${step.role}"]`);
        node?.classList.toggle('is-required', step.required);
      }
    }
    const status = e.approvalRequired
      ? `Needs sign-off from ${needed.map((step) => step.role.toLowerCase()).join(' and ')}.`
      : 'Within seller authority. No sign-off needed.';
    setText(root!, 'approvalStatus', status);
    if (stamp) stamp.dataset.state = e.approvalRequired ? 'pending' : 'approved';
    setText(root!, 'stampText', e.approvalRequired ? 'Awaiting approval' : 'Approved within seller authority');
    setText(root!, 'mapStatus', e.approvalRequired ? 'Awaiting approval' : 'Approved');
    const reference = quoteReference(e.selection);
    setText(root!, 'reference', reference);
    setText(root!, 'mapRef', reference);
  }

  function render(e: Evaluation) {
    renderOptions(e);
    renderRules(e);
    renderBom(e);
    renderPricing(e);
    renderApprovals(e);
  }

  function update(patch: Partial<Selection>) {
    selection = { ...selection, ...patch };
    evaluation = evaluate(selection);
    selection = evaluation.selection;
    render(evaluation);
    for (const listener of listeners) listener(evaluation);
  }

  // ---- seed animated figures with what the server rendered
  const p = evaluation.pricing;
  seed('unitList', p.unitList);
  seed('unitList2', p.unitList);
  seed('volumeAmount', p.volumeAmount);
  seed('negotiatedAmount', p.negotiatedAmount);
  seed('unitNet', p.unitNet);
  seed('total', p.total);
  seed('total2', p.total);
  seed('listTotal', p.listTotal);
  seed('discountTotal', p.listTotal - p.total);
  seed('mapTotal', p.total);
  seed('mapNet', p.unitNet);
  renderPricing(evaluation);
  renderOptions(evaluation);

  // ---- inputs
  bench?.addEventListener('submit', (event) => event.preventDefault());
  bench?.addEventListener('click', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[type="radio"]');
    if (input?.getAttribute('aria-disabled') === 'true') {
      // A withdrawn option stays focusable so its reason can be read; it cannot be chosen.
      event.preventDefault();
      const reason = root.querySelector<HTMLElement>(`[data-reason="${input.name}"]`);
      if (reason) {
        reason.classList.remove('is-nudged');
        void reason.offsetWidth;
        reason.classList.add('is-nudged');
      }
    }
  });
  bench?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'radio') return;
    if (input.getAttribute('aria-disabled') === 'true') {
      render(evaluation);
      return;
    }
    update({ [input.name]: input.value } as Partial<Selection>);
  });
  // Arrow keys move between radios natively; skip over withdrawn options.
  bench?.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const input = event.target as HTMLInputElement;
    if (input.type !== 'radio') return;
    const group = Array.from(bench.querySelectorAll<HTMLInputElement>(`input[name="${input.name}"]`));
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    let index = group.indexOf(input);
    for (let i = 0; i < group.length; i++) {
      index = (index + step + group.length) % group.length;
      if (group[index].getAttribute('aria-disabled') !== 'true') break;
    }
    event.preventDefault();
    group[index].focus();
    update({ [input.name]: group[index].value } as Partial<Selection>);
  });

  root.querySelectorAll<HTMLButtonElement>('[data-qty]').forEach((button) => {
    button.addEventListener('click', () => update({ quantity: selection.quantity + Number(button.dataset.qty) }));
  });
  discountInput?.addEventListener('input', () => update({ discount: Number(discountInput.value) }));

  initWires(root);
  return api;
}

/** Draws the field-mapping connectors between the quote and the systems that receive it. */
function initWires(root: HTMLElement) {
  const map = root.querySelector<HTMLElement>('[data-map]');
  const svg = root.querySelector<SVGSVGElement>('[data-map-wires]');
  if (!map || !svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const pairs = Array.from(map.querySelectorAll<HTMLElement>('[data-field]'))
    .map((from) => ({ from, to: map.querySelector<HTMLElement>(`[data-target="${from.dataset.field}"]`) }))
    .filter((pair): pair is { from: HTMLElement; to: HTMLElement } => Boolean(pair.to));

  const elements = pairs.map(() => ({
    path: document.createElementNS(NS, 'path'),
    a: document.createElementNS(NS, 'circle'),
    b: document.createElementNS(NS, 'circle'),
  }));
  for (const el of elements) {
    el.a.setAttribute('r', '3.5');
    el.b.setAttribute('r', '3.5');
    svg.append(el.path, el.a, el.b);
  }

  const layout = () => {
    const box = map.getBoundingClientRect();
    if (!box.width) return;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    pairs.forEach((pair, index) => {
      const a = pair.from.getBoundingClientRect();
      const b = pair.to.getBoundingClientRect();
      const x1 = a.right - box.left + 8;
      const y1 = a.top - box.top + a.height / 2;
      const x2 = b.left - box.left - 8;
      const y2 = b.top - box.top + b.height / 2;
      const mid = (x2 - x1) * 0.5;
      const el = elements[index];
      el.path.setAttribute('d', `M${x1},${y1} C${x1 + mid},${y1} ${x2 - mid},${y2} ${x2},${y2}`);
      el.a.setAttribute('cx', String(x1));
      el.a.setAttribute('cy', String(y1));
      el.b.setAttribute('cx', String(x2));
      el.b.setAttribute('cy', String(y2));
    });
  };

  const setLive = (index: number, live: boolean) => {
    const pair = pairs[index];
    const el = elements[index];
    for (const node of [pair.from, pair.to, el.path, el.a, el.b]) node.classList.toggle('is-live', live);
    if (live) svg.append(el.path, el.a, el.b);
  };

  pairs.forEach((pair, index) => {
    for (const node of [pair.from, pair.to]) {
      node.addEventListener('pointerenter', () => setLive(index, true));
      node.addEventListener('pointerleave', () => setLive(index, false));
    }
  });

  new ResizeObserver(layout).observe(map);
  if (document.fonts) document.fonts.ready.then(layout);
  layout();

  // Trace each connection once as the map scrolls into view, so the mapping reads
  // without needing a pointer.
  if (!reducedMotion.matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        pairs.forEach((_, index) => {
          window.setTimeout(() => setLive(index, true), 500 + index * 260);
          window.setTimeout(() => setLive(index, false), 500 + index * 260 + 520);
        });
      },
      { threshold: 0.6 },
    );
    observer.observe(map);
  }
}
