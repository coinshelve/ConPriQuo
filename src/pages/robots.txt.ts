import type { APIRoute } from 'astro';

/**
 * robots.txt, generated so the sitemap line always matches the configured site URL.
 *
 * Everything is crawlable, including by the search and answer crawlers of AI assistants
 * (OAI-SearchBot, Claude-SearchBot, PerplexityBot), which is what lets those products
 * describe and cite the company. Blocking model-training crawlers (GPTBot, ClaudeBot,
 * Google-Extended) is a separate business decision; add Disallow groups here to opt out.
 */
const PRODUCTION = 'https://conpriquo-solutions.in';

export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const origin = (site ?? new URL(PRODUCTION)).href.replace(/\/$/, '');
  // A preview copy on another address or under a sub-path is not for search engines:
  // it has no sitemap and asks crawlers to stay out. (The page itself is also marked
  // noindex, which is what counts when this file is not at the host's root.)
  const preview = origin !== PRODUCTION || base !== '';
  const body = preview
    ? ['User-agent: *', 'Disallow: /', ''].join('\n')
    : ['User-agent: *', 'Allow: /', '', `Sitemap: ${origin}/sitemap-index.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
