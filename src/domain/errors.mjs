export class PortsmithError extends Error {
  constructor(code, message, remediation, details = {}, { retryable = false } = {}) {
    super(message);
    this.name = 'PortsmithError';
    Object.assign(this, { code, remediation, details, retryable });
  }
}

export function diagnostic(error) {
  if (error instanceof PortsmithError) return { code: error.code, message: error.message, remediation: error.remediation, details: error.details, retryable: error.retryable };
  if (error?.name === 'ZodError') return { code: 'invalid_input', message: 'Input does not match the command contract.', remediation: 'Run portsmith schema --command COMMAND and correct the listed fields.', details: { issues: error.issues }, retryable: false };
  const fileErrors = {
    ENOENT: ['path_not_found', 'Check the supplied paths. Source, destination and output parent directories must exist.'],
    EEXIST: ['path_exists', 'Choose a fresh output directory. Existing runs are never overwritten.'],
    EACCES: ['permission_denied', 'Choose paths readable and writable by your current user.'],
    EPERM: ['permission_denied', 'Check filesystem or process permissions; use a workspace you own.']
  };
  if (fileErrors[error?.code]) {
    const [code, remediation] = fileErrors[error.code];
    return { code, message: error.message, remediation, details: { path: error.path ?? null }, retryable: false };
  }
  return { code: 'operation_failed', message: error?.message ?? String(error), remediation: 'Review this diagnostic, run portsmith doctor, and inspect the run with portsmith status --run DIR.', details: {}, retryable: false };
}
