# Component Support Plan

Plan for extending chef-agent to (a) dynamically use any component in the
Convex components directory and (b) author components, including the
"organize an app as multiple components" use case.

Status: draft for review. Decisions flagged with **DECIDE** still need input
before code starts.

---

## Goals

1. The model can install and use *any* component listed in the public Convex
   components directory, not just the 3 (`presence`, `proseMirror`, `resend`)
   with hardcoded prompts.
2. The model can author components — both packaged (NPM-published) and local
   (modules within the user's `convex/` tree).
3. For multi-module apps, the model presents feature folders **and** local
   components as equally valid choices and discusses the tradeoff with the
   user before scaffolding.

---

## Architecture overview

Two seams change:

- **Knowledge.** Today: a fixed `docs` map in `chef-agent/tools/lookupDocs.ts`
  plus a hardcoded supported/unsupported list in
  `chef-agent/prompts/convexGuidelines.ts:920-953`. Move to a typed
  **registry manifest** that enumerates every directory entry. Curated
  prompts remain (and grow); long-tail entries get auto-snapshotted READMEs.

- **Authoring guidance.** Today: `authoringComponentsPrompt` only reachable
  via `lookupDocs`, never proactive; `template_info()` in
  `solutionConstraints.ts:179-241` implicitly biases toward a single
  `convex/` directory. Add a short always-on section that surfaces the
  organization tradeoff (feature folders vs local components) neutrally.

Tools may change too:

- `lookupDocs` becomes registry-driven (input keys validated against the
  manifest; description auto-generated).
- Optional new `installComponent` tool that wraps `npm install` + edits
  `convex/convex.config.ts` idempotently, so the model can't forget the
  wiring step.
- Optional new `scaffoldLocalComponent` tool for the local-component path.

---

## Phase 1 — Registry-driven component knowledge

### 1.1 Registry manifest

New file: `chef-agent/prompts/components/registry.ts`.

```ts
export type ComponentEntry = {
  /** Stable key used by lookupDocs (e.g. "presence", "agent"). */
  key: string;
  /** Human-readable name shown in tool output. */
  name: string;
  /** NPM package, e.g. "@convex-dev/agent". */
  npmPackage: string;
  /** One-line summary surfaced in lookupDocs tool description. */
  description: string;
  /** Tags for grouping/filtering (e.g. ["ai","email","rate-limit"]). */
  tags: string[];
  /**
   * Source of the README the model will see:
   *  - "curated": handwritten prompt module in ./components/
   *  - "snapshot": fetched at build time, lives in ./snapshots/<key>.md
   */
  docs: { kind: "curated"; load: () => string } | { kind: "snapshot"; file: string };
  /** convex.dev/components slug for human-facing links. */
  slug?: string;
};

export const componentRegistry: ComponentEntry[] = [
  // Curated entries (existing prompts):
  { key: "presence", /* ... */, docs: { kind: "curated", load: () => presenceComponentReadmePrompt } },
  { key: "proseMirror", /* ... */, docs: { kind: "curated", load: () => proseMirrorComponentReadmePrompt } },
  { key: "resend", /* ... */, docs: { kind: "curated", load: () => resendComponentReadmePrompt } },
  // ...plus snapshot entries for every other directory component.
];

export const componentByKey = new Map(componentRegistry.map((c) => [c.key, c]));
```

### 1.2 Snapshot pipeline

New script: `scripts/fetch-component-readmes.ts`. For each `snapshot` entry,
fetches the README via `https://registry.npmjs.org/<pkg>/latest` (the
`readme` field) or the GitHub raw URL, writes
`chef-agent/prompts/components/snapshots/<key>.md`. Committed to the repo.

- **DECIDE 1:** snapshot vs runtime fetch. Snapshot = simpler, deterministic,
  bundles bytes into the build. Runtime fetch = always fresh but adds a
  network dep and complicates the WebContainer/server boundary. I recommend
  **snapshot** with a quarterly refresh.
- **DECIDE 2:** where the script runs. Manual (`pnpm run sync:components`)
  vs CI cron. Recommend manual for now; CI later.

### 1.3 `lookupDocs` refactor

File: `chef-agent/tools/lookupDocs.ts`.

- `description` is generated from `componentRegistry` (each entry's `key` +
  `description`), so adding a component automatically advertises it. Fixes
  the current `resend` description bug along the way.
- `inputSchema` validates `docs[]` against the registry's keys.
- Resolver returns `entry.docs.load()` (curated) or
  `readFileSync(snapshots/<file>)` (snapshot) for each requested key.

Action-runner change: `app/lib/runtime/action-runner.ts:414-428` updates to
use `componentByKey` instead of the old `docs` import.

### 1.4 Delete "unsupported in Chef" list

File: `chef-agent/prompts/convexGuidelines.ts:920-953`.

Replace the supported/unsupported lists with one short paragraph:

```
# Convex Components
Convex Components are sandboxed backend modules — see <list>. Before using
one, ALWAYS call the `lookupDocs` tool with its key to get the README and
installation steps. Components are installed via `npmInstall` and registered
in `convex/convex.config.ts` (create this file if it doesn't exist).

Available components: <auto-generated from componentRegistry>.
```

The auto-generated list is short — just `- key: one-liner` for each.

### 1.5 New `installComponent` tool

New file: `chef-agent/tools/installComponent.ts`.

```ts
export const installComponentParameters = z.object({
  key: z.string().describe("Component key from the registry (e.g. 'agent')."),
});

export const installComponentTool: Tool = {
  description:
    "Install a Convex component: runs `npm install` for its package AND " +
    "creates/updates convex/convex.config.ts to register it. Always call " +
    "lookupDocs for the component first to learn its usage.",
  inputSchema: installComponentParameters,
};
```

Runtime (in `app/lib/runtime/action-runner.ts`):

1. Resolve the entry from `componentByKey`. Error if not in registry or
   not in the chat's allowlist.
2. Spawn `npm install <entry.npmPackage>` in the WebContainer.
3. Read `convex/convex.config.ts` (create with `defineApp()` skeleton if
   missing). Parse-and-edit idempotently — add `import x from
   "@convex-dev/<pkg>/convex.config";` and `app.use(x);` only if absent.
   For idempotency, simple string check is fine; AST is overkill.
4. Return a short success message including the package name and the
   reminder "call `lookupDocs` for usage if you haven't yet."

Failure modes:
- npm install fails → return stderr.
- `convex.config.ts` is malformed → fail loudly and let the model fix.

`npmInstall` stays as-is for non-component dependencies. The system prompt
instructs the model to use `installComponent` (not raw `npmInstall`) for
anything in the registry.

### 1.6 Files touched

- `chef-agent/prompts/components/registry.ts` — new
- `chef-agent/prompts/components/snapshots/*.md` — new (~25-30 files)
- `chef-agent/prompts/components/index.ts` — new, re-export
- `chef-agent/tools/lookupDocs.ts` — rewritten
- `chef-agent/tools/installComponent.ts` — new
- `chef-agent/prompts/convexGuidelines.ts:920-957` — replaced
- `app/lib/.server/llm/convex-agent.ts` — register `installComponent` tool
- `app/lib/runtime/action-runner.ts` — new case for `installComponent`,
  update `lookupDocs` case to use registry
- `app/components/chat/ToolCall.tsx` — render `installComponent` tool
  invocations; update `lookupDocs` rendering
- `scripts/fetch-component-readmes.ts` — new
- `package.json` — add `sync:components` script

---

## Phase 2 — Authoring guidance (neutrally framed)

### 2.1 Add an organization-tradeoff section

File: `chef-agent/prompts/solutionConstraints.ts`. Add a new section to
`solutionConstraints()`, gated by a flag in `SystemPromptOptions`
(default on) so it can be toggled per request.

Proposed text:

```
<organization_options>
For non-trivial apps with multiple distinct modules (e.g. a community
platform with blog + projects + chat), you have two valid organization
choices. Both are first-class. Discuss the tradeoff with the user and
pick together before scaffolding.

Option A — Feature folders:
- Group related files under `convex/<module>/` (e.g. `convex/blog/posts.ts`).
- Modules share `ctx.auth`, the `users` table, and `v.id()` types directly.
- No extra codegen, no API boundary — pure file organization.
- Best when modules cross-reference each other's data or share auth/users.

Option B — Local components:
- Each module lives in `convex/components/<name>/` with its own
  `convex.config.ts`, `schema.ts`, and functions.
- Strong isolation: each component has its own tables and sub-transactions.
- Constraints inside a component:
  - No `ctx.auth` — authenticate in the app and pass `userId` as an arg.
  - `Id<T>` becomes `string` at the component boundary.
  - All public functions need return validators (or types are `any`).
  - Use `paginator` from `convex-helpers`, not built-in `.paginate()`.
  - `process.env` is not available — pass env via args.
- Best when modules should be self-contained, swappable, or eventually
  packaged as NPM components.

When the user asks for a multi-module app, briefly explain both options
(one or two sentences each) and ask which they prefer before continuing.
Default to A only if the user explicitly says "keep it simple" or
similar — otherwise ask.
</organization_options>
```

### 2.2 Promote `authoringComponentsPrompt` discoverability

Two changes:

- Keep `lookupDocs` access (no change).
- Add one line to the new organization section above: "If the user chooses
  Option B, call `lookupDocs` with key `authoringComponents` for the full
  authoring guide."

### 2.3 Relax `template_info()` constraints

File: `chef-agent/prompts/solutionConstraints.ts:179-241`.

- Today: no mention of `convex/convex.config.ts`. Add a line noting it's
  expected to be created/maintained by the model when components are used.
- The locked-files list (`auth.config.ts`, `auth.ts`, `http.ts`,
  `SignInForm.tsx`, etc.) is fine — those don't conflict.

### 2.4 `scaffoldLocalComponent` tool

New file: `chef-agent/tools/scaffoldLocalComponent.ts`.

```ts
export const scaffoldLocalComponentParameters = z.object({
  name: z.string().describe("Component name in camelCase (e.g. 'blog')."),
});
```

Runtime (in `action-runner.ts`):

1. Validate name is a valid identifier and not already in use.
2. Create `convex/components/<name>/`:
   - `convex.config.ts` → `import { defineComponent } from "convex/server";
      const component = defineComponent("<name>"); export default component;`
   - `schema.ts` → `import { defineSchema, defineTable } from "convex/server";
      import { v } from "convex/values"; export default defineSchema({});`
   - `index.ts` → stub query exporting a `hello` function.
3. Edit parent `convex/convex.config.ts` (create if missing) to add
   `import <name> from "./components/<name>/convex.config.js";` and
   `app.use(<name>);`.

The model is expected to then iterate via `edit`/`view` to fill in the
schema and functions. This tool just handles the boilerplate.

### 2.5 Files touched

- `chef-agent/prompts/solutionConstraints.ts` — additions + minor edits
- `chef-agent/types.ts` — add optional `enableOrganizationGuidance` flag
- `app/lib/.server/llm/convex-agent.ts:89-97` — pass flag through
- (optional) `chef-agent/tools/scaffoldLocalComponent.ts` — new
- (optional) `app/lib/runtime/action-runner.ts` — new case for the tool

---

## Phase 3 — Polish

- Test for `lookupDocs` round-trip across all registry keys.
- Smoke test: model installs a component → `convex.config.ts` exists →
  `npx convex dev` succeeds. Probably belongs in `test-kitchen`.
- Refresh script for snapshots (CI cron, separate PR).
- UI tweak in `ToolCall.tsx`: render the component name nicely when
  `lookupDocs` is called (currently just shows the key list).

---

## Resolved decisions

1. **README source: snapshot at build time.** Script pulls every README,
   commits to `chef-agent/prompts/components/snapshots/`. Refresh manually
   for now.
2. **convex.config.ts bootstrap: new `installComponent` tool.** Wraps
   `npm install <pkg>` + idempotently edits `convex/convex.config.ts`.
   Replaces / supplements the model doing this by hand.
3. **`scaffoldLocalComponent` tool: ship in Phase 2** alongside authoring
   prompt edits.
4. **Registry coverage: every directory entry + per-project UI allowlist.**
   Manifest enumerates every component. Users can checkbox-select which
   components are visible to the LLM on a per-chat basis (see §4 below).
5. **Curated prompts in Phase 1: none new.** Keep the existing three
   (presence, proseMirror, resend). Long tail uses snapshots. Curated
   prompts can be added incrementally later.
6. **Organization guidance: gated behind a `SystemPromptOptions` flag,
   default true.** Allows per-request opt-out without forcing every chat
   to carry the ~500-token section.

---

## Phase 1.5 — Per-project component allowlist (new from Decision 4)

### 4.1 Schema

`convex/schema.ts`: add to the `chats` table:

```ts
// Allowlist of component keys (from componentRegistry) that the LLM is
// permitted to use in this chat. Undefined = all components allowed
// (sensible default, so existing chats keep current behavior).
enabledComponents: v.optional(v.array(v.string())),
```

No migration needed — `undefined` means "all enabled."

### 4.2 Mutation

New mutation in `convex/messages.ts` (or wherever chat-update mutations
live; will confirm during implementation):

```ts
export const setEnabledComponents = mutation({
  args: { chatId: v.string(), enabledComponents: v.union(v.array(v.string()), v.null()) },
  handler: async (ctx, args) => { /* validate keys against known registry, write */ },
});
```

Validation: keys must exist in the registry. Setting `null` clears the
allowlist (= all enabled).

### 4.3 Server-side filtering

`app/lib/.server/chat.ts` reads the chat's `enabledComponents` and passes
to `convexAgent()`. `app/lib/.server/llm/convex-agent.ts` threads it into
`SystemPromptOptions`. Two places consume the filter:

- `convexGuidelines.ts`: auto-generated "available components" list is
  filtered to only enabled keys.
- `lookupDocs` tool runtime (`action-runner.ts`): rejects keys not in the
  allowlist with a clear error so the model knows to surface it to the
  user.
- `installComponent` tool: same rejection.

### 4.4 UI

**Surface (default proposal):** new `<ComponentsButton />` in
`app/components/header/Header.tsx` (alongside `DownloadButton`,
`ShareButton`, `DeployButton`). Click opens a dialog listing every
registry entry with a checkbox + the one-line description. Grouped by
tag. Default state: all checked. "Reset to all" button.

**Files:**
- `app/components/header/ComponentsButton.tsx` — new
- `app/components/header/ComponentsDialog.tsx` — new (dialog body)
- `app/components/header/Header.tsx` — add the button
- `app/lib/stores/components.ts` (or similar) — small store binding to
  the Convex mutation/query

**Resolved defaults:**
- **Default state for new chats:** **no components enabled (opt-in model).**
  New users start with components off — keeps the experience simple for
  first-time app builders who aren't looking for components. Users who
  know what they want opt in via the dialog. Schema-wise this means
  treating `undefined` `enabledComponents` as `[]` (empty allowlist),
  not "all enabled."
- **Surface:** header button → dialog, next to ShareButton/DeployButton.

---

## Open decisions

All six original decisions resolved above. Two UI defaults flagged in §4.4
that I'll proceed with unless you push back:

- **Default state:** all components enabled.
- **UI surface:** header dialog (vs sidebar panel).

---

## Out of scope (deliberately)

- Component versioning UI (which version of `@convex-dev/agent` to install).
- Live directory crawl (the directory is HTML, no public JSON feed).
- Auto-detecting which component a user *should* use from natural language
  — that's the model's job, not the tool's.
- Publishing flow for components the user authors (NPM publish, etc.).
  Authoring guidance covers the structure; publishing is a separate task.
