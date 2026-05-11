import { expect, test, describe, vi } from 'vitest';
import type { UIMessage } from 'ai';
import { compressMessages, serializeMessageForConvex } from './messages';

vi.mock('lz4-wasm', () => ({
  compress: (data: Uint8Array) => data,
  decompress: (data: Uint8Array) => data,
}));
vi.mock('~/lib/compression', () => ({
  compressWithLz4: (data: Uint8Array) => data,
}));

describe('serializeMessageForConvex', () => {
  test('preserves non-text parts', () => {
    const message: UIMessage = {
      id: 'test',
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'some content',
        },
      ],
    };

    const serialized = serializeMessageForConvex(message);

    expect(serialized.parts?.[0]).toEqual({
      type: 'text',
      text: 'some content',
    });
  });

  test('compressMessages does not mutate the source message parts', async () => {
    const message: UIMessage = {
      id: 'test',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    };

    await compressMessages([message], 0, 0);

    expect(message.parts).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]);
  });
});
