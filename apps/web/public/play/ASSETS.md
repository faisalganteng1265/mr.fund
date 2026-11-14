# Playground asset provenance

## Archived character trial: Jake by Canino 3D

Source: https://www.turbosquid.com/3d-models/game-stylized-cartoon-man-3d-model-3d-model-2135257
Author: Canino 3D. Listed as free under the TurboSquid Standard License.
The user temporarily tried the source FBX, then requested a return to Jungle Jim on 2026-11-07 because of loading time. The FBX is no longer present. The unused controller, fixture-dependent tests and author preview are archived in local, ignored `scratch/inactive-jake/`, not shipped by the app.

## User-selected office furnishings

- `public/office table/office_desk.glb`: **Office desk**, Narr.yworld, https://sketchfab.com/3d-models/office-desk-8b5bb3e1f9804ac7ab701fe2ce1c2018, CC BY 4.0. Runtime rotation and proportional scale/placement.
- `public/office chair/office_chair.glb`: **Office chair**, Pricey1600, https://sketchfab.com/3d-models/office-chair-95160ce5a52f4e379f66527d2735d96c, CC BY-NC 4.0. Local noncommercial preview only. Runtime proportional scale/placement.
- `public/brankas/simple_safe.glb`: **Simple safe**, avhatar, https://sketchfab.com/3d-models/simple-safe-2e308cb3fe1d4676beb43e75fdd27e8e, CC BY 4.0. Runtime proportional scale/placement, Guardian surface lettering and status lamp. The source door is posed open; the runtime closes it at a -90° local Z hinge angle by default, then animates it outward for Guardian entry.

CC BY: https://creativecommons.org/licenses/by/4.0/
CC BY-NC: https://creativecommons.org/licenses/by-nc/4.0/

## Previous character: Businessman (Rigged) by Jungle Jim

Source: https://sketchfab.com/3d-models/businessman-rigged-8933d61fcb1e46f3aead661227bb4fed
Author: Jungle Jim (https://sketchfab.com/jungle_jim).
License: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/ .

The user downloaded the official ZIP on 2026-11-07. `jungle-jim/businessman.glb` was extracted from `source/Businessman.glb`; all textures are embedded. The original mesh, texture maps and skeleton are preserved. Runtime changes: standing arm pose, subtle idle movement, procedural skeleton wave, walking, hip/knee seated pose, scale/placement and alpha-tested hair. Chat uses the executive chair with a frontal camera; no downloaded motion-capture clip is claimed. No source animation clips were included. `jungle-jim/preview.jpg` is the author's Sketchfab thumbnail, used as the labelled WebGL fallback. Attribution is also accessible through How it works in the app.

## Previous character: Business Man

Author: Quaternius. Title: Business Man.
Source: https://poly.pizza/m/JFrLIKqvCH
Downloaded 2026-11-07 from the source page's published asset location:
https://static.poly.pizza/e599abbe-7d73-488c-9d7e-3ead281e705c.glb

The source page labels the model **Public Domain (CC0 1.0)**, published February 22, 2022.
License: https://creativecommons.org/publicdomain/zero/1.0/

`business-man.glb` is the downloaded model. The demo customizes materials at runtime and exposes the idle/wave clips. Office props are procedural geometry authored for this project. `business-man-poster.webp` is the model preview from the same source, used only as a labelled WebGL fallback.

## Fonts

Bricolage Grotesque (display, weight 200–800) and Instrument Sans (body, weight 400–700) are self-hosted variable fonts from the official Google Fonts repository. Their SIL Open Font License texts are preserved in `licenses/bricolagegrotesque-OFL.txt` and `licenses/instrumentsans-OFL.txt`.

Original font/license sources:
- https://github.com/google/fonts/tree/main/ofl/bricolagegrotesque
- https://github.com/google/fonts/tree/main/ofl/instrumentsans

### Raised wall lettering

`src/play/assets/wordmark.typeface.json` is a glyph subset derived from the self-hosted Space Grotesk variable font at weight 700, renamed Mr Fund Wordmark, under SIL OFL 1.1 (`licenses/SpaceGrotesk-OFL.txt`). `scripts/build-wordmark-font.py` regenerates it using fontTools in an isolated Python environment (build-time only). Three.js TextGeometry extrudes and bevels the outlines at runtime; no new font download or runtime package is required.

## Window garden scenery

`window-garden.webp` was generated with the built-in imagegen tool on 2026-11-07 for this project, then resized and encoded as WebP (768 × 1024, 253,514 bytes). The complete generation prompt is preserved in `window-garden.prompt.txt`. It depicts a sunlit garden with trees and sky, without a baked-in window or interior. The runtime centres and crops it to the window opening without stretching; the existing frame and blinds remain actual 3D geometry.

### Consultation facial preview — 2026-11-07

The Jungle Jim Businessman head receives runtime additive geometry morph targets in `src/play/characterFace.ts`: localized mouth, brow and smile offsets calibrated to the original head mesh, a runtime split lip seam, a dark mouth interior and a lower-teeth morph. These are project-authored procedural modifications to the credited CC BY 4.0 model, not supplied facial animation clips or phoneme lip-sync. The source GLB is unchanged.

### Consultation typography and bounded portrait — 2026-11-07

Active body font: **Manrope**, Google Fonts source `https://github.com/google/fonts/tree/main/ofl/manrope`, downloaded as `manrope-variable.ttf` from `Manrope[wght].ttf`. SIL OFL text: `licenses/Manrope-OFL.txt`.

Active display font: **Space Grotesk**, Google Fonts source `https://github.com/google/fonts/tree/main/ofl/spacegrotesk`, downloaded as `space-grotesk-variable.ttf` from `SpaceGrotesk[wght].ttf`. SIL OFL text: `licenses/SpaceGrotesk-OFL.txt`.

The existing Jungle Jim character is now presented in a bounded portrait with project-authored procedural desk, laptop, chair and mug geometry. Palms and desk positions are calibrated for the seated pose. The old downloaded furniture, garden texture and previous font files remain inactive source assets; they are not loaded by the consultation renderer. No third-party reference artwork was added.

### Position token icons — 2026-11-07

- `tokens/near.svg`: NEAR symbol from the official NEAR documentation repository, https://github.com/near/docs/blob/master/assets/favicon.svg (download: https://raw.githubusercontent.com/near/docs/master/assets/favicon.svg). The viewBox is tightened around the existing symbol; the glyph paths are unchanged. Displayed in black on a neutral light circular plate.
- `tokens/usdc.svg`: USDC token symbol from Circle's official website CDN: https://cdn.prod.website-files.com/67116d0daddc92483c812e88/67f70c16822274e9e063e81e_9dd0e90b80eda66f26a25533e4874fe9_usdc-tokenlogo.svg. Only the surrounding preview plate/whitespace was removed; the blue token, white paths and proportions are unchanged. Circle brand source and usage guidelines: https://www.circle.com/pressroom#brand-kit. Displayed at 36px, above the stated 32px minimum for the token logo.

Marks remain the property of their respective owners and identify the tokens; no affiliation is implied. Both icons are local SVG assets and require no external image service at runtime.

### Side-view consultation entrance — 2026-11-07

The same credited Businessman model now has a project-authored typing pose and small procedural finger motions during welcome. `consultationEntrance.ts` coordinates a side-to-front camera orbit with laptop clearance and the return to the resting pose. No motion-capture clip, external animation asset, or additional character model was added.

### Dark office and raised wall wordmark — 2026-11-08

The full-screen welcome now uses project-authored procedural office geometry in `consultationRoom.ts`, without external room/furniture textures or downloads. The same scene moves into the consultation column. `wordmark.typeface.json` was regenerated from Space Grotesk weight 700 using the existing build script and fontTools 4.60.1 in an isolated temporary environment; it renders extruded `mr.fund` lettering directly on the left wall. The source font, SIL OFL text and attribution remain as listed above. No runtime font-processing dependency was added.

## Active trial: Microsoft Rocketbox Business Male 01 — 2026-11-08

Source: https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9/Assets/Avatars/Professions/Business_Male_01
Author/copyright: Microsoft Corporation. MIT license copied verbatim to `rocketbox/LICENSE.md`.

The facial FBX and original TGA textures were downloaded from that pinned revision. `scripts/build-rocketbox.py` converts them with Blender 4.5.3 LTS: preserves all 7,435 triangles and the original 80-joint skeleton, renames body bones to the existing controller vocabulary, retains 15 visemes plus seven expression/blink shapes, removes unused shapes/animations, and builds nonmetallic materials from reduced colour maps (head/body 1024px JPEG, quality 88; hair 512px PNG). The source FBX's legacy specular maps incorrectly import as metallic=1, so the conversion explicitly corrects this. No Mixamo account, re-rig, new runtime dependency or service is required.

`rocketbox/business-male-01.glb`: 1,292,448 bytes. Geometry and textures are embedded; no external texture requests or decoder are required. `rocketbox/preview.webp` is a WebP conversion of the author's model preview, used only for the labelled WebGL fallback. Source textures and the Blender binary are temporary build tools outside the repository. The prior Jungle Jim GLB stays inactive for comparison; the checkpoint commit is `dbb9ab9`.

Runtime uses authored facial shapes with a text-based sound approximation and optional browser speech word boundaries. Accurate audio/phoneme timing and browser visual approval are not claimed.

### Chat texture — 2026-11-08

`chat-texture.svg` is an original 40px repeating two-dot pattern authored for this project from simple SVG circles. It uses the existing beige/sage palette at low opacity, with no external artwork, fonts or runtime generation.

### Wallet brand marks — 2026-11-08

- `wallets/meteor.svg`: official Meteor Wallet mark, downloaded unchanged from https://raw.githubusercontent.com/Meteor-Wallet/meteor-public/main/logo_svg.svg (public-facing official repository: https://github.com/Meteor-Wallet/meteor-public). Its native brand gradient is preserved; panel surfaces remain solid.
- `wallets/intear.svg`: official Intear Wallet favicon, downloaded unchanged from https://wallet.intear.tech/favicon.svg.
- NEAR reuses the existing official documentation mark in `tokens/near.svg`, credited above.

Marks identify future wallet options inside the mock-wallet dialog; no live connection is implied. They remain the property of their respective owners. All are served locally without an external image service.

The redesigned wallet dialog displays these marks without background plates or containers. NEAR uses a CSS invert filter for a white-on-charcoal presentation; the source SVG remains unchanged.

### Standing phone presentation — 2026-11-08

Phones reuse the same optimized Rocketbox GLB, original rig and authored facial targets. The runtime hides the procedural room/furniture, uses a standing pose and transparent renderer background, and reframes the existing character to the left of the chat. No extra model, texture, 3D viewer or remote service is loaded. Desktop/tablet retain their seated presentation.
