import type { Tool } from 'ai';
import { z } from 'zod';
import {
  AUTHORING_GUIDE_KEY,
  formatRegistryForPrompt,
  loadComponentDoc,
} from '../prompts/components/registry.js';

export const lookupDocsParameters = z.object({
  docs: z
    .array(z.string())
    .describe(
      'List of registry keys to look up (e.g. "agent", "rate-limiter"). Each key MUST appear in the tool description.',
    ),
});

export type LookupDocsParameters = z.infer<typeof lookupDocsParameters>;

export function lookupDocsTool(opts?: { allowlist?: ReadonlySet<string> | null }): Tool {
  const allowlist = opts?.allowlist ?? null;
  const list = formatRegistryForPrompt(allowlist);
  const empty = list.length === 0;
  const description = [
    'Look up the README + usage docs for one or more Convex components, or for',
    "the component-authoring guide. Always call this before installing a",
    "component you haven't used yet so you get the correct setup steps.",
    '',
    empty
      ? 'No components are currently enabled for this chat. Ask the user to enable components via the Components menu in the chat header.'
      : 'Components available in this chat:',
    empty ? '' : list,
    '',
    `Plus the special key \`${AUTHORING_GUIDE_KEY}\` for the guide to writing your own components.`,
  ]
    .filter((line) => line.length > 0 || line === '')
    .join('\n');
  return { description, inputSchema: lookupDocsParameters };
}

export type LookupDocsResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

/**
 * Resolves a single lookup key against the registry, respecting the chat's
 * component allowlist. The authoring guide is always available regardless of
 * the allowlist.
 */
export function resolveLookupDoc(
  key: string,
  allowlist: ReadonlySet<string> | null,
): LookupDocsResult {
  if (key === AUTHORING_GUIDE_KEY) {
    const content = loadComponentDoc(key);
    return content
      ? { ok: true, content }
      : { ok: false, error: 'Authoring guide is unavailable.' };
  }
  if (allowlist && !allowlist.has(key)) {
    return {
      ok: false,
      error: `Component "${key}" is not enabled for this chat. Ask the user to enable it via the Components menu in the chat header.`,
    };
  }
  const content = loadComponentDoc(key);
  if (content === null) {
    return {
      ok: false,
      error: `Unknown component "${key}". Use one of the keys listed in the lookupDocs tool description.`,
    };
  }
  return { ok: true, content };
}
