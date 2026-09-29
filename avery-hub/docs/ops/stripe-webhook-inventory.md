# Stripe webhook inventory (Ownly Network LLC account)

Status: **TEMPLATE, NOT YET RUN.** No agent has Stripe access yet. The coordinator
fills this in once JJ issues a read-capable restricted key, and **before** the
Avery endpoint is added by `scripts/stripe-setup.ts`.

This file is also the setup script's gate: it will not create the Avery webhook
endpoint unless it is passed `--inventory-receipt docs/ops/stripe-webhook-inventory.md`
and this file has a real date on the line below and no `TODO` left anywhere.

inventory_completed: TODO

## Why this exists

The Ownly Network LLC Stripe account is shared with Agent Company (it ran an
endpoint behind `api.ownlyagent.com`, per the pay plan). Every endpoint on the
account receives events for every object it subscribes to, Avery's included.

**Rule:** any live endpoint on this account that subscribes to charge,
invoice, checkout or subscription events (or `*`) must ignore Avery objects.
Avery objects are tagged `metadata.app=avery` (product, prices, portal
configuration, webhook endpoint, Checkout Session, subscription). A charge or
dispute carries no metadata of its own, so the other product must decide by
**its own** customer ids, exactly as the hub does (the hub answers
`not_avery` for customers it does not know). An endpoint that cannot do that is
flagged to JJ before Avery goes live.

## Command (read only; run once in test mode and once in live mode)

Needs a restricted key with read access to Webhook Endpoints, in the
environment variable `AVERY_STRIPE_KEY`. The key goes to curl on stdin, so it
never appears in the process list or shell history. The list endpoint does not
return signing secrets.

```sh
printf 'header = "Authorization: Bearer %s"\n' "$AVERY_STRIPE_KEY" | \
  curl -sS --config - -G https://api.stripe.com/v1/webhook_endpoints \
    -H 'Stripe-Version: 2026-08-26.dahlia' -d limit=100 | \
  jq -r '"has_more=\(.has_more)", (.data[] | [.id, .livemode, .status, .url, (.api_version // "account default"),
                    (.metadata.app // "-"), (.enabled_events | join(" "))] | @tsv)'
```

The first output line shows `has_more`. If it is `true`, repeat with
`-d starting_after=<last id>`. The `Stripe-Version` value must match
`STRIPE_API_VERSION` in `src/stripe/client.ts`.

## Result (fill in)

| Mode | Endpoint id | URL | Status | Events | Owner | Touches charge / subscription events? | Ignores Avery? | Action |
|---|---|---|---|---|---|---|---|---|
| test | TODO | | | | | | | |
| live | TODO | | | | | | | |

Run date: ______  Run by: ______  Key used (name only, never the value): ______

## After the inventory

1. Any row with "Touches charge / subscription events = yes" and "Ignores Avery = no or unknown" goes to JJ as a blocker before live mode.
2. Then run `scripts/stripe-setup.ts` (staging first). Its readback lists the Avery endpoint; add it to the table above.
