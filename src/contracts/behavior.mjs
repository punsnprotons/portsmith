import { z } from 'zod';
import { relativeFile } from '../platform/files.mjs';
import { browserSchema } from './browser.mjs';

const endpoint = z.object({ module: z.string().min(1), export: z.string().min(1) }).strict();
export const contractSchema = z
  .object({
    version: z.literal(1),
    source: endpoint,
    target: endpoint,
    runtime: z
      .object({
        relativeImports: z.literal(true).optional(),
        aliases: z.literal(true).optional(),
        capturedImports: z.literal(true).optional(),
        transformTypes: z.literal(true).optional()
      })
      .refine((value) => !value.capturedImports || value.aliases, {
        message: 'capturedImports requires aliases.'
      })
      .refine((value) => value.relativeImports || value.aliases || value.transformTypes, {
        message: 'Enable at least one runtime option.'
      })
      .strict()
      .optional(),
    cases: z
      .array(
        z
          .object({
            name: z.string().min(1),
            sourceArgs: z.array(z.json()),
            targetArgs: z.array(z.json()),
            expected: z.json()
          })
          .strict()
      )
      .min(1)
      .max(100),
    regression: z
      .object({ command: z.string().min(1), args: z.array(z.string()) })
      .strict()
      .optional(),
    checks: z
      .array(
        z
          .object({ name: z.string().min(1), command: z.string().min(1), args: z.array(z.string()).max(100) })
          .strict()
      )
      .min(1)
      .max(10)
      .optional(),
    browser: browserSchema.optional()
  })
  .strict();

export function validateContract(input) {
  const contract = contractSchema.parse(input);
  relativeFile(contract.source.module);
  relativeFile(contract.target.module);
  if (new Set(contract.cases.map((c) => c.name)).size !== contract.cases.length)
    throw new Error('Contract case names must be unique.');
  if (contract.checks && new Set(contract.checks.map((c) => c.name)).size !== contract.checks.length)
    throw new Error('Check names must be unique.');
  if (contract.browser) {
    relativeFile(contract.browser.page);
    for (const cases of [contract.browser.cases, contract.browser.regression]) {
      if (new Set(cases.map((c) => c.name)).size !== cases.length)
        throw new Error('Browser case names must be unique.');
    }
    if (contract.browser.server && !contract.browser.server.args.some((arg) => arg.includes('{port}')))
      throw new Error('Browser server args must include {port} for an isolated local port.');
  }
  return contract;
}
