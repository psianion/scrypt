// Seed the research-sources memory note into a vault using FileManager
// (NEVER bypass FileManager for note writes — see CLAUDE.md invariants).
//
// Usage: bun scripts/seed-research-sources.ts [vaultPath]
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { FileManager } from "../src/server/file-manager";

const CONTENT = `# Research sources

Preferred places to look for research, ranked by usefulness:

## Tech / programming
- Reddit: r/programming, r/ExperiencedDevs, r/rust, r/golang, r/cpp
- Hacker News (news.ycombinator.com)
- arxiv.org — recent papers
- GitHub trending + release notes of relevant projects
- Company engineering blogs (Cloudflare, Discord, Stripe, Netflix, Meta)

## Making / hardware / 3D printing
- Reddit: r/resinprinting, r/3Dprinting, r/functionalprint
- YouTube: Bambu Lab channel, Teaching Tech, CNC Kitchen
- Printables + Thingiverse for models

## Art / creative
- ArtStation, Behance
- Reddit: r/Art, r/DigitalPainting
- YouTube: Proko, Marco Bucci

## Anime / pop culture
- MyAnimeList, AniList
- Reddit: r/anime, r/manga
- Crunchyroll / ANN news

## Avoid
- Wikipedia for cutting-edge tech (stale)
- Medium blogs (SEO noise)
- Any aggregator that doesn't link to primary sources
`;

const FRONTMATTER = {
  title: "Research sources",
  kind: "memory",
  category: "preference",
  active: true,
  priority: 3,
  tags: ["memory", "preference", "research"],
};

async function main() {
  const vaultPath = process.argv[2] || join(process.cwd(), "vault");
  const scryptPath = join(vaultPath, ".scrypt");
  mkdirSync(join(vaultPath, "memory"), { recursive: true });
  mkdirSync(scryptPath, { recursive: true });

  const fm = new FileManager(vaultPath, scryptPath);
  await fm.writeNote("memory/research-sources.md", CONTENT, FRONTMATTER);
  console.log(`seeded memory/research-sources.md in ${vaultPath}`);
}

main().catch((e) => {
  console.error("seed failed:", e);
  process.exit(1);
});
