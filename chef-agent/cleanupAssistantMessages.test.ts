import { describe, expect, test } from 'vitest';
import type { UIMessage } from 'ai';
import { cleanupAssistantMessages } from './cleanupAssistantMessages.js';

describe('cleanupAssistantMessages', () => {
  test('drops incomplete v6 tool calls instead of sending unpaired tool_use blocks', async () => {
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'make me an app' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'text', text: 'I will look that up.' },
          {
            type: 'tool-lookupDocs',
            toolCallId: 'toolu_incomplete',
            state: 'input-available',
            input: { query: 'geospatial' },
          },
        ],
      },
    ];

    const modelMessages = await cleanupAssistantMessages(messages);

    expect(modelMessages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'make me an app' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'I will look that up.' }],
      },
    ]);
  });
});
