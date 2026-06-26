export function asCommandError(error) {
  if (error && typeof error === 'object' && typeof error.kind === 'string') {
    return error;
  }

  return {
    kind: 'Unknown',
    message: String(error),
  };
}
