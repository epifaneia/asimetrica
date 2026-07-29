import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Biblioteca de obra — METADATOS de los documentos subidos (jaula/grounding).
 *
 * Aquí solo vive lo ligero: título, estado de ingesta, asignación a carpetas.
 * El texto extraído, los chunks y los embeddings viven en el filesystem
 * (`documentDirectory/library/<docId>/`), gestionados por libraryIngestService.
 * Respetamos la decisión de proyecto de NO usar sqlite: los binarios nunca
 * pasan por AsyncStorage.
 *
 * Un documento SIN carpetas asignadas está inactivo (desactivado por defecto,
 * decisión de diseño): nada actúa hasta que el creador lo asigna.
 */

export type LibraryDocStatus =
  | 'pendiente' // registrado, ingesta aún no arrancó (o quedó a medias antes de extraer)
  | 'extrayendo' // leyendo/extrayendo texto de la fuente
  | 'troceando' // chunking prosa-consciente
  | 'embebiendo' // llamadas batch a la API de embeddings
  | 'listo'
  | 'error';

export type LibraryDocKind = 'txt' | 'md' | 'pdf';

export type LibraryDoc = {
  id: string;
  title: string;
  /** Nombre del archivo original (para mostrar y detectar re-subidas). */
  sourceName: string;
  kind: LibraryDocKind;
  status: LibraryDocStatus;
  /** Mensaje del último error de ingesta (status 'error'). */
  errorMessage: string | null;
  /** Caracteres del texto extraído (0 hasta terminar extracción). */
  chars: number;
  /** Nº de chunks (0 si el doc va por inyección completa o aún no se troceó). */
  nChunks: number;
  /** Nº de chunks ya embebidos (progreso de la fase 'embebiendo' y punto de reanudación). */
  embeddedChunks: number;
  /**
   * Sinopsis corta generada en la ingesta. Se inyecta SIEMPRE, incluso cuando el
   * retrieval no recupera nada: es lo que hace que el modelo sepa qué hay en la
   * biblioteca. Vacía si su generación falló (degrada sin romper nada).
   */
  synopsis: string;
  /** Carpetas donde este documento actúa. Vacío = inactivo. */
  folderIds: string[];
  createdAt: string;
};

type LibraryState = {
  docs: LibraryDoc[];
  addDoc: (doc: Omit<LibraryDoc, 'status' | 'errorMessage' | 'chars' | 'nChunks' | 'embeddedChunks' | 'folderIds' | 'synopsis'>) => void;
  patchDoc: (id: string, patch: Partial<Omit<LibraryDoc, 'id'>>) => void;
  removeDoc: (id: string) => void;
  setDocFolders: (id: string, folderIds: string[]) => void;
  /** Quita una carpeta borrada de todas las asignaciones (limpieza de huérfanos). */
  detachFolderEverywhere: (folderId: string) => void;
};

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      docs: [],
      addDoc: (doc) =>
        set((s) => ({
          docs: [
            ...s.docs,
            {
              ...doc,
              status: 'pendiente',
              errorMessage: null,
              chars: 0,
              nChunks: 0,
              embeddedChunks: 0,
              synopsis: '',
              folderIds: [],
            },
          ],
        })),
      patchDoc: (id, patch) =>
        set((s) => ({
          docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        })),
      removeDoc: (id) => set((s) => ({ docs: s.docs.filter((d) => d.id !== id) })),
      setDocFolders: (id, folderIds) =>
        set((s) => ({
          docs: s.docs.map((d) => (d.id === id ? { ...d, folderIds: [...new Set(folderIds)] } : d)),
        })),
      detachFolderEverywhere: (folderId) =>
        set((s) => ({
          docs: s.docs.map((d) =>
            d.folderIds.includes(folderId)
              ? { ...d, folderIds: d.folderIds.filter((f) => f !== folderId) }
              : d
          ),
        })),
    }),
    {
      name: 'guardaespaldas-library',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

/** Docs LISTOS que actúan en una carpeta (los demás estados no inyectan nada). */
export function getActiveDocsForFolder(docs: LibraryDoc[], folderId: string): LibraryDoc[] {
  return docs.filter((d) => d.status === 'listo' && d.folderIds.includes(folderId));
}
