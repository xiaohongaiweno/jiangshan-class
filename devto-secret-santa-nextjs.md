---
title: "Building a Secret Santa draw in Next.js: derangements, HMAC links, and not leaking emails"
published: false
tags: nextjs, security, webdev, typescript
---

Every December someone ships a Secret Santa app, and every December the same three things go wrong: the shuffle loops forever on a tricky exclusion list, the "private" assignment link contains the recipient's email in plain text, and the organizer dashboard quietly shows the whole pairing in a mode that was supposed to be blind.

I built one this year. These are the parts that were not obvious, with the code that ended up working.

## 1. A shuffle is not a draw

The obvious implementation is: shuffle the participant list, pair everyone with the next person, check the rules, retry if it fails.

```ts
// don't do this
do {
  names = shuffle(names)
} while (!isValid(names))
```

This has two problems. With a tight exclusion list (couples, families) the valid-permutation rate collapses and the loop runs for a long time. Worse, when **no** valid assignment exists it never terminates — you get a spinner and a support email.

A valid draw is a **perfect matching in a bipartite graph**: givers on one side, receivers on the other, an edge wherever an assignment is allowed (not yourself, not an excluded pair). So the draw is a graph problem, not a sorting problem.

I used Kuhn's augmenting-path algorithm over a randomized adjacency order:

```ts
const pairs: DrawPair[] = []

for (const giver of shuffle([...people])) {
  const receiver = findAugmentingPath(giver)
  if (!receiver) {
    throw new UnsolvableDrawError("No valid assignment exists for these exclusions")
  }
  pairs.push({ giver, receiver })
}
```

Three properties fall out of this for free:

- **It terminates.** O(V·E), instant at 100 participants.
- **Unsolvable input is *proven* unsolvable**, not "we gave up". Max matching < n is a fact you can report to the user instead of a stack trace.
- **It can never return a rule-violating result**, because invalid edges do not exist in the graph.

Randomness comes from shuffling the giver order plus each giver's candidate list, so repeated draws differ.

## 2. Use a CSPRNG, not `Math.random()`

The draw decides who buys a gift for whom. `Math.random()` is a seeded PRNG; anyone who can reconstruct the seed can reconstruct the assignment. Since the whole point is that it is not predictable, shuffle with `crypto.randomInt`:

```ts
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1) // unbiased, rejection sampling
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
```

`randomInt` is also unbiased, which `Math.floor(Math.random() * n)` is not.

## 3. No accounts means HMAC, not a token table

Requiring signup to find out who you are buying for is a conversion killer. But "no accounts" cannot mean "no auth" — the assignment link is the auth.

Stateless signed tokens, HMAC-SHA256:

```ts
export function signToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url")
  return `${body}.${sig}`
}
```

Two details worth copying:

```ts
const a = Buffer.from(sig)
const b = Buffer.from(expected)
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
```

Compare with `timingSafeEqual`, and check lengths first — it throws on mismatched lengths, which is its own denial-of-service if you let it bubble.

And keep the payload **minimal**. Mine looks like this:

```ts
type TokenPayload =
  | { t: "a"; x: string; p: string; g: number } // assignment: exchange + giver + generation
  | { t: "o"; x: string }                        // organizer manage link
  | { t: "j"; x: string }                        // join link
  | { t: "r"; x: string; p: string }             // remove-my-data link
```

Participant ids only. No names, no addresses, no recipient — definitely no email. A base64url payload is readable by anyone who copies the link; signing protects integrity, not confidentiality.

## 4. The generation counter is what makes redraw safe

This is the bug I would have shipped: organizer redraws, and every link sent five minutes ago now points at an assignment that no longer exists — or worse, still resolves to the *old* pairing because the token is still valid.

Assignments embed the draw generation:

```ts
{ t: "a", x: exchangeId, p: giverId, g: 3 }
```

Verification compares `g` against the exchange's current generation. Redraw bumps the counter and every previously issued assignment token becomes inert, without a revocation list or a cron sweep.

If you skip this, "reset the draw" silently means "two valid pairings coexist", and the person who opens the old link buys for the wrong person.

## 5. Centralize the visibility policy or it will leak

Secret Santa has a mode where the organizer should not see who drew whom. In practice the flag gets checked in the dashboard, then someone adds a CSV export and forgets, then a "resend email" button renders a recipient name, and blind mode is now fiction.

The fix is not discipline, it is one function that everything reads:

```ts
export function exchangePolicy(exchange: ExchangeFlags | null | undefined): ExchangePolicy {
  const blind = Boolean(exchange?.blind_mode)
  const deliveryMode = exchange?.delivery_mode === "link" ? "link" : "email"

  return {
    deliveryMode,
    blind,
    showPairings: !blind,
    canExportPairs: !blind,
    sendsEmail: deliveryMode === "email",
    canResendEmail: deliveryMode === "email" && !blind,
    showsPrivateLinks: deliveryMode === "link",
  }
}
```

The dashboard, the CSV export and the resend button all call `exchangePolicy()` rather than reading `blind_mode` themselves. A new page that forgets to check is a page that shows nothing, which fails in the safe direction.

One case that deserves an explicit refusal: blind mode plus link delivery is impossible. In link mode the organizer physically holds every assignment link, so calling the dashboard "blind" would be theatre. Better to reject the combination than to render a reassuring toggle that means nothing.

## 6. Never send the emails inside the request

A 50-person draw is 50 messages. Doing that inline means the organizer stares at a spinner, the route hits its timeout, and you have no idea which half went out.

Queue the sends and drain them from a cron route:

```
POST /api/manage/draw    →  compute pairs, persist, enqueue rows
GET  /api/cron/email-queue →  claim a batch, send, mark sent
```

The queue is also where the boring-but-essential parts live: per-address rate limiting, so one mistyped list cannot get your sending domain flagged, and a `resend` path that is idempotent per participant rather than per click.

## 7. Don't let the join endpoint enumerate

If participants add themselves through a shareable link, that endpoint is unauthenticated by design. Return a count and nothing else — not the names, not the emails, not even "email already registered" as a distinct error. Otherwise the join link doubles as a membership oracle for anyone who receives it.

## What I would tell past me

- Model the draw as a matching, and let an unsolvable input be an error you can explain.
- `Math.random()` is not random enough when there is money-shaped social pressure attached.
- A signed token guarantees the payload was not edited; it does nothing to hide it. Keep ids in it and nothing else.
- Bind assignment links to a draw generation, or "redraw" quietly creates two truths.
- Put every visibility rule behind one function. The bug is never the flag you thought about; it is the export button you added in March.

The draw is the fun part and the part that is easiest to get subtly wrong. If you are building one, the matching algorithm and the generation counter are where I would spend the first hour.
