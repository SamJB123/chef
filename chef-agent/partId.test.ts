import { describe, expect, test } from 'vitest';
import { makePartIdForPart, parsePartId } from './partId.js';

describe('partId', () => {
  test('uses toolCallId instead of array index for tool parts', () => {
    const firstParts = [
      { type: 'step-start' },
      { type: 'text', text: 'First text' },
      { type: 'tool-lookupDocs', toolCallId: 'toolu_123' },
    ];
    const nextParts = [
      ...firstParts,
      { type: 'step-start' },
      { type: 'text', text: 'Second text' },
      { type: 'tool-installComponent', toolCallId: 'toolu_456' },
    ];

    expect(makePartIdForPart('message-1', firstParts, 2)).toBe(makePartIdForPart('message-1', nextParts, 2));
    expect(makePartIdForPart('message-1', nextParts, 5)).toContain('toolu_456');
  });

  test('parses message ids that contain hyphens', () => {
    const partId = makePartIdForPart('message-with-hyphens', [{ type: 'text', text: 'Hello' }], 0);

    expect(parsePartId(partId).messageId).toBe('message-with-hyphens');
  });
});
