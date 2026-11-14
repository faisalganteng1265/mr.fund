# Mr.Fund: consultation demo design

## Scope and status

[I, implementation 2026-11-07] `/play` is a local UI demo on `feat/full-frontend`. The landing route `/` is documented separately below. The wallet, Rhea position, approvals, receipts and Guardian actions are explicitly simulated. No live Rhea read or wallet signing is implied. Financial values still come from the existing deterministic engine and bigint fixtures. Browser visual review remains with the user.

## Experience

Welcome is a full-bleed dark office with Mr.Fund standing beside the desk. It has no header, framed character card, marketing copy or secondary controls: only Start consultation is visible. The mock wallet dialog opens from that button; cancellation stays in the office.

On tablet/desktop after connection, a 4.8-second scene timeline walks Mr.Fund around the desk, turns him toward the visitor, lowers him into the chair and only then moves the camera into a close frontal consultation view. Distance-driven strides keep gait timing tied to movement. Panels stay inert until scene completion. The same renderer then contracts from the full viewport into the character column over 1.45 seconds; it is never remounted. Chat opens from the middle first, details follow 160ms later, and both use 700ms inset clips. Reduced motion skips the walk, orbit and panel waits. A labelled 3D fallback still allows access to the consultation.

On tablet/desktop the consultation focuses on a seated character and conversation. A bounded 3D portrait occupies the left area, the chat occupies the centre and the detail panel occupies the right on screens at least 1280px wide. The character is not a full-screen background. There is no room to explore, object picking, vault opening or walking. Position, Guardian and Activity share keyboard-accessible tabs; switching them keeps the conversation and draft intact. Voice opens from the composer as a review dialog on desktop. There is no desktop dock. Panel tops omit the decorative eyebrow/title strips; detail tabs lead directly into the content, and Clear conversation lives beside the voice control in the composer. Mobile tools retain a compact close control. Panel names remain available to screen readers.

Tablets from 768px use a character column and a tool column. Below 768px, the selected tool fills the area between a compact header and the bottom dock, without a portrait row or framed panel. Chat places the live standing Mr.Fund on a transparent full-viewport scene at the left; bubbles and starting questions sit to his right on the shared charcoal dot texture. Position, Guardian, Activity and Voice use the same full tool area. The dock remains visible while switching tools and while the keyboard is open. Keyboard-aware viewport height keeps the composer above the dock; the character hides while typing to prioritise text. Phone portrait is supported and session state is preserved. The desktop seated layout remains unchanged.

## Appearance and typography

The user explicitly rejected Linear as a visual reference. Product references researched are Replika for character presence, Cleo for approachable financial conversation, and HeyElsa for conversational DeFi. These are references for interaction, not claims of equivalent functionality. Later user feedback retained the consultation layout while requesting neutral colours, a desk/laptop, blurred welcome and token-list pills.

All panels, cards and buttons use solid fills. No CSS gradients, glass panels or decorative box shadows. Thin borders and distinct flat surface colours provide separation. The welcome office fills the viewport. Actual 3D materials retain physical lighting and shading.

| Role | Colour |
| --- | --- |
| Page | `#0c0c10` |
| Primary surfaces | `#121416` / `#17191b` |
| Raised controls and asset pills | `#242729` |
| Character backdrop | `#222426` |
| Primary action | `#d3e5d7` |
| Warm identity accent | `#e4d7ba` |
| Health / positive emphasis | `#d7f8a4` |

Body text uses **Manrope** (200–800); display text uses **Space Grotesk** (300–700), both locally hosted variable fonts from Google Fonts with SIL Open Font License texts. Financial values use tabular numerals. Instrument Sans and Bricolage remain inactive source assets. New font provenance is in `public/play/ASSETS.md`.

All authored styling uses Tailwind utilities and utility recipes. `tailwind.css` contains Tailwind imports/layers only. No global preflight is introduced onto the landing page.

## Character and desk

The active trial model is Microsoft Rocketbox **Business Male 01**, MIT, wearing a dark suit and red tie. The 1,292,448-byte GLB has 7,435 triangles, the original 80-joint skeleton with normalized body bone names, 15 speech visemes and seven expression/blink shapes. Colour maps are reduced to 1024px (512px alpha hair); unused shapes, animation clips, normal/specular maps and source FBX metadata are omitted. Existing procedural seated motion, breathing, head response and greeting wave drive the retained body rig. The renderer loads only the character GLB. The dark room, table, chair, laptop, mug, window, shelves, books, plant and practical lamp are lightweight procedural geometry. Downloaded furniture GLBs and the old room renderer remain inactive. Warm practical lighting and a cool night window retain the neutral dark theme.

The model is normalized to 3.9 world units and seated with hips at 1.05. The table top is 1.29, its rear edge is z=0.45, and the laptop is moved left, scaled to 0.78. Palms are rotated into a desk-resting pose. Geometry placement is calibrated against actual downloaded-rig bones; the regression verifies fingers stay above the desk and outside the laptop footprint during idle motion. This is CPU spatial verification, not browser visual approval.

The face uses Rocketbox's artist-authored visemes, brow, blink and smile shapes. No runtime lip cutting or artificial mouth interior remains. Restrained, damped viseme blending is driven by a text-based sound approximation and browser word-boundary events where available. This is not phoneme-timed audio lip-sync; visual naturalness remains subject to user review. Mood remains engine-derived. Welcome now uses the standing pose; the earlier typing pose remains a supported rig pose but is not the entry animation. Spoken scripted replies use browser speech synthesis by default when available; speech start/end/error events control the speaking state, and a visible mute button is available. Replies wait two seconds in a thinking state, then reveal text progressively inside an isolated text component. Speaking remains active until both text reveal and available browser speech finish. Clearing the conversation cancels pending replies. Without speech support, the text reveal controls visual speech duration. No live LLM is connected.

Reduced motion stops cyclical mouth/body movement and camera glides. The renderer is bounded to its portrait area, caps pixel ratio, pauses offscreen and disposes models, geometry, materials, skeletons, textures and renderer resources on unmount. Fallback is explicitly labelled when 3D cannot load.

## Position and actions

Position health leads the panel. NEAR collateral and USDC debt use compact rounded token pills inspired by the user's reference: token icon/name on the left and a value badge on the right. Only existing fixture assets appear. Price history and returns are unavailable, so no invented PnL percentage or fabricated market sparkline is shown; the centre line is a dashed placeholder. Collateral quantities, liquidation estimate, APR and provenance remain visible.

The existing engine-driven repay-versus-yield comparison, what-if scenario, adjustment, mock approval/rejection/failure/partial outcome, receipt, refresh and stale-data refusal remain available. Guardian setup uses shared policy validation and separates the Guardian-held loan from the wallet loan. Reserve limits, pause/resume, withdrawals, trigger replays and rejected attempts remain labelled simulations. Browser microphone input is explicit; transcripts are reviewed before sending and speaking never authorizes a transaction. Enter sends a chat question, Shift+Enter adds a line and IME composition is respected.

Custody, network, pricing and production renderer decisions remain governed by their existing OPEN-DECISIONS entries. No UI simulation proves contract enforcement or live availability.


## Consultation module map — 2026-11-10

Live consultation uses the existing room and panel layout. `useLiveConsultation` owns account-scoped chat history and cancellation; `LivePanels` renders the live position and card without demo fixtures. `source/livePosition.ts` reads `/api/position`, validates account/network, expires data without polling, and exposes loading, empty, mismatch, stale and unavailable states. `source/liveChat.ts` consumes the chat SSE stream; HTTP 400, 429, unavailable and interrupted responses map to recoverable messages with the question restored. The server-provided card is read-only: Execute remains disabled until wallet execution is implemented. This describes local implementation, not a real-wallet or public-network proof.

[V, local implementation and checks] The source refactor preserves the existing consultation layout, copy, styles, focus sequence and CharacterPortrait dynamic loading. It changes where state lives, not what the product claims to execute.

### Composition roots

- `app/play/page.tsx` selects the serializable `source="demo"` mode.
- `play/PlayViewport.tsx` owns the selected client source and preserves the existing `ssr: false` dynamic playground.
- `play/Playground.tsx` composes scene, responsive layout, panels and dialogs from the hook view model. Its optional source has a lazy demo default for the unchanged no-prop regression entry.
- The landing route imports no module from `play/source/`; its existing labelled illustrative figures remain separate.

### Capability and state ownership

| Module | Responsibility |
| --- | --- |
| `play/source/types.ts` | Five typed ports, independent provenance, cached subscription snapshots and opaque approvals; shared snapshot/card/receipt contracts are reused |
| `play/source/demoSource.ts` | One in-memory source per consultation; composes the five simulated adapters |
| `play/source/demoSession.ts` | Mock connection and available wallet balance |
| `play/source/demoPosition.ts` | Fixture debt, data state, financial display figures and engine advice |
| `play/source/demoChat.ts` | Existing scripted replies as progress/text/card/error/done-compatible events, cancelled with AbortSignal |
| `play/source/demoExecution.ts` | Opaque approval settlement, four outcomes, receipts and last-repay transition |
| `play/source/demoGuardian.ts` | Policy validation, lifecycle, reserve, separate protected debt, owner controls and bounded replay |
| `play/useConsultation.ts` | Port subscriptions and user intents; draft, transcript, entrance/focus, speech and reveal coordination |
| `play/display.ts` | Neutral bigint amount/percentage formatting, without importing fixtures |
| `play/ProvenanceTag.tsx` | Existing authored simulation labels, independent for mixed ports; invalid simulated label text is rejected |

### Focused presentation

- `WalletDialog` renders session state and connection/disconnection intents.
- `ChatPanel` composes `ChatMessages`, `RecommendationCard` and `ChatComposer`; no financial setter crosses into these modules.
- `PositionPanel` renders position-port figures and refresh/explanation intents; the obsolete `PositionSummary` export/path was removed.
- `GuardianPanel` composes `GuardianDetails`; `GuardianSetupDialog` and `PolicyField` render only the editable draft/review.
- `ActivityPanel` lists source-owned receipts; `ReceiptDetail` renders selection details and activity navigation.
- `ApprovalDialog`, `SettingsDialog`, `HelpDialog` and shared `ModalFrame` keep outcome controls, settings and native dialog focus behavior separate from scene composition.

### Observed evidence and limits

[V] Baseline 936 tests passed with 3 skipped; final full suite 979 passed with 3 skipped. Typecheck, Biome (240 files) and production build passed. Independent review found no remaining issues after regression-tested corrections to invalid-draft recovery, mixed-label semantics, timer cleanup and streamed-card identity binding. Existing tests were not edited. All twelve desktop/360 px key-panel text captures matched; mobile chat was captured at the same progressive-reveal phase as the baseline. Evidence stays in ignored `scratch/`, not in shipped assets.

[V] A managed Chromium `next dev` run completed connect, scripted ask, simulated repay, Guardian activation, over-limit rejection with unchanged reserve and deactivation. These were local UI/domain effects, not wallet signatures or chain transactions.

[U] Visual polish, performance and real-wallet/live-source correctness were not assessed. The pre-existing unlabelled chat/mobile simulation surfaces were deliberately not changed; task 5.1 of `refactor-consultation-data-source` defers visible labels to `add-live-wallet-session-ui` task 2.1. This is an explicit honesty gap, not permission to present fixtures as live.

## Verification

Verification evidence is recorded in BUILD-PLAN as local demo progress. Browser visual QA remains with the user. Asset attribution and licenses are recorded in `public/play/ASSETS.md` and linked from How it works.

### Entrance rendering refinement — 2026-11-08

The CSS portrait may resize throughout the entrance, but its WebGL drawing buffer stays at its original resolution during the orbit and panel reveals. Camera projection still follows the actual element aspect. A queued final buffer size is committed after layout has settled and the panel transitions have finished; ordinary window resizing also waits for a 120ms quiet period. The regression simulates 60 animated layout updates and verifies only the initial and final buffer allocations. This verifies allocation behaviour, not measured browser FPS.

Panel clips now use plain rectangular insets with the panel's own rounded corners, paint containment and an explicit compositing hint. A gentler easing replaces the former abrupt opening. Motion remains disabled for reduced-motion users. Browser visual QA remains with the user.

### Raised wall branding — 2026-11-08

`mr.fund` is actual bevelled, extruded Space Grotesk lettering on the inner left wall, facing into the room. It has cream front faces, darker edge materials and casts a shadow; there is no plaque or box behind it. The glyph subset is generated from the already licensed Space Grotesk variable font at weight 700 by `scripts/build-wordmark-font.py`. A geometry test verifies its left-wall position, orientation, width and nonzero depth.

### Chat bubble refinement — 2026-11-08

The conversation follows the user-supplied messenger reference while keeping existing panel grid dimensions and the solid charcoal/sage/beige palette. Messages sit toward the bottom when the transcript is short. Mr.Fund uses a small beige brand avatar and charcoal bubbles with a softened lower corner; user bubbles align right in the existing sage accent. Repeated visible speaker labels are removed but remain accessible. Starting questions use compact outline chips; thinking is a three-dot bubble. A compact pill composer grows for multiline text and retains clear, voice and send controls. Progressive text, mock financial cards and all transaction permission boundaries remain unchanged. No invented timestamps, audio recordings or read receipts are shown.

The chat panel has a small centred `mr.fund` name at the top, without the former title strip, eyebrow or divider.

The chat background repeats a lightweight, project-authored SVG dot texture in low-opacity beige/sage over the same solid charcoal base. Bubbles and composer remain opaque for legibility; no gradient, animation or panel size change is introduced.

Position uses the same dot texture across its panel background on desktop and mobile; health, token and other content cards retain their solid fills.

Header position stats use 14px labels, 16px semibold values and a 12px simulation/PnL note. The note wraps below the pair on narrower desktops; the optional brand tagline appears only on wider desktops to leave space for the larger stats.

Position keeps “Talk me through it” in a fixed panel footer without a separator or the repeated illustrative-input paragraph. Only position metrics/content scroll; the action stays at the panel bottom on desktop and mobile.

The repeated “You approve every move” demo-chat footer below the composer is removed at the user’s request. Existing simulation labels and explanatory help remain elsewhere.

The compact “Simulated · Fresh snapshot” label above the position health card is removed at the user’s request. Refresh is placed inside the Position health card beside the protocol label; the separate toolbar above it is removed.

The mock-wallet dialog displays official Meteor, Intear and NEAR marks beside their names in its future-wallet row. Assets are local; those brands remain informational, with only Demo wallet offering a connection.

### Wallet access layout — 2026-11-08

The wallet dialog uses a dedicated 500px maximum-width treatment with responsive single-line display typography, a compact simulated-network indicator and a sage access card as the primary Demo wallet action. The card has asymmetric icon/edition and title/arrow rows, with honest pending state and an explicit accessible connection label. Future wallet marks sit in an open three-column row at 40px, with names below; no plate, circle, border or box surrounds them. NEAR's existing black symbol is inverted to white for dark-background contrast; source SVGs are unchanged. Other dialogs keep their existing layout.

All shared toast notifications appear at the top right, with 16px/safe-area insets and a 420px maximum width clamped to the viewport. Inline field validation remains next to its field.

Toast styling uses a compact charcoal card with a subtle border, sage information icon, Mr.Fund sender label, readable 13px message text, and an independent close control. The neutral icon avoids marking failures or cancellations as successful. Entry is a short fade/slide respecting reduced motion; existing dismissal and auto-hide timing remain unchanged.

The wallet dialog repeats the same low-opacity SVG dot texture as the consultation panels. Its title scales from 24px to 38px to keep “Connect to begin.” on one line, with room for the close control.

### Guardian card refinement — 2026-11-08

Guardian now matches the Position card’s solid charcoal surface and restrained sage accents. Removed the large tilted shield, spark, green background, section index and older promotional treatment. The card shows a small shield/name, configuration-state badge, shorter title and description, two plain policy/control rows, and a full-width sage setup action. Active policy states retain existing deterministic values and controls, with neutral borders, readable labels and pill actions. No policy, permissions, fee, reserve or transaction behavior was changed.

### Detail tab content motion — 2026-11-08

Opening Position, Guardian or Activity starts a top-to-bottom content cascade: sections translate down from 12px above and fade in over 400ms, with 45ms stagger steps capped at 225ms. Keyed content mounts replay the animation when the selected tool changes or the consultation first becomes visible, without changing the outer panel, renderer or stored tool state. Position’s fixed footer remains outside its scroll body. Tailwind starting-style utilities implement all motion without a runtime animation dependency; reduced motion disables transitions. Rapid switches replace the selected content immediately without queued exit animations.

### Standing phone composition — 2026-11-08

On phones, the original welcome remains a dark office. After mock connection a 1.1-second camera transition keeps the character standing, places him at the left of the conversation, and hides the room/desk/chair in favour of the shared flat dark texture. The same renderer and GLB stay mounted; standing breathing, head response, wave and facial speech continue. A pure framing function keeps head/feet in view at representative phone ratios and above the composer/dock area. Other tools hide the character scene and occupy the full available panel area. Desktop/tablet retain the seated office consultation.

## Landing page

[I, implementation 2026-11-08] `/` is an animated public landing page in `apps/web/src/landing/`. The user explicitly requested a redesign, superseding the earlier landing freeze. References are [Lusion](https://www.awwwards.com/sites/lusion) for a dominant 3D hero and scroll composition, [Unseen Studio](https://www.awwwards.com/sites/unseen-studio) for transitions/storytelling, and the supplied HeyElsa screenshots for illustrated bento features and a phone demonstration. The follow-up composition also references [Paper Tiger](https://www.awwwards.com/sites/paper-tiger) for bold type/image hierarchy and [Locomotive’s Pangram Pangram case study](https://locomotive.ca/en/work/pangram-pangram-foundry) for editorial product presentation. References inform the composition; their code and artwork are not copied.

[I, 2026-11-08] At the user's request the hero now follows the HeyElsa hero layout: a full-bleed looping background video (`public/video/`, poster `hero-poster.webp`) under a solid dark overlay and the grid texture, with the eyebrow, the headline "The DeFi manager you can talk to.", one sentence of copy, Start consultation, a "Simulated demo, mock wallet" note and a "Built on NEAR · Rhea lending" row on the left. On the right is a tall chat panel (`HeroChat`) that reveals the three scripted exchanges one message at a time. The video pauses with the motion toggle and for reduced motion. `ConversationPreview` (character in an arch) is no longer rendered in the hero. A speech-corner `m.` monogram, ruled section indexes and Space Grotesk paired with locally hosted Instrument Serif Italic provide a consistent identity. Guardian presents its illustration as a policy sheet, and the closing section uses a large editorial invitation with a prominent consultation action. The six feature cards use uniform dark backgrounds and equal-width columns: one on phones, two on tablets and three on wide desktops. Their current illustrations are native HTML/SVG diagrams around the generated Mr.Fund avatar and existing official token marks, rather than flattened generated scenes. A three-step consultation journey stacks cards as the reader scrolls. Alternating charcoal, sage and ivory sections reveal the phone experience, Guardian principles and the final consultation action. Repeated explanatory copy and the FAQ were removed. Content surfaces use solid Tailwind fills and original SVG grain/grid textures. The final hero/navigation use masks for the chat fade and circular navbar notch; compact labels follow the user-finalized hero.

GSAP ScrollTrigger drives hero pinning, typography parallax, staggered card entries, floating illustrations, a marquee, curtain reveals, scroll progress and the three-card stack. Lenis uses the GSAP ticker as its single scroll clock. Pinning applies only at widths of at least 1024px and heights of at least 760px; the hero additionally requires enough viewport height to fit the entire pinned stage plus navigation clearance; smaller displays retain normal vertical document flow. The shared motion toggle releases the scroll engine and restores the static layout. OS reduced motion skips it entirely. Context cleanup removes owned triggers, pins, listeners and ticker callbacks on route exit. Loops pause offscreen or while the document is hidden.

The phone and retained standalone `ConversationPreview` use the actual existing MIT Rocketbox GLB, its native facial shapes and approximate text-driven speech cues; the final hero uses the local video instead. The phone retains a standing live character and chat only, without the product dock or other tools. Shared `play/chatAppearance.tsx` supplies the same bubble/composer appearance as `/play`; its existing finance and interaction logic remains unchanged. The lightweight landing renderer omits the office scene, pauses drawing offscreen, and caps seated rendering at 40fps/DPR 1.5 and standing phone rendering at 24fps/DPR 1.15. These are configured ceilings, not measured browser performance. A labelled fallback covers unavailable WebGL.

Scripted questions cycle through thinking, progressive text and speaking. Three keyboard-accessible topic buttons select the position, comparison or market-dip example, with a two-second thinking interval and a fresh text reveal. Switching a topic cancels the previous phase and browser utterance; progression resets on automatic loops as well. On small phones the hero conversation follows the character in document flow to preserve face visibility. Browser speech is optional and starts only after user activation. These previews do not call an LLM, Rhea, a wallet or a signing service. Every financial figure comes from `landingFigures()`, using the deterministic engine and the same bigint fixture as `/play`; visible figures retain simulation labels. Generated artwork provenance and the existing character credit are recorded in `apps/web/public/landing/ASSETS.md`. Responsive Next/Image delivery serves the illustrations.

Verification covers deterministic figures, pause/resume and reduced motion, the phone's actual character props, and real GSAP/Lenis initialization and disposal in both desktop and smaller-screen branches. Browser visual review remains with the user, as requested.

[I, final hero checkpoint 2026-11-08] The user finalized the video hero and requested only small subsequent refinements: Mr.Fund's generated mascot replaces the chat's brand-letter avatar and the centred navigation monogram; user chat messages omit avatars. The floating split navbar is capped at 820px, with tighter menu spacing, a 54px transparent circular cut around the 84px centre badge, a grey 75%-opacity fill and a thin border. The navbar pause button is removed; reduced-motion handling remains. This checkpoint preserves the user's hero layout.

[I, feature artwork refinement 2026-11-08] The “Less dashboard” section uses `FeatureArtwork.tsx`: a segmented position orbit, repay/supply comparison, token rows, plain-language conversation, Guardian shield and multilingual bubbles. Only the small Mr.Fund mascot and token marks are image assets. Paths, rings, cards, labels, chart traces, shields and bubbles are code-native elements. GSAP sequences colour-overlay opacity and individual elements while a card is visible; document hiding, reduced motion and animation cleanup retain the existing lifecycle controls. Diagrams are illustrative; visible amounts come from `landingFigures()` and are labelled simulated. No new integration or performance history is implied. The finalized hero is outside this change.

[I, feature grid checkpoint 2026-11-08] The current feature grid has equal-width square-corner cards with solid neutral charcoal fills. Repeating motion keeps panel/bubble backgrounds opaque; the illustration sequence runs at 1.7× speed. Guardian's feature illustration is now a compact policy preview with the mascot, reserve and repayment-limit rows, replacing the oversized shield motif. The current landing section order is hero, marquee, features, Guardian, closing and footer: the workspace's phone preview and stacked walkthrough sections have been removed. Earlier descriptions above record the preceding iterations.

[I, 2026-11-09 checkpoint] The feature eyebrow is removed and “Less dashboard. More understanding.” is a single responsive line. The current workspace adds `HowItWorks` after features: six steps (Ask, Read, Explain, Recommend, Decide, Receipt), a sticky scroll-driven desktop stage, and stacked scenes below 1024px. Navigation/footer How it works links point to `#how`. Its examples use engine-derived fixture values and explicitly disclose the simulated wallet/position and unfinished live integrations.

[I, walkthrough backdrop 2026-11-09] The right-hand walkthrough panel now uses one persistent generated cartoon courtyard image, `consultation-courtyard-cartoon.png`, via `ConsultationBackdrop`. The image sits outside the keyed scene layers, so only step components transition; the scene background stays fixed. It is the same visual across mobile step previews. It has no CSS gradient, transparent overlay, video or WebGL renderer. The right-panel Step/Simulated header and large decorative rolling numbers are removed; left-side step navigation and the existing simulation disclosure remain. The hero is unchanged.

[I, ownership section 2026-11-09] “Your keys. Your signature.” now pairs a generated full-body standing cartoon Mr.Fund with an asymmetric charcoal poster, ivory note, coral action and five compact charcoal permission cards. Each card uses a consistent unboxed line icon; opening it reveals a short explanation. This replaces the concentric trust rings and long descriptions while keeping the five key/wallet/Guardian/engine/AI boundaries, keyboard controls and existing readiness/prior-art statements. All panel backgrounds are opaque solid fills. The mascot is a responsive PNG illustration with subtle offscreen-aware floating, not another WebGL renderer. The user's hero remains unchanged.

[I, closing/footer 2026-11-09] The closing invitation and footer now form one `ClosingFooter`: a centred Space Grotesk/Instrument Serif heading, consultation action and original panoramic cartoon garden artwork. The user rejected a literal pixel-console interpretation; the selected illustration keeps the Mr.Fund cartoon architectural theme, with its sky extracted to alpha so the shared page grid shows through. Mobile uses a shorter art layer and a right-biased crop to retain the studio; navigation and credits stack below. The artwork has restrained scroll parallax, scoped cleanup and reduced-motion handling. No new pixel font, CSS gradient, sky overlay, video or WebGL renderer is used. The user's hero is unchanged. The user also removed the TrustSection footer paragraph; the Guardian card retains its development status.
