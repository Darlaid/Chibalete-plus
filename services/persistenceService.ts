
export class PersistenceService {
    private prefix: string;

    constructor(prefix: string = 'chibalete_') {
        this.prefix = prefix;
    }

    save<T>(key: string, data: T): void {
        try {
            const serialized = JSON.stringify(data);
            localStorage.setItem(`${this.prefix}${key}`, serialized);
        } catch (e) {
            console.error(`Error saving to localStorage key "${key}":`, e);
        }
    }

    load<T>(key: string, defaultValue: T): T {
        try {
            const stored = localStorage.getItem(`${this.prefix}${key}`);
            if (stored) {
                return JSON.parse(stored) as T;
            }
        } catch (e) {
            console.warn(`Error loading from localStorage key "${key}", using default.`, e);
        }
        return defaultValue;
    }

    clear(key: string): void {
        localStorage.removeItem(`${this.prefix}${key}`);
    }

    clearAll(): void {
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith(this.prefix)) {
                localStorage.removeItem(k);
            }
        });
    }
}

export const persistenceService = new PersistenceService();
