import type { z, ZodSafeParseResult } from 'zod';

const previouslySeen: WeakSet<any> = new WeakSet();

export function loggingSafeParse<Output>(
  schema: z.ZodType<Output>,
  args: any,
): ZodSafeParseResult<Output> {
  const result = schema.safeParse(args);
  if (!result.success && !previouslySeen.has(args)) {
    if (typeof args === 'object' && args !== null) {
      console.error('Failed to parse zod', args, result.error);
      previouslySeen.add(args);
    }
  }
  return result;
}
