/**
 * Type declarations for mediaBaseUrl.js — M3.1
 */

export function initMediaBaseUrl(): Promise<void>;

export function resolveMediaUrl<T extends string | null | undefined>(u: T): T;

export function uploadsUrl(relativePath: string): string;

export function getMediaBaseUrlInfo(): {
    initialized: boolean;
    baseUrl: string;
    cdnActive: boolean;
};

export function _setMediaBaseUrlForTests(url: string | null): void;

export function _resetForTests(): void;
