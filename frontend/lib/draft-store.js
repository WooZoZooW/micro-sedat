import { createSubmissionId } from './submission.js';

const DB_NAME = 'micro-sedat';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'current';

export function isSupported() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function draftToRecord(draft) {
  if (!draft || typeof draft !== 'object') return null;
  return {
    id: draft.id,
    createdAt: draft.createdAt,
    text: typeof draft.text === 'string' ? draft.text : '',
    audio: draft.audio?.blob
      ? {
        blob: draft.audio.blob,
        name: draft.audio.name,
        type: draft.audio.type,
        durationMs: draft.audio.durationMs || 0,
      }
      : null,
    files: (draft.files || []).map((file) => ({
      blob: file.file || file.blob,
      name: file.name,
      type: file.type,
    })),
  };
}

export function recordToDraft(record) {
  if (!record || typeof record !== 'object') return null;
  const files = (Array.isArray(record.files) ? record.files : [])
    .filter((entry) => entry && entry.blob)
    .map((entry) => ({
      id: createSubmissionId(),
      file: entry.blob,
      name: entry.name || 'file',
      type: entry.type || entry.blob.type || 'application/octet-stream',
      size: entry.blob.size || 0,
      previewUrl: null,
    }));
  return {
    id: record.id || createSubmissionId(),
    createdAt: record.createdAt || new Date().toISOString(),
    text: typeof record.text === 'string' ? record.text : '',
    audio: record.audio?.blob
      ? {
        blob: record.audio.blob,
        name: record.audio.name || 'recording',
        type: record.audio.type || record.audio.blob.type || 'audio/mp4',
        durationMs: record.audio.durationMs || 0,
      }
      : null,
    files,
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB open failed'));
  });
}

function runTransaction(mode, action) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let result;
    try {
      result = action(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      db.close();
      resolve(result && result.result !== undefined ? result.result : result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('indexedDB transaction failed'));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error('indexedDB transaction aborted'));
    };
  }));
}

export async function saveDraft(record) {
  if (!isSupported() || !record) return false;
  try {
    await runTransaction('readwrite', (store) => store.put(record, DRAFT_KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadDraft() {
  if (!isSupported()) return null;
  try {
    const value = await runTransaction('readonly', (store) => store.get(DRAFT_KEY));
    return value || null;
  } catch {
    return null;
  }
}

export async function clearDraft() {
  if (!isSupported()) return false;
  try {
    await runTransaction('readwrite', (store) => store.delete(DRAFT_KEY));
    return true;
  } catch {
    return false;
  }
}
