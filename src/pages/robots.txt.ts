import type { APIRoute } from 'astro';

/**
 * robots.txt, generated so the sitemap line always matches the configured site URL.
 *
 * Everything is crawlable, including by the search and answer crawlers of AI assistants
 * (OAI-SearchBot, Claude-SearchBot, PerplexityBot), which is what lets those products
 * describe and cite the company. Blocking model-training crawlers (GPTBot, ClaudeBot,
 * Google-Extended) is a separate business decision; add Disallow groups here to opt out.
 */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const origin = (site ?? new URL('https://conpriquo-solutions.in')).href.replace(/\/$/, '');
  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${origin}${base}/sitemap-index.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
