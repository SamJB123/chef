import type { Tool } from 'ai';
import { presenceComponentReadmePrompt } from 'chef-agent/prompts/components/presence';
import { proseMirrorComponentReadmePrompt } from 'chef-agent/prompts/components/proseMirror';
import { authoringComponentsPrompt } from 'chef-agent/prompts/components/authoringComponents';
import { z } from 'zod';
import { resendComponentReadmePrompt } from 'chef-agent/prompts/components/resend';

export const lookupDocsParameters = z.object({
  docs: z
    .array(z.string())
    .describe(
      'List of features to look up in the documentation. You should look up all the docs for the features you are implementing.',
    ),
});

export function lookupDocsTool(): Tool {
  return {
    description: `Lookup documentation for a list of features. Valid features to lookup are: \`proseMirror\` (collaborative text editing), \`presence\` (live user presence/cursors), and \`authoringComponents\` (building reusable Convex components with isolated schemas and functions)`,
    inputSchema: lookupDocsParameters,
  };
}

export type LookupDocsParameters = z.infer<typeof lookupDocsParameters>;

// Documentation content that can be looked up
export const docs = {
  proseMirror: proseMirrorComponentReadmePrompt,
  presence: presenceComponentReadmePrompt,
  resend: resendComponentReadmePrompt,
  authoringComponents: authoringComponentsPrompt,
} as const;

export type DocKey = keyof typeof docs;
