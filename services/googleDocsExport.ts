import type { Dissertation } from '@/stores/folders-store';

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DOCS_BATCH = (id: string) => `https://docs.googleapis.com/v1/documents/${id}:batchUpdate`;

/** Troceo conservador para batchUpdate (límite del API). */
const CHUNK = 4500;

function dissertationToTextBlock(d: Dissertation): string {
  const blocks: string[] = [];
  blocks.push(`${d.title}\n${'─'.repeat(Math.min(48, Math.max(8, d.title.length)))}\n\n`);
  if (d.messages.length > 0) {
    for (const m of d.messages) {
      const label = m.role === 'model' ? 'Asistente' : 'Tú';
      blocks.push(`${label}\n${m.content}\n\n`);
    }
  } else if (d.body.trim()) {
    blocks.push(`${d.body.trim()}\n\n`);
  }
  return blocks.join('');
}

function formatFolderExportBody(folderName: string, dissertations: Dissertation[]): string {
  const header = `Asimétrica — ${folderName}\nExportado ${new Date().toISOString()}\n\n`;
  const blocks: string[] = [header];
  for (const d of dissertations) {
    blocks.push(dissertationToTextBlock(d));
    blocks.push('\n');
  }
  return blocks.join('');
}

async function driveCreateEmptyDoc(accessToken: string, title: string): Promise<string> {
  const res = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: title.slice(0, 200),
      mimeType: 'application/vnd.google-apps.document',
    }),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Drive: HTTP ${res.status}`);
  }
  if (!data.id) throw new Error('Drive no devolvió id del documento.');
  return data.id;
}

async function docsInsertAll(accessToken: string, documentId: string, fullText: string) {
  let index = 1;
  for (let i = 0; i < fullText.length; i += CHUNK) {
    const chunk = fullText.slice(i, i + CHUNK);
    const res = await fetch(DOCS_BATCH(documentId), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{ insertText: { location: { index }, text: chunk } }],
      }),
    });
    const data = (await res.json()) as { error?: { message?: string } };
    if (!res.ok) {
      throw new Error(data.error?.message ?? `Docs: HTTP ${res.status}`);
    }
    index += chunk.length;
  }
}

export async function exportFolderToGoogleDoc(params: {
  accessToken: string;
  folderName: string;
  dissertations: Dissertation[];
}): Promise<{ docId: string; webUrl: string }> {
  const { accessToken, folderName, dissertations } = params;
  const title = `Asimétrica — ${folderName}`.slice(0, 200);
  const body = formatFolderExportBody(folderName, dissertations);
  const docId = await driveCreateEmptyDoc(accessToken, title);
  await docsInsertAll(accessToken, docId, body);
  return {
    docId,
    webUrl: `https://docs.google.com/document/d/${docId}/edit`,
  };
}

/** Una disertación → un Google Doc en la cuenta del usuario (misma API que la exportación por carpeta). */
export async function exportDissertationToGoogleDoc(params: {
  accessToken: string;
  dissertation: Dissertation;
}): Promise<{ docId: string; webUrl: string }> {
  const { accessToken, dissertation: d } = params;
  const title = `Asimétrica — ${d.title}`.slice(0, 200);
  const body = `Asimétrica\nExportado ${new Date().toISOString()}\n\n${dissertationToTextBlock(d)}`;
  const docId = await driveCreateEmptyDoc(accessToken, title);
  await docsInsertAll(accessToken, docId, body);
  return {
    docId,
    webUrl: `https://docs.google.com/document/d/${docId}/edit`,
  };
}

// ----------------------------------------------------------------------------
// Compilación para NotebookLM (concat plano con separadores visuales fuertes).
// ----------------------------------------------------------------------------

const NLM_SEP = '='.repeat(72);

function dissertationToNotebookBlock(d: Dissertation): string {
  const lines: string[] = [];
  lines.push(NLM_SEP);
  lines.push(d.title.toUpperCase());
  lines.push(NLM_SEP);
  lines.push(`Creado: ${d.createdAt}  ·  Actualizado: ${d.updatedAt}`);
  if (d.lineage && d.lineage !== 'original') {
    lines.push(`Origen: ${d.lineage}`);
  }
  lines.push('');

  if (d.messages.length > 0) {
    for (const m of d.messages) {
      lines.push(m.role === 'model' ? 'IA:' : 'Tú:');
      lines.push(m.content);
      lines.push('');
    }
  } else if (d.body.trim()) {
    lines.push(d.body.trim());
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Concatena todas las disertaciones de una carpeta (y sus auto-clusters anidados,
 * si el caller las pasa flatten-eadas) en un único Google Doc.
 *
 * Sin paso por LLM. Pensado para subir a NotebookLM como fuente única — los
 * separadores visuales fuertes facilitan que NotebookLM detecte chunks.
 */
export async function compileFolderForNotebookLm(params: {
  accessToken: string;
  folderName: string;
  dissertations: Dissertation[];
}): Promise<{ docId: string; webUrl: string }> {
  const { accessToken, folderName, dissertations } = params;
  const title = `Asimétrica — ${folderName} (NotebookLM)`.slice(0, 200);

  const lines: string[] = [];
  lines.push(`Asimétrica — ${folderName}`);
  lines.push(`Exportado: ${new Date().toISOString()}`);
  lines.push(`Disertaciones: ${dissertations.length}`);
  lines.push('');

  for (const d of dissertations) {
    lines.push(dissertationToNotebookBlock(d));
    lines.push('');
  }
  const body = lines.join('\n');

  const docId = await driveCreateEmptyDoc(accessToken, title);
  await docsInsertAll(accessToken, docId, body);
  return {
    docId,
    webUrl: `https://docs.google.com/document/d/${docId}/edit`,
  };
}
