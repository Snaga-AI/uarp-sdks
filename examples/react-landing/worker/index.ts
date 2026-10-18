/**
 * dev.snaga.ai on Cloudflare: the built page, served as static assets.
 *
 * The page is static except for the live widget, whose proxy
 * (`server/handlers.ts`) keeps each visitor's key in the memory of one Node
 * process. A Worker has no such process — isolates come and go — so the proxy
 * is not ported here yet, and `/api/uarp/*` says so instead of falling through
 * to `index.html`, which the widget would try to read as JSON.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/uarp/')) {
      return Response.json(
        { message: 'The live widget is not running on this host yet. Every sample on the page works with your own key.' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
    return env.ASSETS.fetch(request);
  },
};
