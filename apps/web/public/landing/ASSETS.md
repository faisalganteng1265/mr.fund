# Landing artwork

Created for Mr.Fund on 2026-11-08. Generated illustrations are decorative and do not represent real wallet data, performance, integrations or transaction receipts.

## Original generated PNGs

Generated with the image-generation tool, using a consistent friendly dark-haired, clean-shaven Mr.Fund mascot in a charcoal suit, white shirt and burgundy tie. The original prompts requested transparent backgrounds and solid sage, ivory and copper sculptural materials.

| File | Illustration |
| --- | --- |
| mr-fund-avatar.png | Mascot head/bust, used for illustrative identity and WebGL fallback |
| position-orbit.png | Mascot with an orbital portfolio composition |
| decision-route.png | A sculptural decision route |
| position-tokens.png | Token/position sculptures |
| plain-words.png | Conversational mascot and speech composition |
| guardian.png | Protective shield composition |
| languages.png | Multilingual conversation composition |

Feature originals are 1536 × 1024 transparent PNGs. Next/Image provides responsive image sizes and lazy delivery for offscreen illustrations. No third-party mascot/logo artwork was copied into these generated assets.

## Code-native textures

`grain-dark.svg`, `grain-light.svg` and `grid.svg` are original procedural dot/grain and line textures authored for this page. They contain no gradients.

## Actual live character and existing marks

The live 3D character is Microsoft Rocketbox Business Male 01, served from `/play/rocketbox/business-male-01.glb`; it is distinct from the generated illustrative mascot. Its MIT provenance, conversion details and third-party licence are recorded in [the existing play asset inventory](../play/ASSETS.md). Existing NEAR marks retain the provenance in that inventory.

## Design references

[Lusion](https://www.awwwards.com/sites/lusion), [Unseen Studio](https://www.awwwards.com/sites/unseen-studio), and user-supplied HeyElsa screenshots informed motion, card composition and the phone demonstration. [Paper Tiger](https://www.awwwards.com/sites/paper-tiger) and [Pangram Pangram by Locomotive](https://locomotive.ca/en/work/pangram-pangram-foundry) informed the later type/image hierarchy and editorial composition. No website source code, imagery or copy was extracted from them.

## Editorial type

`instrument-serif-italic.ttf` (71,592 bytes) is Instrument Serif Italic from [Google Fonts’ official repository](https://github.com/google/fonts/tree/main/ofl/instrumentserif), downloaded 2026-11-08. It is served locally with `next/font/local`. The original SIL Open Font License and copyright notice are retained in `instrument-serif-OFL.txt`. The font is unmodified.

## User-finalized video hero

The user-provided `../video/gemini_generated_video_92f34b13.mp4` and `../video/hero-poster.webp` are the final hero's local background media. Their original generation process was not independently verified. The live phone character remains the existing Rocketbox model; chat/navbar avatars use `mr-fund-avatar.png` above.

## Code-native feature diagrams

The “Less dashboard” feature grid now renders original HTML/SVG compositions from `src/landing/FeatureArtwork.tsx`, with independent GSAP colour reveals. It reuses only the generated `mr-fund-avatar.png` and the existing official NEAR/USDC token marks. The six full-scene PNGs above are not loaded by this feature grid; existing uses elsewhere remain. Chart traces and orbit sectors are decorative, not portfolio allocations or observed historical returns. Financial labels use the simulated deterministic engine fixture.

## Persistent walkthrough backdrop

`consultation-courtyard-cartoon.png` is an original image generated on 2026-11-09 for the six-step walkthrough. The prompt requested a dark courtyard and modern consultation pavilion with warm windows, quiet central space for UI, and no text, characters or interface. The selected version restyles the initial photographic concept into a polished cartoon 3D environment with rounded stone, simplified foliage and matte materials. It is an opaque static image, delivered responsively through Next/Image, and stays behind all changing desktop steps. The earlier photographic draft remains in the local generation archive and is not served by the project. It does not alter the user's hero media.

## Standing Mr.Fund ownership illustration

`mr-fund-standing.png`: original generated full-body cartoon illustration, 1024 × 1536 RGBA, created 2026-11-09 with the built-in imagegen tool. Identity reference: existing `mr-fund-avatar.png`. Displayed in `TrustSection` through responsive Next/Image. The source is an illustration, not a live 3D model; the existing character runtime is unchanged.

Generation prompt: “Create a NEW full-body standing 3D cartoon mascot illustration of exactly the same friendly professional man shown in the reference avatar. This is a brand asset cutout for a website. Preserve his identity: clean-shaven warm medium skin, large expressive brown eyes, thick dark eyebrows, swept sculpted dark brown hair, friendly slightly mischievous smile, charcoal suit with white shirt and burgundy red tie. Show him from hair to shoes with nothing cropped, in a relaxed confident standing pose with both feet on the same baseline, body slightly turned three-quarter toward the viewer, one hand open palm-up in a welcoming explanatory gesture at waist level and the other casually resting near his jacket. Charming polished animated-film 3D rendering, slightly oversized head, soft rounded shapes, tasteful detailed suit, black dress shoes. Adult financial companion, approachable and fun, professional without being stiff. Strong clean readable silhouette at small website sizes. Full figure occupies most of a tall portrait image with comfortable space around hands and shoes. Only this one character, no props held, no wallet, no key, no shield, no coins, no desk, no scenery, no lettering, no badge, no frame, no UI, no watermark. Genuine fully transparent alpha background. No white backdrop, no ground plane, no cast shadow outside the figure and no glow halo. Use crisp clean cutout edges.”

Final refinement prompt: “Background removal / precise cutout correction only. Preserve the complete standing cartoon man exactly: same face, hair, suit, pose, hands, shoes, scale and framing. Remove ALL the brown/grey atmospheric haze, glow and shadows around him, including behind his head and between arms/legs. All pixels outside his actual hair/clothes/skin/shoes silhouette must be completely transparent alpha 0. The character itself must be fully opaque, with only normal one-pixel antialiasing along silhouette edges. Deliver a clean isolated full-body character on genuine transparent background, like a professionally clipped mascot PNG. Do not add any backdrop, light bloom, rim-light haze, cast shadow, ground, logo or text. Do not restyle or redesign the character.”

Selected output: `exec-137c3cf0-caad-4f3e-9b87-f6473aed2895.png` in the local image-generation archive. The project copy is above; earlier variants stay outside the served assets.

## Closing garden with transparent sky

`footer-consultation-garden.png`: original generated 1774 × 887 RGBA illustration, created 2026-11-09 with the built-in imagegen tool. The foreground is a cartoon consultation studio, garden and path; the extracted sky has alpha 0 so the page background shows through. `ClosingFooter` uses responsive Next/Image delivery and a right-biased phone crop. The reference screenshot informs the centred closing composition only; its pixel/console style and brand were not retained.

Generation prompt: “Create an original panoramic 2:1 landscape background illustration for the closing call-to-action of a premium friendly finance website. This must be a polished stylized 3D CARTOON environment, like a charming mature animated-film set, matching a charcoal-suited cartoon financial companion and a nighttime modern garden villa. NOT pixel art, NOT voxel, NOT block art, NOT retro game graphics, NOT photorealistic. Scene: a beautiful contemporary consultation studio with sweeping softly rounded rooflines and warm timber/glass windows, seen across a tranquil landscaped terrace at night. The small inviting studio sits at the LOWER RIGHT edge; stylized broad-leaf trees and rounded garden landscaping frame the LOWER LEFT edge. A quiet curved stone path connects the foreground towards the studio. Sophisticated simplified geometry with rounded bevels, smooth matte materials, sculpted foliage and warm amber/ivory practical window light. Charcoal and midnight muted slate/forest tones, restrained sage accents. Atmospheric but crisp high-quality 3D cartoon illustration, softly modelled materials, no gritty noise. UPPER 65 PERCENT and CENTRE must remain broad calm very dark empty night sky for a large HTML heading and button; keep buildings, furniture and foliage in the lower quarter and outer edges. Beautiful restrained composition, not cluttered. No text, no logo, no UI, no buttons, no people, no mascot, no coin, no stock chart, no purple/violet, no neon, no pixelation, no square pixel stars. Opaque image. It is a decorative illustration only; do not render a website mockup.”

Final edit prompt: “Precise background extraction edit. Change ONLY the sky/background in this panoramic cartoon 3D garden illustration. Remove ALL dark blue night sky above the horizon and the visible sky between the left-hand branches/leaves, replacing those sky pixels with genuine fully transparent alpha 0. Keep the entire foreground garden, path, rocks, grass, lamps, large left tree including all its leaves and branches, the right-hand consultation pavilion and furniture, and the distant hills/treeline at the horizon. Preserve their exact shapes, positions, original colours, nighttime lighting and framing. Keep all actual scene objects opaque. Clean sharp natural cutout edges along roofline, tree leaves and distant hills; no blue/white fringe, no haze or semi-transparent ghost sky. Do not replace the removed sky with any colour, checkerboard, pattern or new backdrop. No text, no new objects, no redesign, no pixel art. Output same wide composition as a PNG with transparent sky, ready to composite over a website's dark solid background.”

Selected output: `exec-391a9222-e1fd-410a-a2c2-8d968c356869.png` in the local generation archive. Discarded style drafts are not served by the project.
