// Component registry for chef-agent. Single source of truth for which Convex
// components the agent knows about. Curated prompts (presence, prosemirror-sync,
// resend) take precedence over auto-snapshotted READMEs.
//
// To refresh the snapshots and pick up new components: `pnpm run sync:components`.

import indexJson from './snapshots/_index.json' with { type: 'json' };
import { snapshotReadmes } from './snapshots/snapshots.generated.js';
import { presenceComponentReadmePrompt } from './presence.js';
import { proseMirrorComponentReadmePrompt } from './proseMirror.js';
import { resendComponentReadmePrompt } from './resend.js';
import { authoringComponentsPrompt } from './authoringComponents.js';

export type ComponentEntry = {
  /** Stable identifier the agent uses (matches the npm slug, e.g. "agent"). */
  key: string;
  /** Display name for the UI dialog. */
  name: string;
  /** NPM package, e.g. "@convex-dev/agent". */
  npmPackage: string;
  /** One-line description shown in the UI and in the system prompt list. */
  description: string;
  /** Tags for grouping in the UI (e.g. "ai", "auth", "data"). */
  tags: string[];
  /** Optional homepage URL. */
  homepage: string | null;
  /** True when a hand-curated prompt overrides the auto-snapshot. */
  curated: boolean;
};

type IndexEntry = {
  slug: string;
  npmPackage: string;
  description: string;
  version: string;
  homepage: string | null;
  readmeFile: string;
};

type CuratedOverride = {
  name: string;
  description?: string;
  tags: string[];
  load: () => string;
};

/**
 * Hand-curated overrides. The key MUST match the npm slug so the snapshot is
 * suppressed for the same component. The `load()` function returns a prompt
 * that has been tuned for Chef's WebContainer environment.
 */
const curatedOverrides: Record<string, CuratedOverride> = {
  presence: {
    name: 'Presence',
    description: 'Live "who is here" indicators with heartbeats and disconnect handling.',
    tags: ['realtime', 'collaboration'],
    load: () => presenceComponentReadmePrompt,
  },
  'prosemirror-sync': {
    name: 'ProseMirror Sync',
    description: 'Collaborative rich-text editor synced via ProseMirror/Tiptap/BlockNote.',
    tags: ['collaboration', 'editor'],
    load: () => proseMirrorComponentReadmePrompt,
  },
  resend: {
    name: 'Resend',
    description: 'Send transactional emails via Resend with queuing, batching, and retries.',
    tags: ['email', 'integration'],
    load: () => resendComponentReadmePrompt,
  },
};

/** Default tags applied to snapshot-only entries (no curated override). */
const defaultTags: Record<string, string[]> = {
  agent: ['ai'],
  rag: ['ai'],
  mastra: ['ai', 'integration'],
  'persistent-text-streaming': ['ai', 'streaming'],
  'action-cache': ['performance'],
  'action-retrier': ['reliability'],
  aggregate: ['data'],
  'sharded-counter': ['data'],
  geospatial: ['data'],
  migrations: ['data'],
  'table-history': ['data'],
  workpool: ['async'],
  workflow: ['async'],
  crons: ['async'],
  'rate-limiter': ['security'],
  'better-auth': ['auth'],
  'workos-authkit': ['auth'],
  r2: ['storage'],
  'static-hosting': ['hosting'],
  twilio: ['integration', 'sms'],
  'expo-push-notifications': ['integration', 'mobile'],
  launchdarkly: ['integration', 'feature-flags'],
  polar: ['integration', 'billing'],
  stripe: ['integration', 'billing'],
};

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ''))
    .join(' ');
}

const index = indexJson as { generatedAt: string; components: IndexEntry[] };

export const componentRegistry: ComponentEntry[] = index.components.map((snap): ComponentEntry => {
  const override = curatedOverrides[snap.slug];
  return {
    key: snap.slug,
    name: override?.name ?? titleCase(snap.slug),
    npmPackage: snap.npmPackage,
    description: override?.description ?? snap.description,
    tags: override?.tags ?? defaultTags[snap.slug] ?? ['other'],
    homepage: snap.homepage,
    curated: Boolean(override),
  };
});

export const componentByKey: ReadonlyMap<string, ComponentEntry> = new Map(
  componentRegistry.map((c) => [c.key, c]),
);

/** Special non-component key for the authoring guide. */
export const AUTHORING_GUIDE_KEY = 'authoringComponents';

/**
 * Returns the README text for a registry key, or the authoring guide if
 * key === AUTHORING_GUIDE_KEY. Returns null when the key is unknown.
 */
export function loadComponentDoc(key: string): string | null {
  if (key === AUTHORING_GUIDE_KEY) return authoringComponentsPrompt;
  const override = curatedOverrides[key];
  if (override) return override.load();
  return snapshotReadmes[key] ?? null;
}

/**
 * Formats the registry as a compact bullet list for inclusion in the system
 * prompt. When `allowlist` is non-null, only those keys are listed.
 */
export function formatRegistryForPrompt(allowlist: ReadonlySet<string> | null): string {
  const lines: string[] = [];
  for (const entry of componentRegistry) {
    if (allowlist && !allowlist.has(entry.key)) continue;
    lines.push(`- \`${entry.key}\` (${entry.npmPackage}) — ${entry.description}`);
  }
  return lines.join('\n');
}

/**
 * Returns the subset of the registry that's visible to a chat. Pass `null` for
 * the allowlist to get the full registry.
 */
export function visibleComponents(allowlist: ReadonlySet<string> | null): ComponentEntry[] {
  if (allowlist === null) return componentRegistry;
  return componentRegistry.filter((c) => allowlist.has(c.key));
}

/**
 * Converts a registry key (kebab-case) to the conventional camelCase identifier
 * used when importing the component config and calling `app.use(...)`.
 *
 *   "presence"          -> "presence"
 *   "prosemirror-sync"  -> "prosemirrorSync"
 *   "rate-limiter"      -> "rateLimiter"
 */
export function componentImportIdentifier(key: string): string {
  return key
    .split('-')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}
