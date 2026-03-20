import type { Content } from '../types';

const DB_NAME = 'ChibaleteDB';
const DB_VERSION = 1;
const STORE_NAME = 'libros';

interface StoredBook {
    id: string;
    metadata: Content;
    pdf: ArrayBuffer;
}

class OfflineService {
    private db: IDBDatabase | null = null;
    private dbInitPromise: Promise<IDBDatabase | null> | null = null;
    private readonly isDbSupported: boolean;

    constructor() {
        try {
            this.isDbSupported = typeof window !== 'undefined' && 'indexedDB' in window;
            if (!this.isDbSupported) {
                console.warn('IndexedDB is not supported. Offline features will be disabled.');
            }
        } catch (e) {
            console.error("Failed to check for IndexedDB support, disabling offline features.", e);
            this.isDbSupported = false;
        }
    }

    private getDB(): Promise<IDBDatabase | null> {
        if (!this.isDbSupported) {
            return Promise.resolve(null);
        }
        if (this.db) {
            return Promise.resolve(this.db);
        }
        if (this.dbInitPromise) {
            return this.dbInitPromise;
        }

        this.dbInitPromise = new Promise((resolve) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('Failed to initialize IndexedDB:', (event.target as IDBOpenDBRequest).error);
                this.dbInitPromise = null; // Allow retry on next call
                resolve(null); // Resolve with null to fail gracefully
            };
        });
        
        return this.dbInitPromise;
    }

    async saveBook(content: Content, data: ArrayBuffer): Promise<void> {
        const db = await this.getDB();
        if (!db) return;

        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const book: StoredBook = { id: content.id, metadata: content, pdf: data };
                store.put(book);
                transaction.oncomplete = () => resolve();
                transaction.onerror = (event) => reject(transaction.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    async getBook(contentId: string): Promise<StoredBook | undefined> {
        const db = await this.getDB();
        if (!db) return undefined;

        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(contentId);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    async deleteBook(contentId: string): Promise<void> {
        const db = await this.getDB();
        if (!db) return;

        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                store.delete(contentId);
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    async getDownloadedBooks(): Promise<Content[]> {
        const db = await this.getDB();
        if (!db) return [];

        return new Promise((resolve, reject) => {
            try {
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.getAll();
                request.onsuccess = () => {
                    const books = (request.result as StoredBook[]).map(book => book.metadata);
                    resolve(books);
                };
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }
}

export const offlineService = new OfflineService();