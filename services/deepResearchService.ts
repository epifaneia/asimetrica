import { useDiagnosticStore } from '@/stores/diagnostic-store';

import { GEMINI_RESEARCH_AGENT } from './geminiModels';

/**
 * Investigación profunda con el agente Deep Research de Gemini.
 *
 * NO va por `generateContent`: es la **Interactions API**, y funciona distinto de
 * todo lo demás de la app:
 *   - `background: true` es OBLIGATORIO. No hay modo síncrono.
 *   - Se lanza, se recibe un `id`, y se SONDEA con GET hasta que el estado pasa a
 *     `completed`.
 *   - Tarda MINUTOS (el techo del agente es una hora).
 *   - Cuesta ~1-3 $ por investigación.
 *
 * Ese precio es justo lo que hace que la válvula de aborto del read-back sea
 * imprescindible y no un adorno: una investigación lanzada por error son euros,
 * no céntimos. De ahí que el default sea siempre la búsqueda normal y que la
 * escalada tenga que oírse antes de gastar.
 *
 * Y como tarda minutos, el `id` se PERSISTE: si el paseo sigue, si la app se va a
 * segundo plano o si muere, el sondeo se reanuda al volver. Lo que no se puede
 * hacer es tener esto vivo solo en memoria.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const LAUNCH_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 30_000;

/** Estados posibles de una interacción (la API define ocho). */
type InteractionStatus =
  | 'queued'
  | 'in_progress'
  | 'requires_action'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
  | 'budget_exceeded';

type InteractionResponse = {
  id?: string;
  status?: InteractionStatus;
  steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  error?: { code?: number; message?: string };
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function log(stage: string, ok: boolean, error?: string, latencyMs = 0): void {
  useDiagnosticStore.getState().push({
    stage,
    model: GEMINI_RESEARCH_AGENT,
    latencyMs,
    ok,
    error,
  });
}

export type LaunchResult = { ok: true; interactionId: string } | { ok: false; error: string };

/**
 * Lanza la investigación y devuelve su id. NO espera el resultado: eso es de
 * `pollResearch`, que se llama después y tantas veces como haga falta.
 */
export async function launchDeepResearch(params: {
  apiKey: string;
  brief: string;
}): Promise<LaunchResult> {
  const brief = params.brief.trim();
  if (!brief) return { ok: false, error: 'Encargo vacío.' };
  if (!params.apiKey.trim()) return { ok: false, error: 'Falta Google API Key.' };

  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(
      BASE,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': params.apiKey.trim(),
        },
        body: JSON.stringify({
          agent: GEMINI_RESEARCH_AGENT,
          input: brief,
          // Obligatorio: este agente no tiene modo síncrono.
          background: true,
          // Necesario para poder recuperar el resultado más tarde, que es todo el
          // punto: el paseo sigue y el informe se recoge cuando esté.
          store: true,
          agent_config: {
            type: 'deep-research',
            // Sin planificación colaborativa: en modo campo no hay nadie mirando
            // la pantalla para aprobar un plan, y dejaría la interacción esperando
            // en `requires_action` para siempre.
            collaborative_planning: false,
          },
        }),
      },
      LAUNCH_TIMEOUT_MS
    );
    const data = (await res.json()) as InteractionResponse;
    if (!res.ok || !data.id) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      log('research-launch', false, msg, Date.now() - t0);
      return { ok: false, error: msg };
    }
    log('research-launch', true, `id ${data.id} · estado ${data.status ?? '?'}`, Date.now() - t0);
    return { ok: true, interactionId: data.id };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    const msg = aborted ? 'Timeout al lanzar la investigación.' : e instanceof Error ? e.message : String(e);
    log('research-launch', false, msg, Date.now() - t0);
    return { ok: false, error: msg };
  }
}

export type PollResult =
  | { state: 'running' }
  | { state: 'done'; report: string }
  | { state: 'failed'; error: string };

/** Extrae el informe del último paso con texto. */
function extractReport(data: InteractionResponse): string {
  const steps = data.steps ?? [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const text = (steps[i].content ?? [])
      .filter((c) => (c.type ?? 'text') === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

/**
 * Consulta el estado. Un fallo de red devuelve `running`, no `failed`: la
 * investigación sigue viva en el servidor y perder un sondeo no debe tirar a la
 * basura minutos ya pagados.
 */
export async function pollDeepResearch(params: {
  apiKey: string;
  interactionId: string;
}): Promise<PollResult> {
  const t0 = Date.now();
  try {
    const res = await fetchWithTimeout(
      `${BASE}/${encodeURIComponent(params.interactionId)}`,
      { method: 'GET', headers: { 'x-goog-api-key': params.apiKey.trim() } },
      POLL_TIMEOUT_MS
    );
    const data = (await res.json()) as InteractionResponse;
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      // 404 y 403 sí son definitivos: la interacción no existe o no es nuestra.
      if (res.status === 404 || res.status === 403) {
        log('research-poll', false, msg, Date.now() - t0);
        return { state: 'failed', error: msg };
      }
      return { state: 'running' };
    }

    switch (data.status) {
      case 'completed': {
        const report = extractReport(data);
        if (!report) {
          /**
           * Escenario peor: la investigación se pagó y el informe no se encuentra
           * donde lo buscamos. Se vuelca la FORMA REAL de la respuesta en
           * Diagnóstico — claves de nivel superior, cuántos pasos y de qué tipos —
           * para poder arreglar la ruta de extracción con un solo dato en vez de a
           * ciegas. Sin esto, un cambio en el contrato sería dinero perdido en
           * silencio.
           */
          const shape = [
            `claves: ${Object.keys(data).join(',')}`,
            `pasos: ${(data.steps ?? []).length}`,
            `tipos: ${(data.steps ?? []).map((s) => s.type ?? '?').join('|') || 'ninguno'}`,
            `contenidos: ${(data.steps ?? [])
              .map((s) => (s.content ?? []).map((c) => c.type ?? '?').join('+') || '-')
              .join('|')}`,
          ].join(' · ');
          log('research-poll', false, `completada SIN informe → ${shape}`, Date.now() - t0);
          return { state: 'failed', error: 'La investigación terminó sin informe.' };
        }
        log('research-poll', true, `completada · ${report.length} chars`, Date.now() - t0);
        return { state: 'done', report };
      }
      case 'failed':
      case 'cancelled':
      case 'budget_exceeded':
      case 'incomplete': {
        const msg = data.error?.message ?? `La investigación terminó en estado ${data.status}.`;
        log('research-poll', false, msg, Date.now() - t0);
        return { state: 'failed', error: msg };
      }
      case 'requires_action': {
        // No debería pasar con collaborative_planning en false; si pasa, nadie va a
        // atenderlo desde el bolsillo, así que se corta en vez de esperar eternamente.
        log('research-poll', false, 'la investigación pide intervención', Date.now() - t0);
        return { state: 'failed', error: 'La investigación pide intervención y no puede seguir sola.' };
      }
      default:
        return { state: 'running' };
    }
  } catch {
    return { state: 'running' };
  }
}
