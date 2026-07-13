import { router } from 'expo-router';

/** Cuando no hay historial (deep link, cold start), `router.back()` no hace nada. */
export function goBackOrHome(): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}
