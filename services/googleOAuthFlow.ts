import { useUserSettingsStore } from '@/stores/user-settings-store';
import { Alert } from 'react-native';
import {
  AuthRequest,
  ResponseType,
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
} from 'expo-auth-session';

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

const DRIVE_DOCS_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
];

export function getGoogleOAuthRedirectUri(): string {
  return makeRedirectUri({ path: 'google-auth' });
}

/**
 * Cliente OAuth de tipo **Android** en GCP (paquete `app.asimetrica` + SHA-1 de
 * la firma). Ajustes o EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID.
 *
 * NO sirve un cliente «Aplicación de escritorio» ni «web»: aquí redirigimos con
 * esquema propio (`app.asimetrica:///google-auth`) y Google solo lo admite en
 * clientes Android/iOS. Con uno de escritorio la autorización se rechaza con «no
 * cumple la política de OAuth 2.0» (los de escritorio solo aceptan localhost, y
 * el flujo OOB está retirado desde 2022).
 */
export function resolveGoogleOAuthClientId(stored: string): string {
  const t = stored.trim();
  if (t) return t;
  return process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?.trim() ?? '';
}

function accessExpiryMs(tr: { issuedAt: number; expiresIn?: number }): number {
  const sec = tr.expiresIn ?? 3600;
  return (tr.issuedAt + sec) * 1000;
}

function persistGoogleTokens(
  tr: { accessToken: string; issuedAt: number; expiresIn?: number; refreshToken?: string },
  previousRefresh?: string
) {
  const refresh = (tr.refreshToken?.trim() || previousRefresh?.trim() || '').trim();
  useUserSettingsStore.setState({
    googleAccessToken: tr.accessToken,
    googleAccessExpiryMs: accessExpiryMs(tr),
    googleRefreshToken: refresh,
  });
}

/**
 * Variante SILENCIOSA: token válido o refrescable, o null. Jamás abre navegador
 * ni muestra alertas — para flujos automáticos (auto-export al cerrar sesión).
 */
export async function getGoogleAccessTokenSilently(): Promise<string | null> {
  const clientId = resolveGoogleOAuthClientId(useUserSettingsStore.getState().googleOAuthClientId);
  if (!clientId) return null;
  const s = useUserSettingsStore.getState();
  if (s.googleAccessToken && s.googleAccessExpiryMs > Date.now() + 30_000) {
    return s.googleAccessToken;
  }
  if (!s.googleRefreshToken) return null;
  try {
    const tr = await refreshAsync({ clientId, refreshToken: s.googleRefreshToken }, GOOGLE_DISCOVERY);
    persistGoogleTokens(tr, s.googleRefreshToken);
    return tr.accessToken;
  } catch {
    return null;
  }
}

/**
 * Devuelve un access token válido para Drive/Docs, refrescando o abriendo el navegador de consentimiento.
 */
export async function ensureGoogleAccessToken(): Promise<string | null> {
  const clientId = resolveGoogleOAuthClientId(useUserSettingsStore.getState().googleOAuthClientId);
  if (!clientId) {
    Alert.alert(
      'Google Docs',
      'Configura el ID de cliente OAuth en Ajustes (o EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID en .env). En Google Cloud: cliente de tipo «Android», paquete app.asimetrica y la huella SHA-1 de tu firma. Los clientes de escritorio y web no valen con esquema propio.'
    );
    return null;
  }

  const s = useUserSettingsStore.getState();
  const now = Date.now();
  if (s.googleAccessToken && s.googleAccessExpiryMs > now + 30_000) {
    return s.googleAccessToken;
  }

  if (s.googleRefreshToken) {
    try {
      const tr = await refreshAsync(
        { clientId, refreshToken: s.googleRefreshToken },
        GOOGLE_DISCOVERY
      );
      persistGoogleTokens(tr, s.googleRefreshToken);
      return tr.accessToken;
    } catch {
      useUserSettingsStore.getState().clearGoogleOAuth();
    }
  }

  const redirectUri = getGoogleOAuthRedirectUri();
  const request = new AuthRequest({
    clientId,
    scopes: DRIVE_DOCS_SCOPES,
    redirectUri,
    responseType: ResponseType.Code,
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });

  const result = await request.promptAsync(GOOGLE_DISCOVERY);
  if (result.type !== 'success' || !result.params?.code) {
    return null;
  }

  const tr = await exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      extraParams: { code_verifier: request.codeVerifier ?? '' },
    },
    GOOGLE_DISCOVERY
  );

  persistGoogleTokens(tr, s.googleRefreshToken);
  return tr.accessToken;
}

export function clearGoogleSession() {
  useUserSettingsStore.getState().clearGoogleOAuth();
}
