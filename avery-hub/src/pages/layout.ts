// Server-rendered pages in the Avery Studio look (brand kit copies in public/).
// Plain English, phone-first, no jargon.
export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface PageOpts {
  status?: number;
  headers?: HeadersInit;
  supportEmail: string;
  /** Origins a form on this page may end up at after a redirect (Chrome applies form-action to redirects). */
  formRedirectOrigins?: string[];
}

export function page(title: string, body: string, o: PageOpts): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#FDF6EC">
<meta name="robots" content="noindex">
<title>${esc(title)} · Avery Studio</title>
<link rel="icon" href="/momo-icon.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Noto+Sans+SC:wght@400;500;700&family=Quicksand:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/theme.css">
<style>
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--font-ui); }
  main { max-width: 560px; margin: 0 auto; padding: 16px; }
  h1 { font-family: var(--font-head); font-size: 1.8rem; margin: 8px 0 12px; }
  .card { background: var(--card); border-radius: 18px; padding: 16px; margin: 14px 0; box-shadow: 0 2px 0 var(--paper-deep); }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--paper-deep); }
  .row:last-child { border-bottom: 0; }
  .muted { color: var(--ink-soft); }
  form { margin: 10px 0; }
  button { min-height: var(--tap); width: 100%; font: inherit; font-weight: 700; border-radius: 14px; cursor: pointer; }
  a.btn-primary, a.btn-secondary { display: flex; align-items: center; justify-content: center; min-height: var(--tap); border-radius: 14px; text-decoration: none; font-weight: 700; }
  .danger { background: var(--pink-soft); color: var(--ink); border: 3px solid var(--pink-deep); }
</style>
</head>
<body>
<header class="avery-header">
  <a href="/me" aria-label="Avery Studio: my account">
    <img src="/momo-icon.png" srcset="/momo-icon.png 1x, /momo-icon@2x.png 2x" alt="" width="44" height="44">
    <span class="avery-lockup"><span class="avery-wordmark">Avery Studio</span><span class="avery-tagline">with 墨墨 Momo</span></span>
  </a>
</header>
<main>
${body}
</main>
<footer class="avery-footer">
  <p class="avery-line"><b>Avery Studio</b> · 墨墨 Momo · averystudio.org</p>
  <p class="avery-credits">Need help? Write to <a href="mailto:${esc(o.supportEmail)}">${esc(o.supportEmail)}</a>.</p>
</footer>
</body>
</html>`;
  const headers = new Headers(o.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Frame-Options', 'DENY');
  // same-origin, not no-referrer: under no-referrer Chrome sends `Origin: null` on
  // form posts, and the Origin check would refuse every hub form.
  headers.set('Referrer-Policy', 'same-origin');
  const formAction = ["'self'", ...(o.formRedirectOrigins ?? [])].join(' ');
  headers.set('Content-Security-Policy', `default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`);
  return new Response(html, { status: o.status ?? 200, headers });
}

/** The one message for every sign-in failure (plan "When the hub is down or broken"). */
export function cantSignIn(supportEmail: string, status = 503, headers?: HeadersInit): Response {
  return page(
    "Can't sign in right now",
    `<h1>Can't sign in right now</h1>
<div class="card"><p>Something went wrong on our side. You can still play one free round of each game without signing in.</p>
<p class="muted">Please try again in a few minutes.</p></div>`,
    { status, supportEmail, headers },
  );
}
