# Dispute runbook (Avery Classroom Games)

A dispute (chargeback) is when a teacher's bank takes the money back and asks
us to prove the charge was fair.

## Who answers

JJ, as the owner of the Ownly Network LLC Stripe account (plan default; JJ to
confirm or name someone else). Nobody else responds on the account.

## The deadline

Stripe shows the response deadline on the dispute page in the Dashboard (the
dispute's `evidence_details.due_by`). **Missing it loses the dispute.** Stripe
emails the account owner when a dispute opens; the hub's alert channel (a
GitHub issue labelled `avery-alert`, built in S2b) also fires.

## Evidence

| Evidence | Where it comes from |
|---|---|
| Receipt and the renewal terms she agreed to at Checkout | Stripe (the Checkout Session and the invoice) |
| That she signed in and used the games after paying | Hub admin export of her account (S1 admin module): sign-in dates and saved lists, no student data |
| The refund policy she saw | averystudio.org terms and refund pages (S0b) |
| Any emails with her | hello@averystudio.org inbox |

Evidence is uploaded on the dispute page in the Stripe Dashboard. Where the
exported files are kept between steps is **not decided yet** (open question for
JJ); they contain a teacher's personal data, so not in this repo.

## What the hub does by itself

| Event | Hub action | Where |
|---|---|---|
| `charge.dispute.created` | The dispute's charge is fetched to find the customer. If she is an Avery teacher, access pauses to free while the dispute is open (`DISPUTE_ACTION` = pause) | `resolveCustomer` in `src/stripe/events.ts`, `accessFor` in `src/stripe/access.ts` (S2a); processing in the BillingDO (S2b) |
| `charge.dispute.closed`, **won** | Access goes back to whatever the subscription says | same |
| `charge.dispute.closed`, **lost** | Access goes to free, and the subscription is cancelled so Stripe does not charge her again, key `cancel:<subscription_id>:dispute_lost:<op_id>` | same; the cancel call is S2b |
| Dispute on a customer who is not an Avery teacher (Agent Company) | Recorded as `not_avery`, answered 200, nothing else | `resolveCustomer` |
| Dispute on an OLD charge (not this subscription's latest paid charge) | No effect on her current subscription | `accessFor` |
| A dispute status Stripe adds later that the code does not know | Access goes to free with reason `unknown_dispute_status:<status>`; S2b raises an alert so JJ checks it | `accessFor` |

## Test

In test mode, Stripe's dispute test card creates a dispute on payment. Use it
on staging to prove access pauses (plan, "Webhook processing" step 2 tests).
