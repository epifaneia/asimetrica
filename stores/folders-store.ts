import type { ChatTurn } from '@/services/aiService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Una carpeta puede ser de usuario (creada manualmente como tema) o auto-cluster
 * (creada por el sistema al hacer un fork sobre una conversación). Las auto-cluster
 * pueden anidarse dentro de carpetas de usuario para mantener junta la genealogía.
 */
export type FolderKind = 'user' | 'auto-cluster';

export type Folder = {
  id: string;
  name: string;
  /** Carpeta padre. `undefined` = raíz (visible en dashboard). */
  parentFolderId?: string;
  kind: FolderKind;
  createdAt: string;
  updatedAt: string;
};

export type DissertationLineage = 'original' | 'continue-from' | 'merge';

export type Dissertation = {
  id: string;
  folderId: string;
  title: string;
  body: string;
  /** Historial para Gemini (alternancia user/model). */
  messages: ChatTurn[];
  /** Conv origen si esto es un continue-from. */
  parentId?: string;
  /** Convs origen si esto es un merge. */
  mergedFromIds?: string[];
  lineage: DissertationLineage;
  createdAt: string;
  updatedAt: string;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeFolderRaw(raw: Record<string, unknown>): Folder {
  const name = String(raw.name ?? raw.nombre ?? '').trim() || 'Carpeta';
  const createdAt = String(raw.createdAt ?? new Date().toISOString());
  const updatedAt = String(raw.updatedAt ?? raw.createdAt ?? createdAt);
  const parentFolderIdRaw = raw.parentFolderId;
  const kindRaw = String(raw.kind ?? '').trim();
  const kind: FolderKind = kindRaw === 'auto-cluster' ? 'auto-cluster' : 'user';
  return {
    id: String(raw.id ?? newId()),
    name,
    parentFolderId:
      typeof parentFolderIdRaw === 'string' && parentFolderIdRaw.trim()
        ? parentFolderIdRaw.trim()
        : undefined,
    kind,
    createdAt,
    updatedAt,
  };
}

function normalizeChatMessages(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const role: 'user' | 'model' = o.role === 'model' ? 'model' : 'user';
    const content = String(o.content ?? '');
    if (content.length > 0) out.push({ role, content });
  }
  return out;
}

function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0);
  return out.length > 0 ? out : undefined;
}

function normalizeDissertationRaw(raw: Record<string, unknown>): Dissertation {
  const createdAt = String(raw.createdAt ?? new Date().toISOString());
  const updatedAt = String(raw.updatedAt ?? raw.createdAt ?? createdAt);
  const bodyRaw = String(raw.body ?? '');
  const fromPersistence = normalizeChatMessages(raw.messages);
  const messages: ChatTurn[] =
    fromPersistence.length > 0
      ? fromPersistence
      : bodyRaw.trim()
        ? [{ role: 'user', content: bodyRaw }]
        : [];
  const body =
    messages.length > 0 ? messages.map((m) => m.content).join('\n\n') : bodyRaw;
  const lineageRaw = String(raw.lineage ?? '').trim();
  const lineage: DissertationLineage =
    lineageRaw === 'continue-from' || lineageRaw === 'merge' ? lineageRaw : 'original';
  const parentIdRaw = raw.parentId;
  return {
    id: String(raw.id ?? newId()),
    folderId: String(raw.folderId ?? ''),
    title: String(raw.title ?? 'Disertación').trim().slice(0, 200) || 'Disertación',
    body,
    messages,
    parentId:
      typeof parentIdRaw === 'string' && parentIdRaw.trim() ? parentIdRaw.trim() : undefined,
    mergedFromIds: normalizeStringArray(raw.mergedFromIds),
    lineage,
    createdAt,
    updatedAt,
  };
}

function mapRawListToFolders(list: unknown): Folder[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) =>
    item && typeof item === 'object'
      ? normalizeFolderRaw(item as Record<string, unknown>)
      : {
          id: newId(),
          name: 'Carpeta',
          kind: 'user' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
  );
}

function mapRawListToDissertations(list: unknown): Dissertation[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) =>
    item && typeof item === 'object'
      ? normalizeDissertationRaw(item as Record<string, unknown>)
      : {
          id: newId(),
          folderId: '',
          title: 'Disertación',
          body: '',
          messages: [],
          lineage: 'original' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
  );
}

export function createExampleFolders(): Folder[] {
  // Producto: una sola carpeta neutra de arranque, nada de datos demo.
  const now = new Date().toISOString();
  return [
    {
      id: 'seed-notas',
      name: 'Notas de campo',
      kind: 'user',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

// ----------------------------------------------------------------------------
// Helpers de jerarquía (puros, no leen del store)
// ----------------------------------------------------------------------------

/** Carpetas hijas directas. `parentId === undefined` devuelve las de raíz. */
export function getDirectChildFolders(folders: Folder[], parentId: string | undefined): Folder[] {
  return folders.filter((f) => (f.parentFolderId ?? undefined) === parentId);
}

/** IDs de todas las carpetas descendientes (incluye `rootId`). DFS. */
export function getDescendantFolderIds(folders: Folder[], rootId: string): string[] {
  const out: string[] = [rootId];
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const f of folders) {
      if (f.parentFolderId === current) {
        out.push(f.id);
        stack.push(f.id);
      }
    }
  }
  return out;
}

/** Disertaciones en la carpeta y todas sus descendientes, ordenadas por updatedAt asc. */
export function getAllDissertationsInTree(
  folders: Folder[],
  dissertations: Dissertation[],
  rootId: string
): Dissertation[] {
  const ids = new Set(getDescendantFolderIds(folders, rootId));
  return dissertations
    .filter((d) => ids.has(d.folderId))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

// ----------------------------------------------------------------------------
// Estado y acciones
// ----------------------------------------------------------------------------

type PersistedShape = { folders: Folder[]; dissertations: Dissertation[] };

type AppLibraryState = {
  folders: Folder[];
  dissertations: Dissertation[];
  // Folder CRUD
  addFolder: (name: string, parentFolderId?: string) => boolean;
  addAutoClusterFolder: (name: string, parentFolderId?: string) => string;
  renameFolder: (id: string, name: string) => boolean;
  removeFolder: (id: string) => void;
  /** Borrado en cascada de la carpeta y todo su árbol (sub-folders + disertaciones). */
  removeFolderTree: (id: string) => void;
  ensureExampleFoldersIfEmpty: () => void;
  // Dissertation CRUD básico
  addDissertationWithFields: (folderId: string, title: string, body: string) => boolean;
  addDissertationWithFieldsReturnId: (folderId: string, title: string, body: string) => string | null;
  renameDissertation: (id: string, title: string) => boolean;
  setDissertationTitle: (id: string, title: string) => void;
  moveDissertation: (id: string, newFolderId: string) => boolean;
  removeDissertation: (id: string) => void;
  // Conversación (mensajes)
  appendDissertationUserMessage: (id: string, userText: string) => boolean;
  appendDissertationAssistantMessage: (id: string, assistantText: string) => boolean;
  removeLastUserMessage: (id: string) => void;
  /** Borra un turno concreto por índice (vista documento). Recalcula body. */
  removeDissertationMessage: (id: string, index: number) => void;
  /** Nueva conv con primer turno user+model (voz desde carpeta / inicio). */
  addDissertationWithAiExchange: (
    folderId: string,
    userText: string,
    assistantText: string
  ) => string | null;
  // Forks
  /** Crea conv seedeada por continue-from: el seedReply va como primer turno `model`. */
  addDissertationFromContinueFrom: (params: {
    parentDocId: string;
    folderId: string;
    title: string;
    seedReply: string;
  }) => string | null;
  /** Crea una copia de un merge en el folder dado (los merges pueden duplicarse en cada cluster origen). */
  addDissertationFromMerge: (params: {
    folderId: string;
    title: string;
    body: string;
    sourceIds: string[];
  }) => string | null;
};

const PERSIST_VERSION = 5;

function titleFromTextBlock(text: string): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  const base = line || 'Desde texto';
  return base.length > 52 ? `${base.slice(0, 50)}…` : base;
}

export const useFoldersStore = create<AppLibraryState>()(
  persist(
    (set, get) => ({
      folders: [],
      dissertations: [],

      addFolder: (name, parentFolderId) => {
        const n = name.trim();
        if (!n) return false;
        const now = new Date().toISOString();
        const folder: Folder = {
          id: newId(),
          name: n,
          parentFolderId,
          kind: 'user',
          createdAt: now,
          updatedAt: now,
        };
        set({ folders: [...get().folders, folder] });
        return true;
      },

      addAutoClusterFolder: (name, parentFolderId) => {
        const now = new Date().toISOString();
        const folder: Folder = {
          id: newId(),
          name: name.trim() || 'Cluster',
          parentFolderId,
          kind: 'auto-cluster',
          createdAt: now,
          updatedAt: now,
        };
        set({ folders: [...get().folders, folder] });
        return folder.id;
      },

      renameFolder: (id, name) => {
        const n = name.trim();
        if (!n) return false;
        const now = new Date().toISOString();
        set({
          folders: get().folders.map((f) =>
            f.id === id ? { ...f, name: n, updatedAt: now } : f
          ),
        });
        return true;
      },

      removeFolder: (id) =>
        set({
          folders: get().folders.filter((f) => f.id !== id),
          dissertations: get().dissertations.filter((d) => d.folderId !== id),
        }),

      removeFolderTree: (id) => {
        const ids = new Set(getDescendantFolderIds(get().folders, id));
        set({
          folders: get().folders.filter((f) => !ids.has(f.id)),
          dissertations: get().dissertations.filter((d) => !ids.has(d.folderId)),
        });
      },

      ensureExampleFoldersIfEmpty: () => {
        set((s) => {
          if (s.folders.length > 0) return s;
          return { folders: createExampleFolders() };
        });
      },

      addDissertationWithFields: (folderId, title, body) =>
        get().addDissertationWithFieldsReturnId(folderId, title, body) !== null,

      addDissertationWithFieldsReturnId: (folderId, title, body) => {
        const t = title.trim();
        const b = body.trim();
        if (!t || !b) return null;
        const now = new Date().toISOString();
        const dissId = newId();
        const d: Dissertation = {
          id: dissId,
          folderId,
          title: t.slice(0, 200),
          body: b,
          messages: [{ role: 'user', content: b }],
          lineage: 'original',
          createdAt: now,
          updatedAt: now,
        };
        set({ dissertations: [...get().dissertations, d] });
        return dissId;
      },

      renameDissertation: (id, title) => {
        const n = title.trim();
        if (!n) return false;
        const now = new Date().toISOString();
        set({
          dissertations: get().dissertations.map((x) =>
            x.id === id ? { ...x, title: n.slice(0, 200), updatedAt: now } : x
          ),
        });
        return true;
      },

      setDissertationTitle: (id, title) => {
        const n = title.trim().slice(0, 200);
        if (!n) return;
        set({
          dissertations: get().dissertations.map((x) =>
            x.id === id ? { ...x, title: n } : x
          ),
        });
      },

      moveDissertation: (id, newFolderId) => {
        const folderExists = get().folders.some((f) => f.id === newFolderId);
        if (!folderExists) return false;
        const now = new Date().toISOString();
        set({
          dissertations: get().dissertations.map((x) =>
            x.id === id ? { ...x, folderId: newFolderId, updatedAt: now } : x
          ),
        });
        return true;
      },

      removeDissertation: (id) =>
        set({ dissertations: get().dissertations.filter((d) => d.id !== id) }),

      appendDissertationUserMessage: (id, userText) => {
        const u = userText.trim();
        if (!u) return false;
        const now = new Date().toISOString();
        set({
          dissertations: get().dissertations.map((d) => {
            if (d.id !== id) return d;
            const messages: ChatTurn[] = [...d.messages, { role: 'user', content: u }];
            const body = messages.map((m) => m.content).join('\n\n');
            return { ...d, messages, body, updatedAt: now };
          }),
        });
        return true;
      },

      appendDissertationAssistantMessage: (id, assistantText) => {
        const a = assistantText.trim();
        if (!a) return false;
        const now = new Date().toISOString();
        set({
          dissertations: get().dissertations.map((d) => {
            if (d.id !== id) return d;
            const messages: ChatTurn[] = [...d.messages, { role: 'model', content: a }];
            const body = messages.map((m) => m.content).join('\n\n');
            return { ...d, messages, body, updatedAt: now };
          }),
        });
        return true;
      },

      removeDissertationMessage: (id, index) => {
        const now = new Date().toISOString();
        set({
          dissertations: get().dissertations.map((d) => {
            if (d.id !== id || index < 0 || index >= d.messages.length) return d;
            const messages = d.messages.filter((_, i) => i !== index);
            const body = messages.map((m) => m.content).join('\n\n');
            return { ...d, messages, body, updatedAt: now };
          }),
        });
      },

      removeLastUserMessage: (id) => {
        const now = new Date().toISOString();
        set({
          dissertations: get().dissertations.map((d) => {
            if (d.id !== id || d.messages.length === 0) return d;
            const last = d.messages[d.messages.length - 1];
            if (last.role !== 'user') return d;
            const messages = d.messages.slice(0, -1);
            const body = messages.map((m) => m.content).join('\n\n');
            return { ...d, messages, body, updatedAt: now };
          }),
        });
      },

      addDissertationWithAiExchange: (folderId, userText, assistantText) => {
        const folderExists = get().folders.some((f) => f.id === folderId);
        if (!folderExists) return null;
        const u = userText.trim();
        const a = assistantText.trim();
        if (!u || !a) return null;
        const now = new Date().toISOString();
        const messages: ChatTurn[] = [
          { role: 'user', content: u },
          { role: 'model', content: a },
        ];
        const body = messages.map((m) => m.content).join('\n\n');
        const dissId = newId();
        const d: Dissertation = {
          id: dissId,
          folderId,
          title: titleFromTextBlock(u).slice(0, 200),
          body,
          messages,
          lineage: 'original',
          createdAt: now,
          updatedAt: now,
        };
        set({ dissertations: [...get().dissertations, d] });
        return dissId;
      },


      addDissertationFromContinueFrom: ({ parentDocId, folderId, title, seedReply }) => {
        const folderExists = get().folders.some((f) => f.id === folderId);
        if (!folderExists) return null;
        const a = seedReply.trim();
        if (!a) return null;
        const now = new Date().toISOString();
        // El seed va como primer turno `model`: la nueva voz cognitiva sintetiza lo previo.
        const messages: ChatTurn[] = [{ role: 'model', content: a }];
        const body = messages.map((m) => m.content).join('\n\n');
        const dissId = newId();
        const d: Dissertation = {
          id: dissId,
          folderId,
          title: title.trim().slice(0, 200) || 'Continuación',
          body,
          messages,
          parentId: parentDocId,
          lineage: 'continue-from',
          createdAt: now,
          updatedAt: now,
        };
        set({ dissertations: [...get().dissertations, d] });
        return dissId;
      },

      addDissertationFromMerge: ({ folderId, title, body, sourceIds }) => {
        const folderExists = get().folders.some((f) => f.id === folderId);
        if (!folderExists) return null;
        const t = title.trim();
        const b = body.trim();
        if (!t || !b) return null;
        const now = new Date().toISOString();
        const messages: ChatTurn[] = [{ role: 'model', content: b }];
        const dissId = newId();
        const d: Dissertation = {
          id: dissId,
          folderId,
          title: t.slice(0, 200),
          body: b,
          messages,
          mergedFromIds: sourceIds.length > 0 ? [...sourceIds] : undefined,
          lineage: 'merge',
          createdAt: now,
          updatedAt: now,
        };
        set({ dissertations: [...get().dissertations, d] });
        return dissId;
      },
    }),
    {
      name: 'guardaespaldas-folders',
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state): PersistedShape => ({
        folders: state.folders,
        dissertations: state.dissertations,
      }),
      merge: (persistedState, currentState) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return currentState;
        }
        const ps = persistedState as { folders?: unknown; dissertations?: unknown };
        if (!Array.isArray(ps.folders)) {
          return { ...currentState, ...(persistedState as object) } as AppLibraryState;
        }
        const dissertations = Array.isArray(ps.dissertations)
          ? mapRawListToDissertations(ps.dissertations)
          : [];
        return {
          ...currentState,
          folders: mapRawListToFolders(ps.folders),
          dissertations,
        };
      },
      migrate: (persisted): PersistedShape => {
        // v0..v4 → v5: añade `kind: 'user'` a todas las carpetas existentes y `lineage: 'original'`
        // a todas las disertaciones. parentFolderId / parentId / mergedFromIds quedan undefined.
        const folders = mapRawListToFolders(
          persisted && typeof persisted === 'object'
            ? (persisted as { folders?: unknown }).folders
            : undefined
        );
        const dissertations = mapRawListToDissertations(
          persisted && typeof persisted === 'object'
            ? (persisted as { dissertations?: unknown }).dissertations
            : undefined
        );
        return {
          folders: folders.length > 0 ? folders : createExampleFolders(),
          dissertations,
        };
      },
    }
  )
);
