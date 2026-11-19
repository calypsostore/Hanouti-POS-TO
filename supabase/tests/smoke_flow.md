# Production order and shift smoke flow

Use a designated test store, a staff account with shift/order/tab/void
permissions, an active low-cost item, an active customer, and an owner account
with its Admin PIN set. These steps create real records; use small amounts and
do not use customer orders.

Record:

- `S`: opening cash
- `C`: cash-order total
- `T`: cash tab-payment total
- `I`: cash-in total
- `O`: cash-out total
- `V`: cash total approved for void while the shift is open
- `P`: cash total voided with PIN while the shift is open

Expected cash after these steps is `S + C + T + I - O - V - P`. A tab order
does not add cash until it is paid.

1. **Open shift.** Sign in as staff and open a shift with opening cash `S`.
   The shift opens and expected cash is `S`.
2. **Cash order.** Create a small cash order totaling `C`. It succeeds with an
   order number; expected cash increases by `C`.
3. **Tab order.** Create an order on the active customer tab. It succeeds with
   an order number and increases the customer's outstanding balance; expected
   cash does not change.
4. **Tab payment.** Record a tab payment of `T` in cash. The customer's balance
   decreases by `T`; expected cash increases by `T`.
5. **Cash in and out.** Record cash-in `I`, then cash-out `O`. Expected cash
   increases by `I`, then decreases by `O`.
6. **Void request and owner approval.** Submit a void request for a separate
   cash order of `V`. While it is `pending_void`, expected cash still includes
   `V`. Have the owner approve it before closing the shift; it becomes voided,
   expected cash decreases by `V` once, and tracked stock is restored once.
7. **Void with PIN.** Void another small cash order of `P` with the Admin PIN.
   It becomes voided, expected cash decreases by `P` once, and tracked stock is
   restored once.
8. **Close shift.** Count the till and close the shift. Its expected cash is
   `S + C + T + I - O - V - P`; with an exact count, the difference is zero.
9. **Z report.** Generate the Z report. It completes and excludes the voided
   orders from completed sales while reconciling the remaining sales, tab
   payment, and cash movements.

## Post-close void regression

On a separate low-value test shift, create a cash order, close the shift, then
submit and approve a void for that order. The closed shift's recalculated
expected cash must decrease by exactly that order's total, not twice that
amount. There must be exactly one matching `shift_void_adjustments` row.
