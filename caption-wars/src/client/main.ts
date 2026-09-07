// Placeholder entry point. The real client (router, screens, polling) is
// built separately per docs/plans/2026-09-07-mvp-plan.md, item A. This just
// keeps `npm run dev` / `npm run build` / typecheck green in the meantime.

const app = document.getElementById('app');
if (app) {
  app.textContent = 'Caption Wars';
}
