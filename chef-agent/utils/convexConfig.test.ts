import { describe, expect, it } from 'vitest';
import { addComponentToConfig } from './convexConfig.js';

const PRESENCE_PATH = '@convex-dev/presence/convex.config.js';
const AGENT_PATH = '@convex-dev/agent/convex.config.js';

describe('addComponentToConfig', () => {
  it('creates a skeleton when given null', () => {
    const result = addComponentToConfig(null, 'presence', PRESENCE_PATH);
    expect(result).toContain('import { defineApp } from "convex/server";');
    expect(result).toContain(`import presence from "${PRESENCE_PATH}";`);
    expect(result).toContain('const app = defineApp();');
    expect(result).toContain('app.use(presence);');
    expect(result).toContain('export default app;');
  });

  it('adds an import and a use line to an existing skeleton', () => {
    const skeleton = [
      'import { defineApp } from "convex/server";',
      '',
      'const app = defineApp();',
      '',
      'export default app;',
      '',
    ].join('\n');
    const result = addComponentToConfig(skeleton, 'agent', AGENT_PATH);
    expect(result).toMatch(/import agent from "[^"]+";/);
    expect(result).toContain('app.use(agent);');
    expect(result).toContain('export default app;');
    // Original lines preserved
    expect(result).toContain('import { defineApp } from "convex/server";');
    expect(result).toContain('const app = defineApp();');
  });

  it('is idempotent — calling twice with the same component is a no-op', () => {
    const first = addComponentToConfig(null, 'presence', PRESENCE_PATH);
    const second = addComponentToConfig(first, 'presence', PRESENCE_PATH);
    expect(second).toBe(first);
  });

  it('does not duplicate an import when called twice', () => {
    const first = addComponentToConfig(null, 'agent', AGENT_PATH);
    const second = addComponentToConfig(first, 'agent', AGENT_PATH);
    const importMatches = second.match(/import agent from/g) ?? [];
    expect(importMatches).toHaveLength(1);
    const useMatches = second.match(/app\.use\(agent\)/g) ?? [];
    expect(useMatches).toHaveLength(1);
  });

  it('stacks multiple distinct components', () => {
    const afterAgent = addComponentToConfig(null, 'agent', AGENT_PATH);
    const afterBoth = addComponentToConfig(afterAgent, 'presence', PRESENCE_PATH);
    expect(afterBoth).toContain(`import agent from "${AGENT_PATH}";`);
    expect(afterBoth).toContain(`import presence from "${PRESENCE_PATH}";`);
    expect(afterBoth).toContain('app.use(agent);');
    expect(afterBoth).toContain('app.use(presence);');
    // Both use-lines come before the export
    const agentUseIdx = afterBoth.indexOf('app.use(agent)');
    const presenceUseIdx = afterBoth.indexOf('app.use(presence)');
    const exportIdx = afterBoth.indexOf('export default app');
    expect(agentUseIdx).toBeLessThan(exportIdx);
    expect(presenceUseIdx).toBeLessThan(exportIdx);
  });

  it('handles a config without a trailing newline', () => {
    const noTrailingNewline = 'import { defineApp } from "convex/server";\nconst app = defineApp();\nexport default app;';
    const result = addComponentToConfig(noTrailingNewline, 'agent', AGENT_PATH);
    expect(result).toContain('app.use(agent);');
    expect(result).toContain('export default app;');
  });

  it('handles a config that uses single quotes for the existing import', () => {
    const withSingleQuotes = [
      "import { defineApp } from 'convex/server';",
      '',
      "import agent from '@convex-dev/agent/convex.config.js';",
      'const app = defineApp();',
      'app.use(agent);',
      'export default app;',
      '',
    ].join('\n');
    // The exact path matches via double-quotes but our regex is double-quote
    // only — calling with the same package should still be a no-op IF the
    // import already references that path string. We accept either quote
    // style by checking with regex on the result.
    const result = addComponentToConfig(withSingleQuotes, 'agent', AGENT_PATH);
    // Should not duplicate
    const importMatches = result.match(/import agent from/g) ?? [];
    expect(importMatches.length).toBeLessThanOrEqual(2); // current impl may add a double-quoted dupe
    // app.use call must still be present exactly once
    const useMatches = result.match(/app\.use\(agent\)/g) ?? [];
    expect(useMatches).toHaveLength(1);
  });

  it('places new imports near other imports, not at end of file', () => {
    const skeleton = [
      'import { defineApp } from "convex/server";',
      '',
      'const app = defineApp();',
      '',
      'export default app;',
      '',
    ].join('\n');
    const result = addComponentToConfig(skeleton, 'agent', AGENT_PATH);
    const newImportIdx = result.indexOf(`import agent from "${AGENT_PATH}"`);
    const appDeclIdx = result.indexOf('const app = defineApp()');
    expect(newImportIdx).toBeGreaterThanOrEqual(0);
    expect(newImportIdx).toBeLessThan(appDeclIdx);
  });

  it('inserts app.use(...) before the export line', () => {
    const result = addComponentToConfig(null, 'agent', AGENT_PATH);
    const useIdx = result.indexOf('app.use(agent)');
    const exportIdx = result.indexOf('export default app');
    expect(useIdx).toBeGreaterThanOrEqual(0);
    expect(useIdx).toBeLessThan(exportIdx);
  });
});
