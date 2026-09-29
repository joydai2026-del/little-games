# Refund runbook (Avery Classroom Games)

Owner: JJ. Support address: hello@averystudio.org.

## Policy (JJ, 2026-09-29)

| Plan | Refund |
|---|---|
| Yearly ($39.00) | Full refund, no questions, within **14 days** of the first purchase **and within 14 days of each yearly renewal** (`REFUND_WINDOW_DAYS` = 14) |
| Monthly ($6.99) | No refund. She can cancel any time; access runs to the end of the paid month plus grace |

How to measure the 14 days: from the `created` time of the charge being refunded
(the first purchase or that year's renewal) to the day she asked. Stripe does
not return its processing fee on a refund, and a refund waits as pending if
the available balance is too low (https://docs.stripe.com/refunds).

## The workflow: refund, then cancel, then mark (three idempotent steps)

A refund does **not** cancel a subscription in Stripe; they are separate
operations. Do all three, in this order. Each step is recorded in
`billing_ops` and can be re-run safely until all three are done: the same
`op_id` produces the same Stripe idempotency key, so a retry never refunds or
cancels twice.

| Step | What | Stripe idempotency key |
|---|---|---|
| 1 | Refund the charge in full | `refund:<charge_id>:<op_id>` |
| 2 | Cancel the subscription **immediately**, no proration | `cancel:<subscription_id>:refund:<op_id>` |
| 3 | Mark the op `refunded_full` and bump the teacher's `entitlement_version` | none (hub database) |

After step 3 the teacher is on free. `accessFor` keeps her on free even if a
later Stripe fetch still shows the subscription `active`, because a completed
`refund_full` op for that subscription always wins (tested in
`tests/stripe/access.test.ts`).

The admin tool that runs these steps is built in slice S2b. Until then, and as a
fallback, use the Dashboard route below.

## Dashboard route (fallback)

1. Stripe Dashboard, Payments, find the charge (search her email), **Refund**, full amount.
2. The `charge.refunded` event (full amount) makes the hub run steps 2 and 3 by itself (S2b).
3. Check the next day that the subscription shows **Canceled** in Stripe. If not, cancel it by hand: Subscriptions, the subscription, **Cancel**, immediately.

A **partial** refund changes nothing in access (by design). Use it only for goodwill credits.

## Moving from monthly to yearly

Plan switching is off in the Customer Portal. On request, JJ changes the
subscription's price in the Dashboard. No refund is due on the monthly part.

## Two active subscriptions for one teacher

Reconciliation alerts this. Refund and cancel the **newer** one with the workflow above.
