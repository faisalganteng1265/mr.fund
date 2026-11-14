# Submission text and X posts

Copy-ready text for the hackathon form and for a free X account. Every claim below is backed by the repository: [README](../README.md) and [SMART-CONTRACT](technical/SMART-CONTRACT.md). Character counts were measured by script on 2026-11-14; X counts each link as 23 characters.

Banned words in all copy (CLAUDE.md): "never get liquidated", "guaranteed yield", "safe", "risk-free", "free borrowing". Say "reduces liquidation risk within limits you set".

## 1. "What did you build?" (form limit 20 to 2,000 characters; this is 1,231)

```text
The problem: borrowing on a lending protocol is easy to start and hard to understand while the loan is open. You see a health factor and a liquidation price, and you have to work out alone whether you are in danger and what to do.

What we built: Mr.Fund, a DeFi manager you can talk to. He reads your real Rhea lending position on NEAR and explains it in plain words, in your language. Every number comes from a tested finance engine: a reply that contains a number no tool returned is rejected, and the model has no tool that can sign. For automatic protection, a per-user Guardian contract holds the loan and a reserve and repays debt only inside limits you set: max per action, lifetime cap, reserve floor, trigger health and cooldown.

How NEAR fits: a factory creates one contract account per user with no access keys. The watcher signs with a function-call key limited to request_repay on one Guardian, so it cannot reach any owner method. Rhea is the lending protocol, NEAR Connect and Meteor sign, and NEAR AI Cloud serves the chat.

Proof on testnet: the watcher sent two accepted repays, and an over-limit request was refused on-chain. Limits: testnet only, fixed prices, unaudited, watcher started by hand (not hosted).
```

## 2. X post (free account: 280 characters, one video up to the free limit)

Attach the demo video. Recommended: the first post carries no link, the links go in the replies (section 3).

**Primary (proof first, 273 characters)**

```text
I built a DeFi manager you can talk to.

Mr.Fund explains your Rhea loan on @NEARProtocol in plain words. Numbers come from tested code, never the AI. A Guardian contract repays only inside your limits.

Testnet: the watcher repaid twice; an over-limit request was refused.
```

**Alternative B (hook first, 260 characters)**

```text
Your loan has a health factor. Your manager should have a face.

Meet Mr.Fund: ask about your @NEARProtocol Rhea position in plain words, and let a Guardian contract repay debt only inside the limits you wrote.

The AI talks. Code counts. The contract decides.
```

**Alternative C (problem first, 255 characters)**

```text
Liquidation risk is hard to read and hard to watch.

Mr.Fund talks you through your Rhea position on @NEARProtocol, then a Guardian contract acts only within limits you set. The AI explains; it can't sign and it can't invent a number.

Testnet demo below.
```

## 3. Replies under the post (each under 280 characters)

**Reply 1 (263 characters)**

```text
Three rules never bend:

1. The AI talks. It has no tool that signs.
2. Code decides numbers. A reply with a figure no tool returned is rejected.
3. The contract decides permissions. Automatic repays go only through the Guardian's request_repay, checked on-chain.
```

**Reply 2 (160 characters)**

```text
Proof on NEAR testnet:

Watcher repay #1: https://testnet.nearblocks.io/txns/8YXX7F6BTAKenTLXM3Wtdi4xVYGCopyW27LycTuZ2TPt
Watcher repay #2: https://testnet.nearblocks.io/txns/D9BprUfogm64pFQNZy6ffEHhUyDeHPC4wBJLJngdZZ9A
Over-limit request, refused: https://testnet.nearblocks.io/txns/2m5cxjPh458pAgQ8pMAubnRisFC2fDJTLSy8oX525Mqr
```

**Reply 3 (231 characters)**

```text
Honest limits: testnet only, fixed test prices, unaudited code, and the watcher was started by hand, not hosted. Mr.Fund reduces liquidation risk within limits you set; it doesn't prevent liquidation.

Code: https://github.com/0xlann/mr.fund
```

## 4. Before you post

- **The repository must be public** for the link to work. It is private today (the `0xlann/mr.fund` repo was not visible to another account). Making it public, posting and submitting need your explicit confirmation (CLAUDE.md, EVENT rules).
- **Video length.** A free X account may limit video length (about 2 minutes 20 seconds [I, not verified for 2026]). If the final film is longer, post a cut and put the full film in a reply or on a video host.
- **No official hackathon hashtag** was found in the event notes [U]. Add one only if the event page names it.
- **Nothing in the post claims** mainnet, cross-chain execution, uptime, a hosted watcher, private inference, or that liquidation is prevented. Keep it that way when you edit.
- **Check the proof links** still open before posting: they are testnet transactions on `testnet.nearblocks.io`.
