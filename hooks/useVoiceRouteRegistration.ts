import type { VoiceRouteTarget } from '@/stores/voice-route-store';
import { useVoiceRouteStore } from '@/stores/voice-route-store';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

function toTarget(kind: 'document' | 'folder' | 'dashboard' | 'off', id?: string): VoiceRouteTarget {
  if (kind === 'off') return null;
  if (kind === 'dashboard') return { kind: 'dashboard' };
  if (kind === 'document' && id) return { kind: 'document', documentId: id };
  if (kind === 'folder' && id) return { kind: 'folder', folderId: id };
  return null;
}

/**
 * Al enfocar la pantalla, define dónde se guarda la voz. `off` oculta el dock (p. ej. Ajustes).
 */
export function useVoiceRouteRegistration(
  kind: 'document' | 'folder' | 'dashboard' | 'off',
  id?: string
) {
  const setVoiceTarget = useVoiceRouteStore((s) => s.setVoiceTarget);

  useFocusEffect(
    useCallback(() => {
      setVoiceTarget(toTarget(kind, id));
    }, [kind, id, setVoiceTarget])
  );
}
