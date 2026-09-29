# Tax gate receipt (template)

Copy this file to `docs/ops/tax-gate-receipt.md` and fill it in only after JJ
and her accountant have signed off (plan: "Tax gate before live mode"). The
live setup run (`scripts/stripe-setup.ts --live --tax-gate-receipt
docs/ops/tax-gate-receipt.md`) refuses unless EVERY field at the bottom is
filled (`approved:` a real date not in the future; `taxable:` yes or no;
`product_tax_code:` a Stripe `txcd_` code; `registrations:` the states, or
`none` only when taxable is no), Stripe Tax shows `status: active`, and, when
taxable, Stripe Tax has at least one active registration. The fields below are
left as placeholders on purpose so this template can never pass. Agents never
write this file; the owner does.

| Question | Answer | Who confirmed |
|---|---|---|
| Seller | Ownly Network LLC | |
| Home state | | |
| Is a digital teaching subscription taxable there? | | |
| Stripe product tax code | | |
| Registrations added in Stripe Tax (states) | | |
| Stripe Tax switched on (Dashboard, Tax settings) | | |
| Accountant | | |

Decision and notes:

approved: YYYY-MM-DD
approved_by: TODO
home_state: TODO
taxable: TODO
product_tax_code: TODO
registrations: TODO
