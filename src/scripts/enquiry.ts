/**
 * The enquiry dialog: opening, validation and delivery.
 *
 * Delivery has two modes, chosen at build time by PUBLIC_FORM_ENDPOINT:
 *
 *   set     The request is posted as JSON to that URL (a form service or your own
 *           API). The dialog reports success only when the endpoint confirms it.
 *   unset   There is no server to receive anything, so the request is handed to the
 *           visitor's own email app as a ready-to-send message. The page cannot know
 *           whether that app opened, so the dialog never says the request was sent:
 *           it says what should have happened and offers the other ways to reach us.
 */
import { company } from '../data/site';

const ENDPOINT = String(import.meta.env.PUBLIC_FORM_ENDPOINT ?? '').trim();
/**
 * Some form services identify the receiving form by a public key sent with each
 * request instead of by the URL. When one is configured it travels as `access_key`.
 */
const ACCESS_KEY = String(import.meta.env.PUBLIC_FORM_ACCESS_KEY ?? '').trim();

/** Some mail handlers cut off very long links, so the composed link is kept under this. */
const MAILTO_LIMIT = 1900;
/** A request to the form endpoint that has not answered by now is treated as failed. */
const SEND_TIMEOUT = 15000;

type FieldName = 'service' | 'name' | 'phone' | 'email';
const FIELDS: FieldName[] = ['service', 'name', 'phone', 'email'];

interface Enquiry {
  service: string;
  name: string;
  phone: string;
  email: string;
  requirement: string;
}

/** Every label of the domain starts and ends with a letter or digit; the last is letters. */
const EMAIL = /^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
/** An extension written after the number: "ext 204", "x12". */
const EXTENSION = /\s*(?:ext\.?|extn\.?|x)\s*\d{1,6}\s*$/i;

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
  // The number itself needs 7 to 15 digits; spaces, brackets, dashes, dots, slashes
  // and a trailing extension are all ways people really write one.
  const number = values.phone.replace(EXTENSION, '');
  const digits = number.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || /[^\d+()\-./\s]/.test(number)) {
    errors.phone = 'Enter a phone number with 7 to 15 digits.';
  }
  if (!EMAIL.test(values.email) || values.email.includes('..')) errors.email = 'Enter your business email address.';
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
 * handlers accept; `shortened` tells the dialog to say so. Text is cut between whole
 * characters, never inside one, so an emoji at the cut cannot break the link.
 */
function composeMailto(values: Enquiry): { href: string; shortened: boolean } {
  const subject = encodeURIComponent(`Website inquiry: ${values.service}`);
  const build = (requirement: string) =>
    `mailto:${company.email}?subject=${subject}&body=${encodeURIComponent(asLines(values, requirement).join('\r\n').replace(/\r?\n/g, '\r\n'))}`;
  let href = build(values.requirement);
  if (href.length <= MAILTO_LIMIT) return { href, shortened: false };
  const characters = Array.from(values.requirement);
  let keep = characters.length;
  while (href.length > MAILTO_LIMIT && keep > 0) {
    keep = Math.max(0, keep - 40);
    href = build(`${characters.slice(0, keep).join('').trimEnd()} [shortened here]`);
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
  let sending = false;
  // What the last opening filled in by itself. Anything the visitor has not changed
  // since is replaced on the next opening, so one call to action's service or note
  // never travels with a request started from another.
  let autoService = '';
  let autoNote = '';

  const submitLabel = ENDPOINT ? 'Send request' : 'Continue in your email app';
  submit.textContent = submitLabel;
  note.textContent = ENDPOINT
    ? 'We use these details only to reply to your request.'
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
    if (sending) return;
    trigger = from;
    // A panel left over from the last request, and any errors from an earlier
    // attempt, do not belong to this opening.
    if (!done.hidden) showForm();
    for (const name of FIELDS) setError(name, '');
    status.textContent = '';

    const wanted = from?.dataset.enquiryService ?? '';
    if (wanted && Array.from(service.options).some((option) => option.value === wanted)) {
      service.value = wanted;
      autoService = wanted;
    } else if (service.value === autoService) {
      // Chosen by an earlier call to action, not by the visitor: start clean.
      service.value = '';
      autoService = '';
    }
    const suggestion = from?.dataset.enquiryNote ?? '';
    if (!requirement.value.trim() || requirement.value === autoNote) {
      requirement.value = suggestion;
      autoNote = suggestion;
    }

    document.documentElement.classList.add('has-dialog');
    if (!dialog.open) dialog.showModal();
    const first = service.value ? (form.elements.namedItem('name') as HTMLElement) : service;
    first.focus();
  };

  // While a request is on its way the dialog stays open, so its outcome is seen.
  const close = () => {
    if (!sending) dialog.close();
  };
  dialog.addEventListener('cancel', (event) => {
    if (sending) event.preventDefault();
  });

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
    if (sending) return;
    const values = read(form);
    const errors = check(values);
    for (const name of FIELDS) setError(name, errors[name] ?? '');
    const firstInvalid = FIELDS.find((name) => errors[name]);
    if (firstInvalid) {
      status.textContent = 'Please check the highlighted fields.';
      (form.elements.namedItem(firstInvalid) as HTMLElement).focus();
      return;
    }
    status.textContent = '';
    last = values;
    const firstName = values.name.split(/\s+/)[0];
    const otherWays = `Please email ${company.email} or call ${company.phoneDisplay}.`;

    if (ENDPOINT) {
      // A filled trap field means an automated form filler: nothing is sent.
      if (trap?.value) {
        form.reset();
        showDone('Request sent.', `Thank you, ${firstName}. We have your details and will reply by email or phone.`);
        return;
      }
      sending = true;
      submit.disabled = true;
      submit.textContent = 'Sending';
      const abort = new AbortController();
      const timer = window.setTimeout(() => abort.abort(), SEND_TIMEOUT);
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            ...(ACCESS_KEY ? { access_key: ACCESS_KEY } : {}),
            ...values,
            page: window.location.href,
            subject: `Website inquiry: ${values.service}`,
          }),
          signal: abort.signal,
        });
        if (!response.ok) throw new Error(`Form endpoint answered ${response.status}`);
        form.reset();
        autoService = '';
        autoNote = '';
        showDone('Request sent.', `Thank you, ${firstName}. We have your details and will reply by email or phone.`);
      } catch (error) {
        console.warn('Enquiry could not be delivered.', error);
        status.textContent = `This could not be sent right now. ${otherWays}`;
      } finally {
        window.clearTimeout(timer);
        sending = false;
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
      return;
    }

    let handoff: { href: string; shortened: boolean };
    try {
      handoff = composeMailto(values);
    } catch (error) {
      console.warn('The email could not be prepared.', error);
      status.textContent = `The email could not be prepared from this text. ${otherWays}`;
      return;
    }
    window.location.href = handoff.href;
    // The page cannot tell whether an email app opened, so it does not claim one did.
    showDone(
      'One step left: send the email.',
      handoff.shortened
        ? `A ready-to-send message should now be open in your email app. Your requirement was long, so the email holds only the first part. Copy the details and paste the rest before you send it to ${company.email}.`
        : `A ready-to-send message should now be open in your email app. Press send and it reaches ${company.email}. If nothing opened, open the email again, copy the details, or call ${company.phoneDisplay}.`,
      handoff.href,
    );
  });

  copy.addEventListener('click', async () => {
    const text = `To: ${company.email}\n\n${asLines(last ?? read(form)).join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = 'Copied.';
    } catch {
      copyStatus.textContent = `Copying was blocked by the browser. Please email ${company.email} or call ${company.phoneDisplay}.`;
    }
  });
}
