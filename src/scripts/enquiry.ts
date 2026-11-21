/**
 * The enquiry dialog: opening, validation and delivery.
 *
 * Delivery has two modes, chosen at build time by PUBLIC_FORM_ENDPOINT:
 *
 *   set     The request is posted as JSON to that URL (a form service or your own
 *           API). The dialog reports success only when the endpoint confirms it.
 *   unset   There is no server to receive anything, so the request is handed to the
 *           visitor's own email app as a ready-to-send message, and the dialog says
 *           exactly that. Nothing is transmitted or stored by the page.
 */
import { company } from '../data/site';

const ENDPOINT = String(import.meta.env.PUBLIC_FORM_ENDPOINT ?? '').trim();

/** Some mail handlers cut off very long links, so the composed link is kept under this. */
const MAILTO_LIMIT = 1900;

type FieldName = 'service' | 'name' | 'phone' | 'email';

interface Enquiry {
  service: string;
  name: string;
  phone: string;
  email: string;
  requirement: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function read(form: HTMLFormElement): Enquiry {
  const value = (name: string) =>
    ((form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value ?? '').trim();
  return {
    service: value('service'),
    name: value('name'),
    phone: value('phone'),
    email: value('email'),
    requirement: value('requirement'),
  };
}

function check(values: Enquiry): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  if (!values.service) errors.service = 'Choose what you need help with.';
  if (values.name.length < 2) errors.name = 'Enter your name.';
  const digits = values.phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || /[^\d+()\-.\s]/.test(values.phone)) {
    errors.phone = 'Enter a phone number we can reach you on.';
  }
  if (!EMAIL.test(values.email)) errors.email = 'Enter your business email address.';
  return errors;
}

function asLines(values: Enquiry, requirement = values.requirement): string[] {
  return [
    `Service: ${values.service}`,
    `Name: ${values.name}`,
    `Phone: ${values.phone}`,
    `Email: ${values.email}`,
    '',
    'Requirement:',
    requirement || '(not given)',
  ];
}

/**
 * The ready-to-send message as a mailto link. Lines are separated by CRLF, as mail
 * expects. A very long requirement is shortened to keep the link within what mail
 * handlers accept; `shortened` tells the dialog to say so.
 */
function composeMailto(values: Enquiry): { href: string; shortened: boolean } {
  const subject = encodeURIComponent(`Website enquiry: ${values.service}`);
  const build = (requirement: string) =>
    `mailto:${company.email}?subject=${subject}&body=${encodeURIComponent(asLines(values, requirement).join('\r\n'))}`;
  let href = build(values.requirement);
  if (href.length <= MAILTO_LIMIT) return { href, shortened: false };
  let requirement = values.requirement;
  while (href.length > MAILTO_LIMIT && requirement.length > 0) {
    requirement = requirement.slice(0, Math.max(0, requirement.length - 40));
    href = build(`${requirement.trimEnd()} [shortened here]`);
  }
  return { href, shortened: true };
}

export function initEnquiry() {
  const dialog = document.querySelector<HTMLDialogElement>('[data-enquiry-dialog]');
  const form = dialog?.querySelector<HTMLFormElement>('[data-enquiry-form]');
  if (!dialog || !form || typeof dialog.showModal !== 'function') return;

  const submit = form.querySelector<HTMLButtonElement>('[data-enquiry-submit]')!;
  const note = form.querySelector<HTMLElement>('[data-enquiry-note]')!;
  const status = form.querySelector<HTMLElement>('[data-enquiry-status]')!;
  const done = dialog.querySelector<HTMLElement>('[data-enquiry-done]')!;
  const doneTitle = dialog.querySelector<HTMLElement>('[data-enquiry-done-title]')!;
  const doneText = dialog.querySelector<HTMLElement>('[data-enquiry-done-text]')!;
  const again = dialog.querySelector<HTMLAnchorElement>('[data-enquiry-mailto]')!;
  const copy = dialog.querySelector<HTMLButtonElement>('[data-enquiry-copy]')!;
  const copyStatus = dialog.querySelector<HTMLElement>('[data-enquiry-copy-status]')!;
  const service = form.elements.namedItem('service') as HTMLSelectElement;
  const requirement = form.elements.namedItem('requirement') as HTMLTextAreaElement;
  const trap = form.elements.namedItem('website') as HTMLInputElement | null;
  let trigger: HTMLElement | null = null;
  let last: Enquiry | null = null;

  const submitLabel = ENDPOINT ? 'Send request' : 'Continue in email app';
  submit.textContent = submitLabel;
  note.textContent = ENDPOINT
    ? 'We use these details only to reply to your enquiry.'
    : 'Opens a ready-to-send message in your own email app. This page stores nothing.';

  const setError = (name: FieldName, message: string) => {
    const field = form.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
    const input = form.elements.namedItem(name) as HTMLElement;
    const error = field.querySelector<HTMLElement>('.field__error')!;
    field.classList.toggle('is-invalid', Boolean(message));
    error.hidden = !message;
    error.textContent = message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', error.id);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  };

  const showForm = () => {
    form.hidden = false;
    done.hidden = true;
    status.textContent = '';
    copyStatus.textContent = '';
  };

  /** `handoff` is the mailto link when the request went to the visitor's email app. */
  const showDone = (title: string, text: string, handoff = '') => {
    form.hidden = true;
    done.hidden = false;
    doneTitle.textContent = title;
    doneText.textContent = text;
    again.hidden = !handoff;
    copy.hidden = !handoff;
    if (handoff) again.href = handoff;
    done.focus();
  };

  const open = (from: HTMLElement | null) => {
    trigger = from;
    showForm();
    const wanted = from?.dataset.enquiryService;
    if (wanted && Array.from(service.options).some((option) => option.value === wanted)) service.value = wanted;
    const suggestion = from?.dataset.enquiryNote;
    if (suggestion && !requirement.value.trim()) requirement.value = suggestion;
    document.documentElement.classList.add('has-dialog');
    dialog.showModal();
    const first = service.value ? (form.elements.namedItem('name') as HTMLElement) : service;
    first.focus();
  };

  const close = () => dialog.close();

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('has-dialog');
    trigger?.focus();
  });

  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.querySelectorAll<HTMLElement>('[data-enquiry-close]').forEach((button) => button.addEventListener('click', close));

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-enquiry]');
    if (!from) return;
    // Without this script the same element is an ordinary mailto link.
    event.preventDefault();
    open(from);
  });

  // Clear a field's error as soon as it is corrected.
  form.addEventListener('input', (event) => {
    const name = (event.target as HTMLInputElement).name as FieldName;
    if (!form.querySelector(`[data-field="${name}"].is-invalid`)) return;
    const errors = check(read(form));
    if (!errors[name]) setError(name, '');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = read(form);
    const errors = check(values);
    const names: FieldName[] = ['service', 'name', 'phone', 'email'];
    for (const name of names) setError(name, errors[name] ?? '');
    const firstInvalid = names.find((name) => errors[name]);
    if (firstInvalid) {
      status.textContent = 'Please check the highlighted fields.';
      (form.elements.namedItem(firstInvalid) as HTMLElement).focus();
      return;
    }
    status.textContent = '';
    last = values;
    const firstName = values.name.split(/\s+/)[0];

    if (ENDPOINT) {
      // A filled trap field means an automated form filler: nothing is sent.
      if (trap?.value) {
        form.reset();
        showDone('Request sent.', `Thank you, ${firstName}. We have your details and will reply by email or phone.`);
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Sending';
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ...values, page: window.location.href, subject: `Website enquiry: ${values.service}` }),
        });
        if (!response.ok) throw new Error(`Form endpoint answered ${response.status}`);
        form.reset();
        showDone('Request sent.', `Thank you, ${firstName}. We have your details and will reply by email or phone.`);
      } catch (error) {
        console.warn('Enquiry could not be delivered.', error);
        status.textContent = `This could not be sent just now. Please email ${company.email} or call ${company.phoneDisplay}.`;
      } finally {
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
      return;
    }

    const { href, shortened } = composeMailto(values);
    window.location.href = href;
    showDone(
      'Your email app has the request.',
      shortened
        ? `Press send there and it reaches ${company.email}. Your requirement was long, so the email holds only the first part: copy the details and paste the rest.`
        : `Press send there and it reaches ${company.email}. If nothing opened, open the email again, or copy the details and send them to us.`,
      href,
    );
  });

  copy.addEventListener('click', async () => {
    const text = `To: ${company.email}\n\n${asLines(last ?? read(form)).join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = 'Copied.';
    } catch {
      copyStatus.textContent = `Copying was blocked by the browser. Please email ${company.email}.`;
    }
  });
}
