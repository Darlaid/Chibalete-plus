/**
 * StartupEngine — deterministic hydration engine for VisorInmersivo.
 *
 * Pure TypeScript module. Zero React. Zero side effects at import time.
 *
 * Responsibilities:
 *   - Fetch manifest, anchors, and raw text in parallel
 *   - Parse and normalize the resulting data
 *   - Emit state transitions to subscribers
 *
 * Lifecycle:
 *   idle → loading → ready
 *
 * Designed to be instantiated once per content session (via useRef in the
 * reader component). Future engines (BlockEngine, RewardEngine, TranceEngine)
 * can subscribe to the same instance or receive a reference to it.
 */

// ---------------------------------------------------------------------------
// TYPES — exported so the reader and future engines can share them
// ---------------------------------------------------------------------------

export type StartupStatus = 'idle' | 'loading' | 'ready';

export interface ContextualAnchor {
  id: string;
  chunkIndex: number;
  type: 'insight' | 'vocabulary' | 'reflexion' | 'friction_support';
  title: string;
  payload: string;
}

export interface StartupState {
  status: StartupStatus;
  sentences: string[];
  sentenceToChunk: number[];           // sentenceIndex → chunkIndex (empty = v1/fallback)
  anchorsMap: Record<number, ContextualAnchor[]>;
  manifest: Record<string, any> | null;
}

type Listener = (state: StartupState) => void;

// ---------------------------------------------------------------------------
// ENGINE
// ---------------------------------------------------------------------------

export class StartupEngine {
  private state: StartupState = {
    status: 'idle',
    sentences: [],
    sentenceToChunk: [],
    anchorsMap: {},
    manifest: null,
  };

  private readonly listeners: Set<Listener> = new Set();
  private readonly contentId: string;
  private readonly textUrl: string | undefined;
  private readonly signal: AbortSignal | undefined;

  constructor(contentId: string, textUrl?: string, signal?: AbortSignal) {
    this.contentId = contentId;
    this.textUrl = textUrl;
    this.signal = signal;
  }

  /**
   * Start hydration. Single-execution guarantee:
   * calling start() more than once is a no-op after the first call.
   */
  start(): void {
    if (this.state.status !== 'idle') return;
    this.setState({ status: 'loading' });
    this.run().catch(() => {
      // Total failure: still transition to ready so the shell stops showing
      // the hydrating indicator. Placeholder sentences remain as-is.
      this.setState({ status: 'ready' });
    });
  }

  /**
   * Subscribe to state transitions.
   * Returns an unsubscribe function — call it on component unmount.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Synchronous snapshot of the current state. */
  getState(): StartupState {
    return { ...this.state };
  }

  // -------------------------------------------------------------------------
  // PRIVATE — internal state machine
  // -------------------------------------------------------------------------

  private setState(partial: Partial<StartupState>): void {
    this.state = { ...this.state, ...partial };
    const snapshot = this.getState();
    this.listeners.forEach(l => l(snapshot));
  }

  private async run(): Promise<void> {
    // All three requests fire at the same instant — no sequential blocking.
    const [manifestData, anchorsData, rawText] = await Promise.all([
      this.fetchManifest(),
      this.fetchAnchors(),
      this.fetchText(),
    ]);

    // Guard: si el caller abortó (cambio de contentId, unmount), NO mutar state.
    // Sin esto, fetches in-flight del libro anterior podrían emitir 'ready' contra
    // la sesión actual del nuevo libro tras un switch rápido.
    if (this.signal?.aborted) {
      console.log(`[StartupEngine] aborted ${this.contentId}`);
      return;
    }

    const { splits, sentenceToChunk } = this.buildSentences(manifestData, rawText);
    const anchorsMap = this.parseAnchors(anchorsData);

    this.setState({
      status: 'ready',
      sentences: splits,
      sentenceToChunk,
      anchorsMap,
      manifest: manifestData,
    });
  }

  // -------------------------------------------------------------------------
  // PRIVATE — data fetchers (each returns null on any failure)
  // -------------------------------------------------------------------------

  private async fetchManifest(): Promise<any> {
    try {
      const res = await fetch(`/uploads/audio/${this.contentId}/manifest.json`, { signal: this.signal });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }

  private async fetchAnchors(): Promise<any> {
    try {
      const res = await fetch(`/uploads/audio/${this.contentId}/anchors.json`, { signal: this.signal });
      if (!res.ok) {
        if (res.status === 404) {
          console.log(`[ANCHORS_404] contentId=${this.contentId}`);
        }
        return null;
      }
      return await res.json();
    } catch { return null; }
  }

  private async fetchText(): Promise<string | null> {
    if (!this.textUrl) return null;
    try {
      const res = await fetch(this.textUrl, { signal: this.signal });
      return res.ok ? await res.text() : null;
    } catch { return null; }
  }

  // -------------------------------------------------------------------------
  // PRIVATE — data processors
  // -------------------------------------------------------------------------

  private buildSentences(
    manifestData: any,
    rawText: string | null
  ): { splits: string[]; sentenceToChunk: number[] } {
    let splits: string[] = [];
    let sentenceToChunk: number[] = [];

    if (manifestData) {
      if (manifestData._meta?.version >= 2) {
        // Manifest v2: expand fine-grained sentences from chunk metadata
        const chunkEntries: any[] = Object.entries(manifestData)
          .filter(([key]) => key !== '_meta')
          .map(([, v]) => v as any)
          .sort((a: any, b: any) => a.index - b.index);

        const map: number[] = [];
        for (const chunk of chunkEntries) {
          const chunkSentences: string[] =
            Array.isArray(chunk.sentences) && chunk.sentences.length > 0
              ? chunk.sentences
              : chunk.text ? [chunk.text] : [];
          for (const s of chunkSentences) {
            splits.push(s);
            map.push(chunk.index);
          }
        }
        sentenceToChunk = map;
        console.log(`[StartupEngine] v2: ${splits.length} sentences from ${chunkEntries.length} chunks`);
      } else {
        // Manifest v1: chunk text is the display unit
        const values: any[] = Object.values(manifestData)
          .filter((v: any) => v?.index !== undefined)
          .sort((a: any, b: any) => a.index - b.index);
        const texts = values
          .map((v: any) => v.text)
          .filter((t: any) => t && typeof t === 'string');
        if (texts.length === values.length && texts.length > 0 && !texts[0].endsWith('...')) {
          splits = texts;
          console.log(`[StartupEngine] v1: ${splits.length} chunks`);
        }
      }
    }

    // Fallback: parse raw text with sentence-boundary regex
    if (splits.length === 0 && rawText) {
      console.log(`[RAW_FALLBACK] contentId=${this.contentId} rawLen=${rawText.length}`);
      const clean = rawText.replace(/\r\n/g, ' ').replace(/\s+/g, ' ');
      splits =
        clean.match(/[^.!?]+[.!?]+[\s]*/g)
          ?.map((s: string) => s.trim())
          .filter((s: string) => s.length > 0) || [clean];
    }

    return { splits, sentenceToChunk };
  }

  private parseAnchors(anchorsData: any): Record<number, ContextualAnchor[]> {
    const result: Record<number, ContextualAnchor[]> = {};
    if (!anchorsData?.chunkMap) return result;

    Object.keys(anchorsData.chunkMap).forEach((chunkIdxStr) => {
      const chunkIdx = parseInt(chunkIdxStr, 10);
      const arr = anchorsData.chunkMap[chunkIdxStr];
      if (!Array.isArray(arr)) return;

      result[chunkIdx] = arr.map((item: any, i: number) => {
        let title = 'Nota de Leo';
        let payload = item.payload || 'Información adicional disponible.';
        let type = item.type || 'insight';

        if (item.type === 'vocabulary') {
          title = item.word ? `Vocabulario: ${item.word}` : 'Vocabulario';
          payload = item.explanation || item.payload || payload;
        } else if (item.type === 'inferential' || item.type === 'reflection') {
          title = item.type === 'inferential' ? 'Para pensar...' : 'Reflexión';
          payload = item.question || item.payload || payload;
          type = item.type === 'inferential' ? 'insight' : 'reflexion';
        }

        return {
          id: `anchor-${chunkIdx}-${i}`,
          chunkIndex: chunkIdx,
          type,
          title,
          payload,
        } as ContextualAnchor;
      });
    });

    return result;
  }
}

// ---------------------------------------------------------------------------
// PREFETCH UTILITY
// Warm the HTTP cache on hover / click-before-navigation.
// StartupEngine will find responses already cached when it runs.
// ---------------------------------------------------------------------------

export function prefetchImmersiveContent(contentId: string, textUrl?: string): void {
  fetch(`/uploads/audio/${contentId}/manifest.json`).catch(() => {});
  fetch(`/uploads/audio/${contentId}/anchors.json`).catch(() => {});
  if (textUrl) fetch(textUrl).catch(() => {});
}
