import type { Tool } from 'ai';
import { z } from 'zod';

export const scaffoldLocalComponentParameters = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]*$/, 'name must be a camelCase identifier (e.g. "blog", "projectTasks")')
    .describe('Component name as a camelCase identifier. Used for the folder name, the registered name in app.use(), and the import binding.'),
});

export type ScaffoldLocalComponentParameters = z.infer<typeof scaffoldLocalComponentParameters>;

export const scaffoldLocalComponentTool: Tool = {
  description: [
    'Scaffold a new LOCAL Convex component for organizing the app as multiple',
    'isolated modules (Option B in the organization_options guide). Creates:',
    '  - convex/components/<name>/convex.config.ts',
    '  - convex/components/<name>/schema.ts',
    '  - convex/components/<name>/index.ts (a stub query)',
    'and adds `app.use(<name>)` to convex/convex.config.ts (creating it if absent).',
    '',
    "After scaffolding, fill in the component's schema and functions via edit().",
    "Inside the component, remember: no ctx.auth, IDs become strings at the",
    'boundary, public functions need return validators, and pagination must use',
    "`paginator` from `convex-helpers` rather than the built-in `.paginate()`.",
    '',
    'Use `installComponent` (NOT this tool) for components from the registry.',
    'Use this tool ONLY when the user wants a custom, locally-defined component.',
  ].join('\n'),
  inputSchema: scaffoldLocalComponentParameters,
};
