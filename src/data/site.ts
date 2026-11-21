/**
 * Single source of company facts. Everything here is taken from ConPriQuo's own
 * published material (its website and capabilities deck). Do not add claims that the
 * company has not published: no certifications, partner tiers, client counts or metrics.
 */
export const company = {
  name: 'ConPriQuo Solutions',
  shortName: 'ConPriQuo',
  url: 'https://conpriquo-solutions.in',
  email: 'admin@conpriquo-solutions.in',
  phoneDisplay: '+91 97391 72525',
  phoneHref: '+919739172525',
  address: {
    street: 'Plot No. 13, 6th Cross, Ujwal Nagar',
    locality: 'Belagavi',
    region: 'Karnataka',
    country: 'India',
    countryCode: 'IN',
  },
  linkedin: 'https://www.linkedin.com/company/conpriquo-solutions',
  instagram: 'https://www.instagram.com/conpriquo_solutions/',
} as const;

/**
 * Planned information architecture. Only the homepage exists in this phase, so these
 * names are rendered as plain text, never as links.
 */
export const plannedPages = {
  primary: ['Oracle CPQ', 'Oracle CX', 'Salesforce', 'IT Staffing', 'Case Studies', 'About'],
  footer: [
    {
      heading: 'Consulting',
      items: ['Oracle CPQ', 'Oracle CX', 'Salesforce'],
    },
    {
      heading: 'Staffing',
      items: ['Contract Staffing', 'Staff Augmentation'],
    },
    {
      heading: 'Company',
      items: ['About', 'Case Studies', 'Privacy Policy'],
    },
  ],
} as const;

/** In-page chapters of the homepage. These are real anchors and are rendered as links. */
export const chapters = [
  { id: 'configure', label: 'Configure' },
  { id: 'price', label: 'Price' },
  { id: 'quote', label: 'Quote' },
  { id: 'handoff', label: 'Hand off' },
  { id: 'practices', label: 'Practices' },
  { id: 'engagements', label: 'Engagements' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'staffing', label: 'Staffing' },
  { id: 'contact', label: 'Contact' },
] as const;

/**
 * The enquiry dialog's service dropdown. Each option is a request a buyer actually
 * arrives with, in the words they would use, grouped by the two ways of working.
 */
export const enquiry = {
  services: [
    {
      label: 'Consulting',
      options: [
        'Oracle CPQ implementation',
        'Oracle CPQ enhancements or support',
        'Oracle CPQ integration with CRM or ERP',
        'Oracle CX consulting',
        'Salesforce consulting',
      ],
    },
    {
      label: 'Staffing',
      options: [
        'Contract specialists: Oracle CPQ, Oracle CX or Salesforce',
        'Contract specialists: engineering, cloud or data',
        'Staff augmentation for an existing team',
      ],
    },
    {
      label: 'Other',
      options: ['Something else, or not sure yet'],
    },
  ],
} as const;
