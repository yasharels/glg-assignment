# Task 4 — Order Cancellation Review

A retrospective on the work described in [DESIGN.md](./DESIGN.md): what shipped, how it was
verified, where the design turned out to be wrong, and what I would not defend as finished.

---

## 1. What shipped

`DELETE /api/orders/:orderId` cancels an order and emails the customer a cancellation notice.
Nine commits, 16 files, +248 / −47 against `main`.

| Area | Files |
| --- | --- |
| **API** | `OrdersController` (`deleteOrder` → `cancelOrder`), `OrdersRouter` (route moved to `/:orderId`), `OrdersDatabase` (`cancelOrder` added, `deleteOrder` removed) |
| **New pipeline stage** | `OrderCancellationInstance`, `InstanceType.ORDER_CANCELLER`, registry entry, `order-canceller` compose service |
| **Infrastructure** | `order-cancellation-queue` in `elasticmq.conf` with a DLQ binding, `SQS_ORDER_CANCELLATION_QUEUE_NAME` in `dev.env` |
| **Email** | `EmailService.sendCancellationEmail`, plus `getTransporter()` / `FROM_ADDRESS` extracted so both senders share one definition |
| **Shared types** | `CANCELLED` added to the pipeline's `OrderStatus`, `cancelledAt` added to both `Order` interfaces |
| **Race fix** | `OrdersDatabase.updateIfStatus` in the pipeline; `OrderProcessorInstance` now claims its receipt conditionally |
| **Incidental bug fixes** | `getOrderStatus` (both copies), `ExpressionAttributeNames` in `getOrders` |

The load-bearing idea is that cancellation is a **status transition, not a deletion**, which lets
the workers' pre-existing `status !== PROCESSING` guards stop in-flight processing for free — no
queue purging, no message deletion by receipt handle. The correctness guarantee is a **conditional
`UpdateItem`**: only the request whose write wins enqueues the email, so concurrent `DELETE`s
cannot produce two emails.

---

## 2. How it was verified

**There is no test framework in this repo** — neither `package.json` declares a test script or a
runner. Everything below is manual verification against the running stack, which is the honest
description of this work's assurance level.

| Instrument | Used for |
| --- | --- |
| `curl` → `localhost:9000` | status codes and response bodies |
| Mailhog HTTP API → `localhost:1080/api/v2/*` | that exactly one email exists, and its subject |
| `docker compose logs` | which branch each worker actually took |
| SQS query API via `docker exec` | queue depths and dead-letter accumulation (9324 is not published to the host) |
| `tsc --noEmit` | app *inside its container*, since `app/node_modules` is empty locally |
| Throwaway `ts-node` scripts via `docker exec` | driving the DB layer directly, to prove conditional writes without waiting to win a race |

Scenarios exercised end to end:

| Scenario | Result |
| --- | --- |
| Cancel after details, before receipt | 200; cancellation email in Mailhog; no receipt email |
| Cancel after receipt written | 200; `receipt discarded`; file gone from disk |
| Cancel before intake ran | 200; no email; `has no details, skipping` |
| Double cancel | 409 `ORDER_ALREADY_CANCELLED`; exactly one email total |
| Nonexistent order | 404 `ORDER_NOT_FOUND` |
| **Cancel an already-completed order** | 200; cancellation email sent; order carries both `completedAt` and `cancelledAt` |
| 6 concurrent `DELETE`s on a completed order | 1× 200, 5× 409; exactly one cancellation email |
| All five queues + DLQ | 0 messages; nothing dead-lettered |
| Uncancelled happy path | completes; receipt email with PDF attached; receipts dir empty |
| `?status=cancelled`, `?userId=` | filters correctly (both were broken before) |

### What I could not verify

- **The processor's discard branch has never been observed firing.** Rendering takes ~100ms, so
  from outside the system a cancel either lands before the processor reads the order (it bails at
  the existing status guard) or after the write completes. Across seven attempts at two timing
  strategies I never landed inside the window. That branch is covered by calling `updateIfStatus`
  directly against a cancelled order — proving the `false` return and the rejected write — plus
  the type checker. It is *not* covered by an observed end-to-end run.
- ~~Concurrency is argued, not demonstrated.~~ **Now demonstrated.** Six concurrent `DELETE`s
  against one order return `1× 200, 5× 409`, and Mailhog shows exactly one cancellation email.
  The counterfactual was measured too: the same six requests against a read-then-check-then-write
  implementation with no `ConditionExpression` produce **six** winners, i.e. six emails to the
  customer. That is the clearest statement of what the conditional write is for.
- **No from-scratch rebuild.** The queue, containers, and env were brought up incrementally. A
  clean `setup.sh` + `run.sh` on an empty machine has not been exercised.

---

## 3. Where the design was wrong

Recording these because they are the parts most worth discussing, not the parts I got right.

### 3.1 The orphaned-receipt mitigation only covered one ordering

[DESIGN.md](./DESIGN.md) §5 claimed the cancellation worker unlinking `receiptFilePath` was
sufficient. It is not. If the processor is **mid-render** when the cancel lands, it finishes,
writes the PDF, and sets `receiptFilePath` *after* the worker has already run and found nothing to
clean up. The emailer then correctly refuses to send, and the file is orphaned forever.

This leaked in the very first end-to-end scenario. The fix was `updateIfStatus`: the processor
claims its output conditionally and discards the file if the order has left `PROCESSING`. Both
orderings are now covered, because any successful claim must precede the cancellation, and the
worker always runs after it.

The lesson is not the bug — it is that the design reasoned about one interleaving and stopped.
End-to-end testing, not review, is what caught it.

### 3.2 The cancellability rule was far too narrow, and I had the evidence in front of me

The first version allowed cancellation only from `processing`, on the reasoning that cancelling a
`completed` order is a refund. Two problems. It reasoned about a payment subsystem that does not
exist — `completed` here means only that the receipt email was sent. And an order reaches
`completed` in about **3.5 seconds**, so the rule turned every cancellation into a race against
the pipeline: the natural way to exercise the endpoint — create an order, watch it finish, cancel
it — returned `409`.

What makes this the worst miss of the exercise is that I *observed* it and explained it away.
During step 9 a cancel returned `409` instead of `200`; I checked the timestamps, found a 3.5s
`createdAt` → `completedAt`, concluded "correct, I waited too long," and rewrote my own test to
poll-and-pounce so it would land inside the window. Writing a test that has to win a race to reach
the happy path is evidence about the design, not about the test. It took a reviewer asking
"shouldn't we be able to cancel a completed order?" to surface it.

The condition is now `#status <> :cancelled`. A pleasant side effect: the `409` has exactly one
meaning, so the re-read added in §3.3's discussion became dead weight and came out — the failure
path dropped from three round trips to two.

### 3.3 I recommended removing the controller's status pre-check on incomplete analysis

The pre-check was genuinely redundant for correctness, and removing it left one authority for
cancellability. But I presented that as costless, and it was not: the common 409 path went from
one Dynamo round trip to three. I also compressed a four-path comparison into a single number and
had to correct it when challenged. A third shape — attempt the conditional write first, read only
on failure — is cheaper on the happy path and never got raised until late.

The current shape is defensible on readability grounds. The efficiency case I made for it was the
weakest of the three options, and I made it twice.

### 3.4 The first cut of the race fix widened a shared method

I implemented the conditional write as an optional third argument to `OrdersDatabase.update`,
changing its signature and return type for the benefit of one of three callers, and leaving it
returning a `boolean` that means nothing when the argument is omitted. Reviewer preference for a
named `updateIfStatus` was correct: `update()` is now byte-identical to `main`, the conditional
variant's name announces at the call site that a decision is being made, and shared private
helpers keep the expression-building in one place.

### 3.5 My own checklist had an ordering flaw

Step 3 wired `OrderCancellationInstance` into the registry two steps before step 5 created the
class, which would have left the pipeline uncompilable between reviews. I deferred that one line
to step 5. Minor, but the checklist claimed each step "leaves the tree in a coherent state" and
one of them did not.

### 3.6 Step 8 needed a fix the design did not anticipate

Fixing `getOrderStatus` in isolation would have been a **regression**: `getOrders` builds
`#status` placeholders into its `FilterExpression` but never populated `ExpressionAttributeNames`,
so a filter that actually got applied threw a `ValidationException`. `?status=` would have gone
from silently ignored to a 500. (`?userId=` was already 500ing on `main` for this reason.)

---

## 4. Known limitations

Carried into `NOTES.md` as well, since that is the file the exercise asks for.

- **An order cancelled before intake gets no email.** Customer contact details are randomly
  generated by the intake worker rather than supplied by the client, so before intake runs there
  is genuinely no address. The worker logs a warning and skips. This is a data-model problem, and
  the same fix suggested for the `amount` inconsistency in task 3 — have the client supply what it
  knows at creation — resolves it.
- **A failure between the status flip and the SQS send leaves a cancelled order with no email.**
  The caller sees a 500. Doing this properly needs a transactional outbox or a sweeper over
  `cancelled` orders with no cancellation email recorded. Neither is built.
- **At-least-once delivery can duplicate the email** on redelivery. The existing receipt emailer
  makes the same trade-off; diverging only here seemed worse than matching the codebase.
- **Cancelling an `error` order would overwrite the failure signal.** Permitted by the
  `<> :cancelled` rule, but moot today: nothing ever writes `OrderStatus.ERROR`. The real fix is
  for `DeadLetterInstance` to record failures in the `dead-letters` table the schema already
  provisions, rather than keeping that signal in a field a user action can overwrite.
- **`?status=bogus` returns everything rather than 400.** Unknown values map to `undefined` and
  drop the filter. Unchanged from the original behaviour; tightening it is an API-contract
  decision beyond this task.
- **`DeadLetterInstance` is still an empty stub.** Out of scope, but it means a message that does
  dead-letter is silently lost rather than recorded.

---

## 5. What I would do next

In rough priority order:

1. **Tests.** The largest gap by far. Even a thin integration suite against the local stack would
   convert every table in §2 from prose into something that runs. The processor's discard branch
   in particular needs a seam — an injectable delay or a directly-driven worker — because it
   cannot be triggered from outside.
2. **Automate the concurrency check** — it has now been run by hand (§2) but nothing re-runs it.
3. **Outbox or sweeper** for the enqueue-after-commit gap in §4.
4. **Client-supplied customer details**, which closes the "no address before intake" hole and the
   task-3 `amount` inconsistency in one change.
5. **A verification script** in `bin/`, so the manual checks in §2 are reproducible by someone else
   without reconstructing them from this document.

---

## 6. Things worth knowing when reading the diff

- **`README.md` is deliberately untouched.** It still describes three pipeline stages and does not
  mention cancellation.
- **The README's ElasticMQ debug URL (`localhost:9325`) does not work** — it refuses connections
  even from inside the Docker network. Pre-existing and unrelated to this task, but it means the
  documented way to inspect queues is a dead end; use the SQS query API through a container.
- **The endpoint's behaviour changed, it was not merely added.** `DELETE /api/orders` with a body
  used to hard-delete a row. That route no longer exists, and `OrdersDatabase.deleteOrder` was
  removed with it.
- **`EmailService` gained two small extractions** (`getTransporter`, `FROM_ADDRESS`) that touch the
  existing receipt path. The receipt email body is byte-identical to before, including the six
  trailing spaces inside its template literal.
