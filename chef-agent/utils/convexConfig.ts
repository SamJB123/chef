/**
 * Pure-string helpers for keeping `convex/convex.config.ts` in sync when the
 * agent installs a component. Idempotent: calling `addComponentToConfig` twice
 * with the same component is a no-op the second time.
 */

const CONFIG_SKELETON = `import { defineApp } from "convex/server";

const app = defineApp();

export default app;
`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns an updated `convex.config.ts` source that imports the given component
 * config and registers it via `app.use(...)`. If `existingSource` is null, a
 * minimal skeleton is created first.
 */
export function addComponentToConfig(
  existingSource: string | null,
  identifier: string,
  importPath: string,
): string {
  let source = existingSource ?? CONFIG_SKELETON;

  const importPattern = new RegExp(
    `import\\s+[\\w$]+\\s+from\\s+["']${escapeRegExp(importPath)}["']\\s*;?`,
  );
  if (!importPattern.test(source)) {
    const importLine = `import ${identifier} from "${importPath}";`;
    // Insert after the last existing import at the top of the file, or at the
    // very top if no imports exist.
    const lastImportEnd = lastImportEndIndex(source);
    if (lastImportEnd === -1) {
      source = `${importLine}\n${source}`;
    } else {
      source = `${source.slice(0, lastImportEnd)}\n${importLine}${source.slice(lastImportEnd)}`;
    }
  }

  const usePattern = new RegExp(`app\\.use\\(\\s*${escapeRegExp(identifier)}\\s*[,)]`);
  if (!usePattern.test(source)) {
    const useLine = `app.use(${identifier});`;
    if (/export\s+default\s+app\s*;?/.test(source)) {
      source = source.replace(/(\n*)(export\s+default\s+app\s*;?)/, `\n${useLine}\n$2`);
    } else {
      source = `${source.trimEnd()}\n${useLine}\n\nexport default app;\n`;
    }
  }

  return source;
}

function lastImportEndIndex(source: string): number {
  const importRe = /^import\s[^;]*;\s*$/gm;
  let match: RegExpExecArray | null;
  let end = -1;
  while ((match = importRe.exec(source)) !== null) {
    end = match.index + match[0].length;
  }
  return end;
}
