#!/usr/bin/env node
// Deploy gate: calls POST /api/ai-smoke on the deployed Worker and fails loudly
// if either model is not answering. Run it before anyone is handed the link.
//
//   CAPTION_WARS_URL=https://caption-wars.<subdomain>.workers.dev \
//   SMOKE_TOKEN=<the same value you gave `wrangler secret put SMOKE_TOKEN`> \
//   npm run ai:smoke
//
// No dependencies: plain Node fetch.

const url = (process.env.CAPTION_WARS_URL ?? '').replace(/\/+$/, '');
const token = process.env.SMOKE_TOKEN ?? '';

function die(message) {
  console.error(`ai:smoke FAILED - ${message}`);
  process.exit(1);
}

if (!url) die('set CAPTION_WARS_URL to the deployed worker URL');
if (!token) die('set SMOKE_TOKEN to the value you gave `npx wrangler secret put SMOKE_TOKEN`');

const endpoint = `${url}/api/ai-smoke`;
let response;
try {
  response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'x-smoke-token': token, 'Content-Type': 'application/json' },
    body: '{}',
  });
} catch (err) {
  die(`could not reach ${endpoint}: ${err.message}`);
}

const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  die(`${endpoint} answered ${response.status} with non-JSON: ${text.slice(0, 300)}`);
}

if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  die(`${endpoint} answered ${response.status}`);
}

console.log(JSON.stringify(body, null, 2));

if (!body.vision?.ok) die(`the vision model did not answer (tried ${body.vision?.model})`);
if (!body.text?.ok) die(`the text model did not answer (tried ${body.text?.model})`);

console.log(`ai:smoke OK - vision ${body.vision.model}, text ${body.text.model}`);
