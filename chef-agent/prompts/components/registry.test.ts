import { describe, expect, it } from 'vitest';
import {
  AUTHORING_GUIDE_KEY,
  componentByKey,
  componentImportIdentifier,
  componentRegistry,
  formatRegistryForPrompt,
  loadComponentDoc,
  visibleComponents,
} from './registry.js';
import { resolveLookupDoc } from '../../tools/lookupDocs.js';

describe('componentImportIdentifier', () => {
  it.each([
    ['presence', 'presence'],
    ['agent', 'agent'],
    ['prosemirror-sync', 'prosemirrorSync'],
    ['rate-limiter', 'rateLimiter'],
    ['expo-push-notifications', 'expoPushNotifications'],
    ['workos-authkit', 'workosAuthkit'],
  ])('converts %s → %s', (input, expected) => {
    expect(componentImportIdentifier(input)).toBe(expected);
  });
});

describe('componentRegistry', () => {
  it('has at least the three curated components', () => {
    const keys = componentRegistry.map((c) => c.key);
    expect(keys).toContain('presence');
    expect(keys).toContain('prosemirror-sync');
    expect(keys).toContain('resend');
  });

  it('every entry has a non-empty name, package, and description', () => {
    for (const entry of componentRegistry) {
      expect(entry.name, `name for ${entry.key}`).not.toBe('');
      expect(entry.npmPackage, `npmPackage for ${entry.key}`).toMatch(/^@convex-dev\//);
      expect(entry.description, `description for ${entry.key}`).not.toBe('');
      expect(entry.tags, `tags for ${entry.key}`).not.toHaveLength(0);
    }
  });

  it('componentByKey is consistent with the registry', () => {
    expect(componentByKey.size).toBe(componentRegistry.length);
    for (const entry of componentRegistry) {
      expect(componentByKey.get(entry.key)).toBe(entry);
    }
  });

  it('marks curated entries as curated and others as not curated', () => {
    expect(componentByKey.get('presence')?.curated).toBe(true);
    expect(componentByKey.get('prosemirror-sync')?.curated).toBe(true);
    expect(componentByKey.get('resend')?.curated).toBe(true);
    // Pick a known snapshot-only entry
    const agent = componentByKey.get('agent');
    expect(agent?.curated).toBe(false);
  });
});

describe('loadComponentDoc', () => {
  it('returns non-empty content for every registry key', () => {
    for (const entry of componentRegistry) {
      const doc = loadComponentDoc(entry.key);
      expect(doc, `doc for ${entry.key}`).not.toBeNull();
      expect(doc!.length, `doc length for ${entry.key}`).toBeGreaterThan(50);
    }
  });

  it('returns the authoring guide for the special key', () => {
    const doc = loadComponentDoc(AUTHORING_GUIDE_KEY);
    expect(doc).not.toBeNull();
    expect(doc).toContain('Authoring Components');
  });

  it('returns null for unknown keys', () => {
    expect(loadComponentDoc('this-component-does-not-exist')).toBeNull();
  });

  it('curated overrides take precedence over snapshots', () => {
    const presence = loadComponentDoc('presence')!;
    // The curated prompt has specific text not present in the auto-generated
    // snapshot (the `usePresence` hook signature paragraph).
    expect(presence).toContain('usePresence');
  });
});

describe('formatRegistryForPrompt', () => {
  it('lists every registry entry when allowlist is null', () => {
    const formatted = formatRegistryForPrompt(null);
    for (const entry of componentRegistry) {
      expect(formatted).toContain(`\`${entry.key}\``);
    }
  });

  it('filters to allowed keys only', () => {
    const formatted = formatRegistryForPrompt(new Set(['presence', 'agent']));
    expect(formatted).toContain('`presence`');
    expect(formatted).toContain('`agent`');
    expect(formatted).not.toContain('`rate-limiter`');
    expect(formatted).not.toContain('`resend`');
  });

  it('returns empty string when allowlist is empty', () => {
    expect(formatRegistryForPrompt(new Set())).toBe('');
  });
});

describe('visibleComponents', () => {
  it('returns full registry when allowlist is null', () => {
    expect(visibleComponents(null)).toEqual(componentRegistry);
  });

  it('returns only allowed entries', () => {
    const allowed = visibleComponents(new Set(['presence']));
    expect(allowed.map((c) => c.key)).toEqual(['presence']);
  });
});

describe('resolveLookupDoc', () => {
  it('returns the README for an allowed key', () => {
    const r = resolveLookupDoc('presence', new Set(['presence']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content.length).toBeGreaterThan(0);
  });

  it('rejects a key outside the allowlist', () => {
    const r = resolveLookupDoc('presence', new Set(['agent']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not enabled/);
  });

  it('rejects an unknown key even if "allowed"', () => {
    const r = resolveLookupDoc('made-up-component', new Set(['made-up-component']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Unknown component/);
  });

  it('returns the authoring guide regardless of allowlist', () => {
    const r = resolveLookupDoc(AUTHORING_GUIDE_KEY, new Set());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content).toContain('Authoring Components');
  });

  it('treats null allowlist as "no filter" (all components visible)', () => {
    const r = resolveLookupDoc('agent', null);
    expect(r.ok).toBe(true);
  });
});
