import { useSyncExternalStore } from 'react';

let isMountedSnapshot = false;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  if (!isMountedSnapshot) {
    isMountedSnapshot = true;
    queueMicrotask(() => {
      listeners.forEach((l) => l());
    });
  }
  return () => {
    listeners.delete(callback);
  };
}

export function useIsMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isMountedSnapshot,
    () => false
  );
}
