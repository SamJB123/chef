import type { Tool } from 'ai';
import { z } from 'zod';

const editToolDescription = `
Replace a string of text that appears exactly once in a file with a
new string of text. Use this tool when fixing a bug or making a
small tweak to a file.

You MUST know a file's current contents before using this tool. This may
either be from context or previous use of the \`view\` tool.

Do NOT use this tool to create files, rewrite whole files, or make broad
multi-file changes. For creating new files or rewriting whole files, write a
\`<boltArtifact>\` with \`<boltAction type="file">\` entries in your response.

The \`old\` and \`new\` parameters should be short targeted fragments, not full
file contents.
`;

export const editToolParameters = z.object({
  path: z.string().describe('The absolute path to the file to edit.'),
  old: z.string().describe('The short fragment of text to replace. Do not pass full file contents.'),
  new: z.string().describe('The short replacement fragment. Do not pass full file contents.'),
});

export const editTool: Tool = {
  description: editToolDescription,
  inputSchema: editToolParameters,
};
