/**
 * Which skills a conversation may trigger, and how the composer's list is built.
 *
 * Two inputs decide it, and the rules are the whole feature:
 *
 *   - **global skills** — the ones configured in Settings → Skills. They appear
 *     in every conversation without being added by hand, switched **on**;
 *   - **per-conversation state** — what this conversation has decided, by
 *     {@link skillKey}. A key present is an explicit choice; a key absent has no
 *     opinion.
 *
 * So: a skill is on when the conversation says so, and otherwise when it is
 * global. A skill the user picks up in one conversation therefore starts **off**
 * (the add writes `false`), while a global one starts **on**.
 *
 * The output that matters is {@link enabledSkillPaths}: pi is started with
 * `--no-skills --skill <path>…`, so a skill that is not in this list is not in
 * the session at all and cannot be triggered. The list is exactly the switches
 * that are on — there is no other way in.
 *
 * ## Why built-in skills are not special-cased
 *
 * They used to be: every built-in was forced into the list and its switch was
 * locked on, because APIX's 压缩上下文 button worked by sending pi the command
 * `/skill:apix-context-handoff`, and that command only exists while the skill is
 * loaded. That made a built-in an unremovable row in every conversation — which
 * is not what a conversation's skill list means, and it spent the skill's
 * description in every system prompt.
 *
 * The dependency is gone: `useHandoff` now reads the built-in's body and sends
 * it, the way pi's own `/skill:` expansion does, so the button works whether or
 * not the skill is enabled. Built-ins are now ordinary entries in the pool —
 * addable to the global list, addable to a conversation, deletable never (the
 * host refuses), and off until asked for.
 */

import { skillKey, type ChatSkillState, type SkillEntry } from "./configBridge";

export interface SkillRow {
  skill: SkillEntry;
  key: string;
  /** Switch position, after the default/override rules above. */
  on: boolean;
  /** In the global list: offered everywhere, on by default. */
  global: boolean;
  /** Added to this conversation itself, so it can also be taken out again. */
  added: boolean;
}

/**
 * The composer's rows: every global skill, plus whatever this conversation
 * added, and nothing else.
 *
 * Skills the conversation names but the library no longer has are dropped — a
 * deleted skill must not linger as a ghost switch.
 */
export function skillRows(
  skills: readonly SkillEntry[],
  globalSkills: readonly string[],
  chatState: ChatSkillState,
): SkillRow[] {
  const byKey = new Map(skills.map((skill) => [skillKey(skill), skill]));
  const globalSet = new Set(globalSkills);

  const keys = new Set<string>();
  for (const key of globalSkills) if (byKey.has(key)) keys.add(key);
  for (const key of Object.keys(chatState)) if (byKey.has(key)) keys.add(key);

  const rows: SkillRow[] = [];
  for (const key of keys) {
    const skill = byKey.get(key);
    if (!skill) continue;
    const global = globalSet.has(key);
    rows.push({
      skill,
      key,
      on: chatState[key] ?? global,
      global,
      added: !global,
    });
  }

  // Global first (they are the ones that matter every turn), then by name — so
  // the list does not reshuffle when a switch is toggled.
  rows.sort((a, b) => {
    if (a.global !== b.global) return a.global ? -1 : 1;
    return a.skill.name.toLowerCase().localeCompare(b.skill.name.toLowerCase());
  });
  return rows;
}

/**
 * The `--skill` list for the engine: only the switches that are on.
 *
 * Sorted and de-duplicated so the result is a stable signature — the engine only
 * restarts when this actually changes, and an unstable order would restart it on
 * every render.
 */
export function enabledSkillPaths(
  skills: readonly SkillEntry[],
  globalSkills: readonly string[],
  chatState: ChatSkillState,
): string[] {
  const paths = new Set<string>();
  for (const row of skillRows(skills, globalSkills, chatState)) {
    if (row.on) paths.add(row.skill.path);
  }
  return [...paths].sort();
}

/** All skills not yet in the composer's list, for the "add" menu. */
export function addableSkills(
  skills: readonly SkillEntry[],
  globalSkills: readonly string[],
  chatState: ChatSkillState,
): SkillEntry[] {
  const shown = new Set(skillRows(skills, globalSkills, chatState).map((row) => row.key));
  return skills.filter((skill) => !shown.has(skillKey(skill)));
}

/** Strip a leading `---` … `---` block, the way pi does before expanding a skill. */
function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
}

/**
 * The text that stands in for `/skill:<name>` when APIX has to run a skill
 * itself rather than let the user type the command.
 *
 * Only 压缩上下文 needs this, and why is worth recording: the button used to send
 * pi `/skill:apix-context-handoff`, which meant the built-in skill had to be
 * loaded for the button to do anything — so every conversation carried it, with a
 * locked switch, and paid for its description in the prompt. Reading the body and
 * sending it (as pi's own `_expandSkillCommand` does: frontmatter stripped, body
 * wrapped with its location so relative references resolve) removes that coupling
 * entirely. The button works whatever the skill's switch says, and a skill the
 * user never asked for is never in the prompt.
 */
export function skillInvocationText(input: {
  name: string;
  manifestPath: string;
  raw: string;
}): string {
  // The skill directory, not the file: pi tells the model to resolve relative
  // paths against the parent of SKILL.md.
  const baseDir = input.manifestPath.replace(/[\\/][^\\/]*$/, "");
  const body = stripFrontmatter(input.raw);
  return `<skill name="${input.name}" location="${input.manifestPath}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
}
