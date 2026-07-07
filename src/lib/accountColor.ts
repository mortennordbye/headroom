// Map a connected-account key to a stable categorical chart token, so the same
// account reads the same color across the ledger badges and the Settings list.
const ACCOUNT_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];

export function accountToken(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return ACCOUNT_TOKENS[Math.abs(hash) % ACCOUNT_TOKENS.length];
}
