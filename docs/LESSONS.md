# Mr.Fund: lessons

### 2026-11-14: A card value that is not a decimal made every first-borrow chat turn fail as "unavailable"

- What happened: for an account with collateral and no debt, "Borrow 0.5 REF" always ended with "Mr.Fund can't talk right now" (4 of 4 live attempts) although the model gateway answered normally and the card itself was built. The owner suspected an exhausted API key.
- Root cause: the draft card's "Health factor before" is the text "No debt". `opening-tools` copied every card value into the number checker's sources, and the checker throws on a source that is not an exact decimal, so any reply that quoted a percentage or a plain number threw; the turn's catch turned that into the generic `unavailable`. Existing fixtures all had debt, so no test reached the case.
- Rule going forward: sources for the number checker are decimals only; a state such as "No debt" is a note. A test now drafts a first borrow and checks that every source is a decimal and that the quoted health is accepted. After the fix the same message returned a model answer with the card in 23 s.

### 2026-11-13: A function-call key whose allowance is below the prepaid gas cost is accepted by the RPC and never included

- What happened: the watcher operator signed `request_repay` with 300 Tgas using a function-call key with a 0.25 NEAR allowance. `send_tx` with `wait_until: NONE` returned success, but the transaction never appeared (`UNKNOWN_TRANSACTION`, key nonce unchanged) and the operator reported only `ambiguous`.
- Root cause: at the observed testnet gas price, 300 Tgas costs about 0.30 NEAR, above the allowance; a waiting send shows `AccessKeyNotEnoughAllowanceActionError`, a no-wait send does not. The operator also looks the hash up right after a no-wait broadcast, so even a good send first reports `ambiguous` until the transaction is final.
- Rule: give a scoped key an allowance well above prepaid gas times the current price (1 NEAR for this Guardian), and when a send is `ambiguous` inspect the key nonce and `tx` status by hash before anything else. Never re-send under the same journal; retire the key on chain (its unsent transaction can then never execute) and use a new key with a new journal.

### 2026-11-13: NEAR Connect sign-in needs the chooser inside the modal dialog and tolerates repeated accounts

- What happened: on `/play` the NEAR Connect wallet chooser was invisible, then visible but unclickable, and after a Meteor approval the login failed with the generic "Sign-in was not completed".
- Root cause: the SDK appends its chooser to `document.body`, but the wallet `<dialog>` is opened with `showModal()`, which paints above any z-index and makes everything outside it inert. Separately, Meteor returned the same testnet account six times without public keys, and the strict account validator rejects duplicates.
- Rule: move SDK popups into the open modal dialog during login (`liftPopupsToTopLayer`); collapse repeated account ids at the adapter boundary and keep the validator strict. Check hit-testing with `elementFromPoint`, not only a screenshot. A real Meteor sign-in end to end is still unverified.

### 2026-11-13: A guard retry repeats the violation unless the feedback names it

- What happened: every Indonesian glossary draft was rejected for "aman" ("safe"), and the one retry used the same word, so the turn fell back to the deterministic template.
- Root cause: the retry message only said "unsupported guarantee"; the model could not tell which word to drop. Separately, the number guard admits small integers as prose counts, so an invented "below 1" liquidation threshold passed it and only the independent review caught it.
- Rule: guard feedback names the matched word; localized banned words are listed in the persona. Treat the small-integer allowance as a known gap until the lead decides how thresholds are guarded.

### 2026-11-13: Watcher filesystem guarantees differ on Windows

- What happened: the Windows watcher suite exposed directory `fsync` failures and an unavailable `O_NOFOLLOW` flag; creating test symlinks also requires privileges on some Windows installations.
- Root cause: the journal's durable directory sync and the key loader's no-follow protection rely on POSIX filesystem behavior, not merely on the same Node APIs existing.
- Rule: fail closed when those guarantees are unavailable; exercise the POSIX behavior on Linux, macOS or WSL2 and identify Windows-only test skips explicitly.

### 2026-11-11: Rhea Borrow + exact Withdraw reverts on pools whose share price is not 1

- What happened: the first public Gate 1 borrow (`Borrow` 0.5 REF then `Withdraw` 0.5 REF) reverted with `Not enough asset balance`; the sandbox flow with the same shape had passed.
- Root cause: Rhea rounds shares down when crediting the borrow to `supplied` and up when withdrawing an exact amount, so on a pool with accrued interest the withdraw needs one more share than was credited. Sandbox pools were fresh and 1:1, which hid it.
- Rule: never pair `Borrow(x)` with `Withdraw(x)`; omit the `Withdraw` amount (or withdraw what the account view shows). Sandbox tests must include a pool whose share price is not 1. The Guardian's `owner_borrow` and `owner_withdraw_collateral` used the exact form; fixed 2026-11-13 (both now omit the `Withdraw` amount), reproduced first in the imported-0.11.0 sandbox with `guardian_accrued_*` tests (two failed with the live error before the fix, all pass after).

### 2026-11-11: Stopping the scheduler must also stop an in-progress read from submitting

- What happened: a watcher poll paused on a read could continue into `request_repay` after `stop()` cleared the timer.
- Root cause: stopping future ticks did not invalidate work already awaiting an RPC result.
- Rule: a stop generation invalidates pre-submission polls; a regression holds a read open, stops the watcher and verifies that no request is sent. An already submitted transaction still requires reconciliation.

### 2026-11-11: Scheduled watcher polls must fail closed on unexpected exceptions

- What happened: a malformed startup-evidence object caused `tick()` to reject outside the existing adapter error handling.
- Root cause: scheduled polls were started without a per-Guardian catch for unexpected exceptions.
- Rule: contain unexpected poll errors per Guardian, suppress raw exception data and lock requests read-only because the failure may have followed signing; the lifecycle regression exercises this path.

### 2026-11-11: Watcher SDK network identity and retry defaults require explicit handling

- What happened: inspecting `near-api-js` 7.4.0 showed that `getNetworkId()` caches the first result, access-key reads default to optimistic finality, and the JSON-RPC transport retries by default.
- Root cause: general-purpose SDK convenience behavior does not meet the watcher's fresh-network and no-blind-retransmission boundaries.
- Rule: verify the network using a fresh status request, inspect access permissions at finality `final`, and explicitly configure a single transport attempt before wiring any watcher broadcast. An ambiguous signed hash remains locked until reconciled; SDK defaults are not evidence that this occurred.

### 2026-11-10: Position locks hold amount zero; the status parser rejected them

- What happened: while building Guardian activation, a fixture with an in-flight `owner_register` made `readGuardian` fail with `bad_response`, so every Guardian read would fail during registration or sweep. Separately, ARCHITECTURE Flow 3 still described `create_guardian(label, policy, watcher_id)` and an access-key batch the factory never implemented.
- Root cause: `parseStatus` required a positive `in_flight.amount`, but the contract's `lock_position(0, …)` stores 0 for position operations. The architecture flow predated the archived factory ABI.
- Rule: parsers mirror every value the contract can actually store, checked against the Rust source, not only the repay path; a zero amount is valid only with no repay phase (regression test in `guardian-client/test/read.test.ts`). The contract and SMART-CONTRACT "Final ABI for the client" are authoritative; Flow 3 is corrected to them.

### 2026-11-10: Preserve recommendation intent independently of card validity

- What happened: independent review found that dismissing a zero-amount draft then asking about repay again lost the baseline's adjustment recovery card. A new DOM characterization failed on the missing Adjust amount action.
- Root cause: the port cutover opened recommendations only on a valid protocol Card event; baseline code opened the recommendation whenever comparison succeeded, including invalid drafts.
- Rule: represent recommendation intent with the existing progress/tool event independently of the validated card payload. Never manufacture an invalid executable Card to preserve a recovery surface. The new regression passes while existing tests remain unchanged.

### 2026-11-10: Validate non-collateral source timestamps before presentation

- What happened: a new negative case showed a future-dated supplied-token quote could appear in a successful position response while health ignored that non-collateral token.
- Root cause: engine freshness intentionally considers only risk-priced collateral/debt. A structured HTTP view also publishes non-collateral price context.
- Rule: preserve the engine's freshness scope, but reject every presented price timestamp beyond the same exported clock-skew tolerance; the failing presenter regression now passes without changing engine formulas.

### 2026-11-10: Clone nested shared snapshot fixtures before mutation

- What happened: a presenter negative test changed a shared asset's APR and contaminated the next freshness test, which then refused the mutated numeric field.
- Root cause: the existing engine fixture factory spreads overrides but reuses nested asset/price objects. Its snapshot object is new, its nested records are not.
- Rule: tests that mutate nested snapshot data must structured-clone the fixture first; the isolated presenter suite passes all eight cases.

Read the headlines before starting work. Record actual surprises only, never invented seed lessons. Newest entry first. Each entry uses `### 2026-11-08: Keep WebGL resolution stable during CSS layout motion

The portrait's ResizeObserver called renderer.setSize for every animated grid/viewport size change. That repeatedly reallocates the drawing buffer during the camera orbit; a second camera lerp also added a trailing stop. Keep projection responsive but defer buffer allocation until motion settles, and use one eased camera timeline. A 60-frame resize regression verifies one allocation during motion and one final commit. No browser FPS claim is implied.


### 2026-11-08: Parse JSX before applying automatic fixes

A programmatic JSX replacement left an extra closing tag. Running Biome with `--write` against that invalid tree applied unrelated partial fixes. Recovered the file and reapplied the bounded feature change, then checked parsing before formatting. After structural JSX edits, run the checker without writes first; resolve parse errors before allowing automatic fixes.

### 2026-11-08: Speech needs authored lip shapes, not just a gap

The Jungle Jim model has a closed face without speech shapes. Splitting its lip seam made a measurable opening but the user found the resulting motion unnatural. The Rocketbox trial retains its authored visemes instead, without replacing head topology. Validate model capabilities and user-visible articulation separately from geometry tests; a measured gap does not prove natural speech. Rocketbox also uses different bone axes, so walking leg rotations must use the actor's axis transformed into each bone's rest frame.

### 2026-11-07: Calibrate a seated desk against finger geometry

A table placed by appearance intersected the seated model's torso and hands. The table rear edge extended through the body, the top sat above the wrist/finger height, and source palms remained edge-on. Calibrate the back edge and height from the actual seated rig; rotate palms, account for finger thickness and keep the laptop out of their footprint. The CPU regression fails at the former 1.5175 table height and passes at the corrected pose/placement. Browser visual confirmation remains separate.

### 2026-11-07: arm swing must use the actor's axis, not bone-local X

The downloaded Businessman arm bones use local axes that differ from the actor's axes. Applying an X Euler offset after the resting arm rotation swung the hands sideways. The walking controller now converts the actor's left/right axis into each resting arm's coordinates, then applies the fore/aft swing about that calibrated axis. The arms move opposite their matching leg. A regression on the actual downloaded skeleton failed before the fix and passes for both forward-facing and 90°-turned actors.

### 2026-11-07: a safe's zero rotation is not its closed pose

The downloaded safe is authored with an open door and geometry baked relative to its hinge. Resetting local Z rotation to zero left the door open and made the entry animation close it. CPU checks on the original mesh identified -90° as the closed position: the door spans the cabinet front and its depth ends flush with the body. Calibrate hinge endpoints against actual geometry, then test the default, open and restored states rather than assuming zero means closed. The regression fails with the old zero-angle pose and passes at the calibrated angle.

### YYYY-MM-DD: headline`, followed by bullets: what happened, root cause with evidence, and the rule going forward. Update this file in the same commit as the related behavior change.

### 2026-11-07: floating decoration can block pointer access to wall tools

- What happened: the user reported missing Position and Activity hover feedback. The hit-test stopped at the first scene intersection, including decorative floating objects in front of interactive boards.
- Root cause: decorative geometry and real occluders shared the same pointer policy. A noninteractive first hit returned null before checking the board behind it.
- Rule: explicitly mark pointer-transparent decorations and share one target resolver between hover and click. Three regression tests cover decoration passthrough to both boards, genuine wall occlusion, nested prop surfaces and the character. Typecheck passed; browser inspection remains with the user.

### 2026-11-08: generation guards cannot undo wallet SDK side effects

- What happened: lifecycle review traced delayed connector sign-out and sign-in events that could clear a newer connection. Two controller regressions reproduced competing-operation failures before the fix.
- Root cause: the pinned connector removes its global selected-wallet after awaiting remote sign-out. Ignoring an old result does not undo that mutation; a sign-in event can also start a competing passive restore.
- Rule: reject competing interactive operations until login/logout settles, preserve the user's explicit popup gesture, and let interactive login read final accounts without event-driven restores superseding it. Keep generation guards for passive/disposal results.

### 2026-11-08: a browser dependency's sponsorship postinstall is not a required build

- What happened: adding the pinned Auth0 browser SDK installed its dependencies but pnpm failed with `ERR_PNPM_IGNORED_BUILDS` for `browser-tabs-lock@1.3.0`.
- Root cause: that package declares a postinstall which only prints sponsorship text; its published JavaScript needs no build. The connector also ships agent skills that this repository did not request.
- Rule: inspect the exact lifecycle script before making a package-specific permission decision. Explicitly deny the unnecessary script and unrequested skills; retain strict defaults. `pnpm install --frozen-lockfile` then completed without executing that script.

### 2026-11-08: a provenance guard must tokenize leading-decimal amounts

- What happened: final review found that `.99%` bypassed the numeric checker without any tool source. Eight regression cases reproduced the missing rejection, including an actual chat turn that emitted the unsupported rate.
- Root cause: the tokenizer required an initial digit and prevented matching digits immediately after a decimal separator, so leading-dot and leading-comma amounts disappeared from validation.
- Rule: parse leading decimals with the same exact-value, sign and unit rules as other numbers. Keep both lexical boundary tests and a consumer-visible no-emission regression; passing ordinary decimal examples does not establish coverage of numerical notation.

### 2026-11-08: a successful gateway response can contain null usage-detail objects

- What happened: the first real chat HTTP smoke reached NEAR AI but returned the sanitized unavailable response. The actual gateway returned `prompt_tokens_details: null`; the provider adapter only accepted absent or object-valued details. A regression reproduced the rejection, then passed after nullish optional metadata was accepted.
- Root cause: the scripted response fixture covered an object-valued cached-token breakdown, not the nullable shape observed from the gateway.
- Rule: exercise the actual provider protocol before declaring integration complete. Treat optional metadata separately from required response data, keep errors sanitized, and describe observed usage as incomplete when a request fails or is interrupted.

### 2026-11-07: a failed child creation is atomic, so the design's keyless failed child never exists

- What happened: the factory design assumed a failed initialization could leave a keyless, half-initialized child holding committed funds, and planned phase reporting around it. The sandbox experiment showed create-account, transfer, deploy and `new` in one batch revert together: no child survives, and the whole deposit returns to the factory (the batch receipt's predecessor), not to the owner.
- Root cause: the failure model was reasoned from multi-step creation instead of measured against the one-receipt batch that the protocol applies atomically.
- Rule: measure failure phases before designing recovery. The factory forwards the refund to the owner in a checked callback and keeps `claim_refund` for a failed forward. Re-measure if creation is ever split into separate receipts.

### 2026-11-07: a global-contract child was created and grew state with far too little balance

- What happened: in the pinned sandbox (2.14.0) a child using a global contract by hash was created with 0.00086 NEAR against 686 bytes of storage, then accepted a state-growing call. The same funding boundary for stored code held to the exact yocto.
- Root cause: unknown. The protocol's storage-stake check was not observed to bind for the global-contract child; the exact behavior on testnet is unverified.
- Rule: never let a contract rely on the runtime to refuse under-funding. The factory enforces its own funding bounds, and the global strategy stays unadopted until a testnet publish and use passes and the behavior is explained.

### 2026-11-07: near-sdk `#[private]` is not enforced when a unit test calls a callback directly

- What happened: a unit test expected a direct call to a factory callback by a foreign account to panic with "private"; it ran the body instead.
- Root cause: the `#[private]` check lives in the exported wrapper, which direct Rust calls skip. A `Promise` also schedules its receipt only when dropped, so a test that holds the returned value sees no receipt.
- Rule: prove privacy with a real sandbox call and look for the "private" failure text. Unit tests can only prove checks written in the method body. Drop the promise before reading receipts.

### 2026-11-07: deployed liquidation event fields differ across Rhea versions

- What happened: the sandbox health-evidence test found `old_discount: "0.0725"` on imported 0.16.2, but the same successful liquidation on 0.11.0 emitted no discount fields.
- Root cause: the published source and the newer deployment's event shape were assumed to describe both versions. The legacy raw event carries account ids, repaid/collateral sums and position only.
- Rule: validate event evidence against the observed version. Missing fields remain unknown; never manufacture scalar health from the very engine being compared. Preserve both versions' raw evidence and separately test deployed risk boundaries.

### 2026-11-06: a strict legacy repay amount fails when full debt rounds up

- What happened: review asked for the legacy full-repay dust boundary. A sandbox debt of 10000000000000000001 internal units failed when the atomic-ceiled repayment used strict `Repay.amount`; deployed testnet bytecode panicked in pool subtraction.
- Root cause: exact `amount` exceeded the real internal debt. Atomic rounding makes that a normal full-repay boundary, not merely an invalid user amount.
- Rule: use bounded `Repay.max_amount` on verified legacy Rhea. The regression now clears debt and checks the exact excess supplied balance. Do not infer debt reduction or refund from token acceptance alone.

### 2026-11-06: trigger gas burnt is not the continuation's available gas

- What happened: P0.4's read-only check burnt about 31 Tgas; the initial assertion described the difference from 300 Tgas as repayment margin. Independent review caught that branches and callbacks reserve gas separately.
- Root cause: total burn was treated as proof of continuation allocation without scheduling repayment after the callback.
- Rule: keep D27 open until a sandbox transaction composes check, repay and settlement with the intended budgets. Report read-only measurements separately.

### 2026-11-06: the deployed testnet Rhea rejects the repay message the docs and builders use

- What happened: the P0.3 sandbox deployed the actual testnet bytecode (`0.11.0`) and the probe's `"OnlyRepay"` transfer failed with `unknown variant`. The same message works on the mainnet bytecode (`0.16.2`). The docs, the Guardian spec and the TypeScript repay builders (P4.2, 389 tests) all assumed `OnlyRepay` everywhere.
- Root cause: the message was verified from published source `0.15.7` and mainnet behavior, but the network we would demo on runs an older deployed version. Source and one network's behavior are not evidence for another network.
- Rule: exercise every money-path encoding against the bytecode deployed on the network it will run on, and key encodings by Rhea version. Unit tests that assert bytes only prove the bytes are what we wrote.

### 2026-11-06: real RPC rate fields contradicted the APY-only engine interface

- What happened: P1.4 recorded testnet and mainnet views returning `supply_apr` and `borrow_apr`, while shared types and engine inputs were named APY.
- Root cause: the interface adopted a UI label before validating the integration payload. Relabelling live values would hide the rate convention mismatch.
- Rule: preserve protocol rate conventions and disclose estimation assumptions. Surface mismatches first; the user chose APR end to end (D30). Recorded fixtures and parsing tests now pin the actual payload.

### 2026-11-05: an independent review found the engine trusted its inputs and read a bad policy as "spend the maximum"

- What happened: a fresh-context review of the engine (P1.1 to P1.5, P3.3) found no arithmetic error but four Important gaps. A Guardian policy with `targetHfBps: 0` made `evaluateTrigger` treat the failed sizing as "target unreachable" and size the largest allowed repay. A fixed-price (`default_price`) position was never aged, so balances read hours ago were advised on as fresh. Negative balances, out-of-range ratios and fractional clocks reached `BigInt` and threw out of functions that promise a `Result`.
- Root cause: one error kind (`invalid_amount`) meant both "bad input" and "no solution", and the engine checked price age but not the age of the snapshot it was computed from. Validation lived in the contract spec, not in the code that mirrors it.
- Rule: validate policy, snapshot and clock at the engine boundary and return an error, never size from a malformed input. Give "no solution" its own error kind. Every freshness rule applies to the balances too, not only to prices. Ask for the independent review before UI and contracts depend on the engine.

### 2026-11-05: a formatter run over the whole repo rewrote the docs

- What happened: `biome check --write .` reformatted `CLAUDE.md` and every file in `docs/` (Markdown tables re-padded, 407 lines changed) while the intent was to format new TypeScript. The changes were reverted with `git checkout` because the files were clean before.
- Root cause: Biome 2.x includes Markdown in its default file set, and the first `biome.json` excluded paths instead of listing what to format.
- Rule: scope formatters and linters by allow-list (`apps/**`, `packages/**`, root config files), run `git status` after any `--write`, and never run a formatter over `docs/` or `CLAUDE.md`.

### 2026-11-04: Rhea repays only the caller's own debt, and deployed code differs from the published source

- What happened: the product brief assumed a Guardian contract could repay a user's existing Rhea loan. Source inspection showed `Repay` and `OnlyRepay` act only on the caller or token sender; no beneficiary field exists. Live `get_version` returned `0.11.0` on testnet and `0.16.2` on mainnet, while the only published source is `0.15.7`.
- Root cause: the protocol's permission model is "you act on your own account"; the brief's mechanism came from other chains' products (BRACE on Kamino), not from Rhea's interface. Version drift exists because Rhea publishes one `main` branch and deploys separately.
- Rule: before designing any flow that acts for a user on an external protocol, find the exact method, read who it acts on, and prove it on the deployed contract (BUILD-PLAN P0.3). Cite the source commit and the live `get_version` together; never treat source behavior as deployed behavior.
