import type { Tool } from 'ai';
import { z } from 'zod';
import { formatRegistryForPrompt } from '../prompts/components/registry.js';

export const installComponentParameters = z.object({
  key: z
    .string()
    .describe(
      'Registry key of the component to install (e.g. "agent", "rate-limiter"). MUST be one of the keys listed in this tool description.',
    ),
});

export type InstallComponentParameters = z.infer<typeof installComponentParameters>;

/**
 * Installs a Convex component into the user's project. Wraps two steps that
 * the agent should never do separately:
 *
 *   1. `npm install <package>` for the component's npm package
 *   2. Idempotently edit `convex/convex.config.ts` to import the component
 *      config and register it via `app.use(...)`
 *
 * Always call `lookupDocs` for the component first; that returns the README
 * which explains the per-component setup (extra files to create, env vars to
 * set, etc.) that must happen AFTER this tool runs.
 */
export function installComponentTool(opts?: {
  allowlist?: ReadonlySet<string> | null;
}): Tool {
  const allowlist = opts?.allowlist ?? null;
  const list = formatRegistryForPrompt(allowlist);
  const empty = list.length === 0;
  const description = [
    'Install a Convex component: runs `npm install` for the component package',
    'AND creates/updates `convex/convex.config.ts` to register it. Always call',
    '`lookupDocs` for the component first so you know its usage; then call',
    'this tool; then write the per-component wiring shown in the docs.',
    '',
    empty
      ? 'No components are enabled for this chat. Ask the user to enable a component via the Components menu in the chat header before calling this tool.'
      : 'Components available in this chat:',
    empty ? '' : list,
  ]
    .filter((line) => line.length > 0 || line === '')
    .join('\n');
  return { description, inputSchema: installComponentParameters };
}
