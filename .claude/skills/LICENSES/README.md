# Third-party skills: licenses and provenance

The skill folders next to this directory are unmodified copies of upstream agent skills, installed with `skills@1.7.6` at the pinned revisions recorded in `skills-lock.json` (repository root). Full provenance, review notes and restore steps: `docs/technical/INTEGRATIONS.md`, section "Skills".

| Skills | Upstream (pinned revision) | License |
| --- | --- | --- |
| requesting-code-review, systematic-debugging, test-driven-development, verification-before-completion, writing-plans | https://github.com/obra/superpowers (`22f0b463e7a5e579904dd6211a520321035526f7`) | MIT, text in `obra-superpowers-MIT.txt` |
| codebase-design | https://github.com/mattpocock/skills (`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`) | MIT, text in `mattpocock-skills-MIT.txt` |
| near-smart-contracts | https://github.com/near/agent-skills (`cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b`) | MIT, declared in the skill's own `SKILL.md` frontmatter |
| near-api-js, near-dapp, near-ai-cloud, near-contract-audit | https://github.com/near/agent-skills (`cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b`) | No license declared upstream as of 2026-11-04 (no LICENSE file; GitHub API reports none). Published by the NEAR organization for installation with the skills CLI. See OPEN-DECISIONS B10 |
| motion | https://github.com/motiondivision/ai-kit (`1e424943582cbbdb6e3f410687e39f96451447bb`) | No repository LICENSE file; the repository's `packages/motion-ai/package.json` declares MIT |

All copyrights remain with their respective authors.
