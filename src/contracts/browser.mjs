import { z } from 'zod';

const selector = z.string().min(1).max(1000);
const step = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fill'), selector, value: z.string() }).strict(),
  z.object({ action: z.literal('click'), selector }).strict(),
  z.object({ action: z.literal('press'), selector, key: z.string().min(1) }).strict(),
  z.object({ action: z.literal('check'), selector, checked: z.boolean() }).strict()
]);
const assertion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), selector, expected: z.string() }).strict(),
  z.object({ kind: z.literal('count'), selector, expected: z.number().int().min(0) }).strict(),
  z.object({ kind: z.literal('visible'), selector, expected: z.boolean() }).strict(),
  z.object({ kind: z.literal('value'), selector, expected: z.string() }).strict()
]);
const scenario = z
  .object({
    name: z.string().min(1),
    steps: z.array(step).max(30),
    assertions: z.array(assertion).min(1).max(30)
  })
  .strict();
export const browserSchema = z
  .object({
    page: z.string().default('index.html'),
    server: z
      .object({ command: z.string().min(1), args: z.array(z.string()).max(50) })
      .strict()
      .optional(),
    cases: z.array(scenario).min(1).max(30),
    regression: z.array(scenario).min(1).max(30),
    actionTimeoutMs: z.number().int().min(100).max(10000).default(1500)
  })
  .strict();
