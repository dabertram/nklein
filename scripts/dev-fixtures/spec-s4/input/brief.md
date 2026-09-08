# Basket Quoting Engine — behaviour brief

The quoting engine is being lifted out of the monolith. Two teams have written a candidate; both are in
`candidates/`. One of them is the implementation everyone has agreed is correct — that is `candidates/conforming/`,
and for the purposes of this work it is the **oracle**. The other is `candidates/nonconforming/`: it is a real
attempt by a real team, it looks right, and it breaks exactly one of the six rules below. Nobody has written down
which one, because nobody wrote the rules down precisely enough to tell.

That is the gap. The engine has been running for three years on six sentences and a shared understanding, and the
shared understanding is now demonstrably not shared.

## The interface

An order is `{ currency, lines: [{ sku, unitPriceMinor, quantity }] }`. All money is in **integer minor units** —
pence, not pounds — and no monetary value anywhere in this engine is ever fractional.

- `quote(order)` returns `{ subtotalMinor, discountMinor, shippingMinor, totalMinor }`.
- `validate(order)` returns `{ ok, errors }`, where `errors` is an array of `{ code, sku }`.

## The rules, by name

These six are what the business agreed, stated the way the business states them — which is to say loosely. Every
one of them hides at least one decision: a threshold that is either inclusive or exclusive, a rounding direction,
an order of operations. The prose does not settle those. **The oracle does.**

**R-01** The subtotal is what the lines add up to.

**R-02** A large enough basket earns a discount, as a percentage of the subtotal.

**R-03** The discount is capped: past a point, a bigger basket stops earning a bigger discount.

**R-04** Delivery is charged, unless the basket is big enough that it is not.

**R-05** The total is the subtotal, less the discount, plus delivery.

**R-06** An order with a non-positive quantity on any line is rejected, and the rejection carries a
machine-readable code rather than a sentence.

## Where the loose ends are

Not an exhaustive list — it is the list the last three arguments were about, so it is where a specification earns
its keep. Is the discount threshold met *at* the threshold or only above it? Does a discount of 10% of 4999 round
up, down, or to nearest? Is the cap applied before or after the free-delivery test — that is, does the free-delivery
comparison see the discounted figure or the raw subtotal? At what basket size does the cap actually start to bind,
and would a test built from a £30 basket ever notice it?

A specification that does not answer those is the situation we are already in.
