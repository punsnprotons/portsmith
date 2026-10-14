/** Public application API. Importing this module does not start a server or process. */
export { executeCommand, commandResult, capabilities, schemaFor, transferReport, version } from './application/service.mjs';
export { analyze } from './providers/javascript/analyze.mjs';
export { planTransfer } from './application/planning.mjs';
export { prepare, adapt, verify, exportPatch, status } from './application/transfer.mjs';
export { PortsmithError, diagnostic } from './domain/errors.mjs';

export { autoAdapt } from './application/autonomous.mjs';
