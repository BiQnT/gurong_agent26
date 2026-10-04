/** Works in both secure deployments and local HTTP device previews. */
export function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  );
}
