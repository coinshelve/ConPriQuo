/**
 * Brief composer. Builds a plain-text brief from the form as the visitor types and
 * hands it to their own email app (mailto) or to the clipboard. No network requests.
 */
import { company } from '../data/site';

type Path = 'project' | 'staffing';

const text = (form: HTMLFormElement, name: string) =>
  ((form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '').trim();

const checked = (form: HTMLFormElement, name: string) =>
  Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)).map((input) => input.value);

function compose(form: HTMLFormElement, path: Path) {
  const name = text(form, 'name');
  const organisation = text(form, 'company');
  const lines: string[] = [];
  let subject: string;
  let hasSubstance: boolean;

  if (path === 'project') {
    const platforms = checked(form, 'platform');
    const kind = checked(form, 'kind')[0] ?? '';
    const need = text(form, 'need');
    const timing = text(form, 'timing');
    subject = `Project brief${platforms.length ? `: ${platforms.join(', ')}` : ''}`;
    lines.push('PROJECT BRIEF', '');
    lines.push(`Platform:      ${platforms.length ? platforms.join(', ') : 'To be discussed'}`);
    lines.push(`Kind of work:  ${kind || 'To be discussed'}`);
    lines.push(`Timing:        ${timing || 'To be discussed'}`);
    lines.push('', 'What needs to happen:', need || '(Write a few lines here, or leave it for the call.)');
    hasSubstance = Boolean(need || platforms.length || kind);
  } else {
    const role = text(form, 'role');
    const count = text(form, 'count');
    const start = text(form, 'start');
    const location = text(form, 'location');
    const duration = text(form, 'duration');
    const engagement = checked(form, 'engagement')[0] ?? '';
    subject = `Skill requirement${count ? `: ${count} specialist${count === '1' ? '' : 's'}` : ''}`;
    lines.push('SKILL REQUIREMENT', '');
    lines.push(`People needed: ${count || 'To be discussed'}`);
    lines.push(`Start date:    ${start || 'To be discussed'}`);
    lines.push(`Location:      ${location || 'To be discussed'}`);
    lines.push(`Duration:      ${duration || 'To be discussed'}`);
    lines.push(`Engagement:    ${engagement || 'To be discussed'}`);
    lines.push('', 'Role and must-have skills:', role || '(List the must-haves here, or leave them for the call.)');
    hasSubstance = Boolean(role || count);
  }

  lines.push('');
  lines.push(`From: ${name || '(your name)'}${organisation ? `, ${organisation}` : ''}`);

  return { subject, body: lines.join('\n'), hasSubstance };
}

export function initBrief() {
  const root = document.querySelector<HTMLElement>('[data-brief]');
  const form = root?.querySelector<HTMLFormElement>('[data-composer]');
  if (!root || !form) return;

  const preview = form.querySelector<HTMLElement>('[data-preview]')!;
  const send = form.querySelector<HTMLAnchorElement>('[data-send]')!;
  const copy = form.querySelector<HTMLButtonElement>('[data-copy]')!;
  const status = form.querySelector<HTMLElement>('[data-status]')!;
  const panels = Array.from(form.querySelectorAll<HTMLElement>('[data-path-panel]'));
  let statusTimer = 0;

  const currentPath = (): Path =>
    (form.querySelector<HTMLInputElement>('input[name="path"]:checked')?.value as Path) ?? 'project';

  const say = (message: string) => {
    status.textContent = message;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (status.textContent = ''), 6000);
  };

  const render = () => {
    const path = currentPath();
    for (const panel of panels) panel.hidden = panel.dataset.pathPanel !== path;
    const { subject, body } = compose(form, path);
    preview.textContent = body;
    send.href = `mailto:${company.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const setPath = (path: Path) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="path"][value="${path}"]`);
    if (input && !input.checked) {
      input.checked = true;
      render();
    }
  };

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', (event) => event.preventDefault());

  send.addEventListener('click', () => {
    const { hasSubstance } = compose(form, currentPath());
    say(
      hasSubstance
        ? 'Opening a draft in your email app. If nothing opens, copy the brief and send it to ' + company.email + '.'
        : 'Opening a blank draft. Add a line about what you need, or write it in the email itself.',
    );
  });

  copy.addEventListener('click', async () => {
    const { body } = compose(form, currentPath());
    const payload = `To: ${company.email}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(payload);
      say('Copied. Paste it into an email to ' + company.email + '.');
    } catch {
      // Clipboard access can be refused; select the preview so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(preview);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      preview.focus();
      say('Copying was blocked by the browser. The brief is selected: press Ctrl or Cmd and C.');
    }
  });

  // Calls to action elsewhere on the page choose the matching path before scrolling here.
  // Intent links also carry a platform, a kind of work and a first sentence; these are
  // applied without overwriting anything the visitor has already written.
  document.addEventListener('click', (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-brief-path]');
    if (!trigger) return;
    const path = trigger.dataset.briefPath;
    if (path !== 'project' && path !== 'staffing') return;
    setPath(path);

    const { briefPlatform, briefKind, briefNeed } = trigger.dataset;
    if (briefPlatform) {
      const box = form.querySelector<HTMLInputElement>(`input[name="platform"][value="${briefPlatform}"]`);
      if (box) box.checked = true;
    }
    if (briefKind && !form.querySelector('input[name="kind"]:checked')) {
      const radio = form.querySelector<HTMLInputElement>(`input[name="kind"][value="${briefKind}"]`);
      if (radio) radio.checked = true;
    }
    if (briefNeed) {
      const need = form.elements.namedItem('need') as HTMLTextAreaElement | null;
      if (need && !need.value.trim()) need.value = briefNeed;
    }
    render();
  });

  render();
}
