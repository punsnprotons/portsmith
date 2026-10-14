import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Protocol test double only. Real provider execution is a separate recorded check.
const mode = process.argv[2];
const applicationId = 'ev_' + 'a'.repeat(64);
const server = new McpServer({ name: 'rea-protocol-double', version: 'test' });
const envelope = (id, normalized_result) => ({ evidence_id: id, normalized_result, limitations: ['Protocol test double; not real Rea analysis.'] });
const result = structuredContent => ({ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] });
server.registerTool('analyze_javascript_application', { inputSchema: { input_path: z.string() } }, async () => {
  if (mode === 'error') return { isError: true, content: [{ type: 'text', text: 'provider unavailable' }] };
  return result(envelope(applicationId, { graph: {} }));
});
server.registerTool('trace_application_feature', {
  inputSchema: { application: z.any(), seed: z.any(), direction: z.string() }
}, async () => result(envelope('ev_' + 'b'.repeat(64), {
  source_evidence_id: mode === 'wrong-source' ? 'ev_' + 'c'.repeat(64) : applicationId,
  summary: { matched_seeds: mode === 'no-match' ? 0 : 1, traced_nodes: 2 },
  coverage: { status: mode === 'no-match' ? 'no-match' : 'complete-within-source' }, limitations: []
})));
await server.connect(new StdioServerTransport());
