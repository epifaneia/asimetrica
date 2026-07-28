import type { Dissertation } from '@/stores/folders-store';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/**
 * Exportación a Google Docs usando SOLO Drive.
 *
 * Antes esto creaba un Doc vacío con Drive y le metía el texto con la API de Docs
 * (`batchUpdate`, troceado). El problema no era técnico: el scope
 * `auth/documents` es **sensible** para Google, y eso arrastra verificación de la
 * app y, con la pantalla de consentimiento en "Testing", refresh tokens que
 * CADUCAN A LOS 7 DÍAS — o sea, el auto-export silencioso se rompía cada semana.
 *
 * Drive convierte solo: si subes el contenido con `mimeType` de Google Doc en los
 * metadatos, él hace la conversión. Así queda únicamente `auth/drive.file`, que NO
 * es sensible (y encima es el scope estrecho que Google recomienda: solo ve los
 * archivos que crea esta app, nada más de tu Drive).
 *
 * Ventaja de propina: subiendo HTML en vez de texto plano, los títulos salen como
 * títulos de verdad en el Doc, no como texto en negrita imitando un título.
 */

/** Etiquetas de autoría, iguales que en el compartir: nunca se funde quién dijo qué. */
const SPEAKER_SELF = 'Tú';
const SPEAKER_AI = 'Interlocutor';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Texto plano → párrafos HTML, respetando los saltos del original. */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${esc(block).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

function dissertationToHtmlBlock(d: Dissertation, headingLevel: 1 | 2 = 1): string {
  const h = `h${headingLevel}`;
  const out: string[] = [`<${h}>${esc(d.title)}</${h}>`];
  if (d.messages.length > 0) {
    for (const m of d.messages) {
      out.push(`<h3>${m.role === 'model' ? SPEAKER_AI : SPEAKER_SELF}</h3>`);
      out.push(paragraphs(m.content));
    }
  } else if (d.body.trim()) {
    out.push(paragraphs(d.body));
  }
  return out.join('\n');
}

function htmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>\n${bodyHtml}\n</body></html>`;
}

/**
 * Sube el contenido y deja que Drive lo convierta a Google Doc. Multipart a mano:
 * los metadatos en la primera parte, el HTML en la segunda.
 */
async function driveUploadAsDoc(
  accessToken: string,
  title: string,
  html: string,
  parentFolderId?: string
): Promise<string> {
  const boundary = `asimetrica-${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: title.slice(0, 200),
    mimeType: 'application/vnd.google-apps.document', // ← esto dispara la conversión
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
  };
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/html; charset=UTF-8\r\n\r\n' +
    `${html}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Drive: HTTP ${res.status}`);
  }
  if (!data.id) throw new Error('Drive no devolvió id del documento.');
  return data.id;
}

async function driveCreateFolder(accessToken: string, name: string): Promise<string> {
  const res = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: name.slice(0, 200),
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Drive: HTTP ${res.status}`);
  }
  if (!data.id) throw new Error('Drive no devolvió id de la carpeta.');
  return data.id;
}

/** Sello legible para el nombre de la carpeta en Drive: cada export es una carpeta distinta. */
function exportStamp(): string {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}, ${hh}:${mm}`;
}

/**
 * Exporta una carpeta como carpeta de Drive con UN Google Doc por disertación
 * (nada de concatenar todo en un solo documento). El nombre lleva fecha y hora:
 * Drive permite carpetas homónimas y sin sello los re-exports serían gemelos
 * indistinguibles. Secuencial a propósito: evita rate limits de Drive/Docs.
 * Los fallos por doc no abortan el lote.
 */
export async function exportFolderAsIndividualDocs(params: {
  accessToken: string;
  folderName: string;
  dissertations: Dissertation[];
  onProgress?: (done: number, total: number) => void;
}): Promise<{ folderUrl: string; exported: number; failedTitles: string[] }> {
  const { accessToken, folderName, dissertations, onProgress } = params;
  const driveFolderId = await driveCreateFolder(
    accessToken,
    `Asimétrica — ${folderName} · ${exportStamp()}`
  );

  let exported = 0;
  const failedTitles: string[] = [];
  for (const d of dissertations) {
    try {
      await driveUploadAsDoc(
        accessToken,
        d.title.slice(0, 200),
        htmlDocument(d.title, dissertationToHtmlBlock(d)),
        driveFolderId
      );
      exported += 1;
    } catch {
      failedTitles.push(d.title);
    }
    onProgress?.(exported + failedTitles.length, dissertations.length);
  }

  return {
    folderUrl: `https://drive.google.com/drive/folders/${driveFolderId}`,
    exported,
    failedTitles,
  };
}

/** Una disertación → un Google Doc en la cuenta del usuario (misma API que la exportación por carpeta). */
export async function exportDissertationToGoogleDoc(params: {
  accessToken: string;
  dissertation: Dissertation;
}): Promise<{ docId: string; webUrl: string }> {
  const { accessToken, dissertation: d } = params;
  const title = `Asimétrica — ${d.title}`.slice(0, 200);
  const html = htmlDocument(
    title,
    `${dissertationToHtmlBlock(d)}\n<p><i>Exportado desde Asimétrica · ${exportStamp()}</i></p>`
  );
  const docId = await driveUploadAsDoc(accessToken, title, html);
  return {
    docId,
    webUrl: `https://docs.google.com/document/d/${docId}/edit`,
  };
}

// ----------------------------------------------------------------------------
// Compilación para NotebookLM (concat plano con separadores visuales fuertes).
// ----------------------------------------------------------------------------

/**
 * Concatena todas las disertaciones de una carpeta (y sus auto-clusters anidados,
 * si el caller las pasa flatten-eadas) en un único Google Doc.
 *
 * Sin paso por LLM. Pensado para subir a NotebookLM como fuente única: cada
 * disertación va con su encabezado real (h2), que es mejor pista de estructura
 * para NotebookLM que las líneas de iguales que se usaban antes.
 */
export async function compileFolderForNotebookLm(params: {
  accessToken: string;
  folderName: string;
  dissertations: Dissertation[];
}): Promise<{ docId: string; webUrl: string }> {
  const { accessToken, folderName, dissertations } = params;
  const title = `Asimétrica — ${folderName} (NotebookLM)`.slice(0, 200);

  const body = [
    `<h1>${esc(`Asimétrica — ${folderName}`)}</h1>`,
    `<p><i>${dissertations.length} conversacion${dissertations.length === 1 ? '' : 'es'} · compilado ${esc(exportStamp())}</i></p>`,
    ...dissertations.map((d) => dissertationToHtmlBlock(d, 2)),
  ].join('\n<hr/>\n');

  const docId = await driveUploadAsDoc(accessToken, title, htmlDocument(title, body));
  return {
    docId,
    webUrl: `https://docs.google.com/document/d/${docId}/edit`,
  };
}
