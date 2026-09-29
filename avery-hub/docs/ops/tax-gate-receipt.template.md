# Tax gate receipt (template)

Copy this file to `docs/ops/tax-gate-receipt.md` and fill it in only after JJ
and her accountant have signed off (plan: "Tax gate before live mode"). The
live setup run (`scripts/stripe-setup.ts --live --tax-gate-receipt
docs/ops/tax-gate-receipt.md`) refuses unless the `approved:` line below holds
a real date that is not in the future, AND Stripe Tax shows `status: active`
on the account. This template's own `approved:` line is left blank on purpose
so it can never pass.

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
approved_by:
