import type { Store } from "../store/db.js";
import { SummaryInput } from "./schemas.js";
import { resolveDefaultScope } from "../scope.js";

export function handleSummary(store: Store, raw: unknown) {
  const input = SummaryInput.parse(raw);
  const scope = store.resolveScope(resolveDefaultScope(input.scope));

  // Retrieve memories by type. Facts and decisions never auto-prune,
  // whereas episodes represent session summaries.
  const facts = store.listByScope(scope.id, "fact", 100);
  const decisions = store.listByScope(scope.id, "decision", 100);
  const episodes = store.listByScope(scope.id, "episode", 100);
  const artifacts = store.listByScope(scope.id, "artifact", 100);

  const totalFacts = facts.length;
  const totalDecisions = decisions.length;
  const totalEpisodes = episodes.length;
  const totalArtifacts = artifacts.length;
  const totalCount = totalFacts + totalDecisions + totalEpisodes + totalArtifacts;

  let md = `# Anchor Scope Summary: ${scope.name}\n\n`;
  md += `**Total Memories:** ${totalCount} (Facts: ${totalFacts}, Decisions: ${totalDecisions}, Episodes: ${totalEpisodes}, Artifacts: ${totalArtifacts})\n\n`;

  if (totalFacts > 0) {
    md += `## 📋 Key Facts & Guidelines\n`;
    facts.slice(0, 10).forEach((f) => {
      md += `- **[${f.id.slice(0, 8)}]** ${f.content}\n`;
    });
    if (totalFacts > 10) {
      md += `- ... and ${totalFacts - 10} more facts.\n`;
    }
    md += `\n`;
  }

  if (totalDecisions > 0) {
    md += `## 🧠 Architectural Decisions\n`;
    decisions.slice(0, 10).forEach((d) => {
      md += `- **[${d.id.slice(0, 8)}]** ${d.content}\n`;
      if (d.rationale) {
        md += `  *Rationale:* ${d.rationale}\n`;
      }
    });
    if (totalDecisions > 10) {
      md += `- ... and ${totalDecisions - 10} more decisions.\n`;
    }
    md += `\n`;
  }

  if (totalEpisodes > 0) {
    md += `## ⏱️ Recent Episodes (Session Summaries)\n`;
    episodes.slice(0, 5).forEach((e) => {
      md += `- **[${e.id.slice(0, 8)}]** ${e.content}\n`;
      if (e.files && e.files.length > 0) {
        md += `  *Files modified:* ${e.files.join(", ")}\n`;
      }
    });
    if (totalEpisodes > 5) {
      md += `- ... and ${totalEpisodes - 5} older episodes.\n`;
    }
    md += `\n`;
  }

  if (totalArtifacts > 0) {
    md += `## 🗃️ Tracked Artifacts & File Pointers\n`;
    artifacts.slice(0, 5).forEach((a) => {
      md += `- **[${a.id.slice(0, 8)}]** \`${a.ref}\`${a.note ? ` - ${a.note}` : ""}\n`;
    });
    if (totalArtifacts > 5) {
      md += `- ... and ${totalArtifacts - 5} other artifacts.\n`;
    }
    md += `\n`;
  }

  if (totalCount === 0) {
    md += `No memories found in this scope yet. Start remembering facts, decisions, and episodes to populate this summary!\n`;
  }

  return {
    scope: scope.name,
    counts: {
      facts: totalFacts,
      decisions: totalDecisions,
      episodes: totalEpisodes,
      artifacts: totalArtifacts,
    },
    summary: md.trim(),
  };
}
