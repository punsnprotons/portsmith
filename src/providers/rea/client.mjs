import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { version } from '../../domain/version.mjs';
import { hash, json, readJson, saveJson, safePath, safeWrite, withRunLock } from '../../platform/files.mjs';

const absolute = z.string().refine(value => path.isAbsolute(value), 'Must be an absolute path');
const configSchema = z.object({
  command: z.string().min(1), args: z.array(z.string()).default([]),
  env: z.object({ REA_DARWIN_SWIFTC_PATH: absolute.optional(), SDKROOT: absolute.optional(), REA_DARWIN_MODULE_CACHE_PATH: absolute.optional() }).strict().optional()
}).strict();
const evidenceSchema = z.object({
  evidence_id: z.string().regex(/^ev_[a-f0-9]{64}$/),
  normalized_result: z.record(z.string(), z.unknown()),
  limitations: z.array(z.string())
}).passthrough();

function evidence(response, tool) {
  if (response.isError) throw new Error(`Rea ${tool} failed: ${JSON.stringify(response.content).slice(0, 3000)}`);
  if (!response.structuredContent) throw new Error(`Rea ${tool} did not return structured evidence.`);
  return evidenceSchema.parse(response.structuredContent);
}

// Provider evidence is additional static context. It never substitutes for a behavior gate.
async function traceWithReaUnlocked({ run, state, configFile, allowExecution = false, checkIntegrity, timeoutMs = 60000 }) {
  if (allowExecution !== true) throw new Error('Starting a configured Rea process requires --allow-execution.');
  const config = configSchema.parse(await readJson(configFile));
  await checkIntegrity();
  const home = await safePath(run, 'rea-provider-home', { missing: true });
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const client = new Client({ name: 'portsmith', version });
  const transport = new StdioClientTransport({
    command: config.command, args: config.args, cwd: run, stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CACHE_HOME: path.join(home, 'cache'), XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), ...config.env }
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => { if (stderr.length < 16000) stderr += String(chunk).slice(0, 16000 - stderr.length); });
  try {
    await client.connect(transport, { timeout: timeoutMs });
    const application = evidence(await client.callTool({
      name: 'analyze_javascript_application', arguments: { input_path: path.join(run, 'source') }
    }, undefined, { timeout: timeoutMs }), 'analyze_javascript_application');
    const trace = evidence(await client.callTool({
      name: 'trace_application_feature', arguments: {
        application, seed: { kind: 'module', value: state.analysis.entry, match: 'exact', case_sensitive: true }, direction: 'outgoing'
      }
    }, undefined, { timeout: timeoutMs }), 'trace_application_feature');
    const normalized = trace.normalized_result;
    if (normalized.source_evidence_id !== application.evidence_id) throw new Error('Rea trace refers to a different application evidence record.');
    if (!Number.isInteger(normalized.summary?.matched_seeds) || normalized.summary.matched_seeds < 1) throw new Error('Rea did not match the requested module; no successful attachment was created.');
    await checkIntegrity();
    const payload = { application, trace };
    const bytes = json(payload);
    const summary = {
      version: 1, provider: 'rea', server: client.getServerVersion(), capturedAt: new Date().toISOString(),
      sourceSnapshotSha256: hash(json(state.sourceSnapshot)), entry: state.analysis.entry,
      payloadSha256: hash(bytes), applicationEvidenceId: application.evidence_id, traceEvidenceId: trace.evidence_id,
      coverage: normalized.coverage, facts: normalized.summary,
      limitations: [...new Set([...application.limitations, ...trace.limitations, ...(normalized.limitations ?? []),
        'Rea evidence is static context; Portsmith does not independently authenticate Rea graph/evidence digest algorithms.',
        'The payload is bound to the unchanged local source snapshot; behavior remains a separate Portsmith check.'])]
    };
    await safeWrite(path.join(run, 'rea-evidence.json'), bytes);
    await saveJson(path.join(run, 'rea-summary.json'), summary);
    return summary;
  } catch (error) { throw new Error(`${error.message}${stderr ? `\nRea stderr: ${stderr}` : ''}`); }
  finally { await client.close(); }
}

export const traceWithRea = options => withRunLock(options.run, () => traceWithReaUnlocked(options));

export async function reaAttachment(run, state) {
  let summary;
  try { summary = await readJson(await safePath(run, 'rea-summary.json')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const bytes = await fs.readFile(await safePath(run, 'rea-evidence.json'));
  if (summary.sourceSnapshotSha256 !== hash(json(state.sourceSnapshot)) || summary.entry !== state.analysis.entry || summary.payloadSha256 !== hash(bytes)) {
    throw new Error('Rea evidence attachment is stale or changed; rerun rea-trace.');
  }
  return summary;
}
