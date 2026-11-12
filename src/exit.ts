// Stable exit codes, so an agent can branch on the outcome of a command.
export const Exit = {
  ok: 0,
  error: 1, // generic failure
  failed: 2, // a print ended in FAILED (watch)
  timeout: 3, // watch gave up waiting
  config: 4, // missing/broken config, access code or cloud token
  connection: 5, // could not reach or authenticate to the printer
  usage: 64, // bad command-line usage
} as const;

export type ExitCode = (typeof Exit)[keyof typeof Exit];
