/**
 * contentAdapter.d.mts — tipos del resolver de Content para V2.
 */

import type { Content } from '../../types';
import type { SessionError } from '../../engines/immersiveRuntimeTypes';

/**
 * Subset mínimo del dataService que el adapter consume — permite tests
 * con stubs sin instanciar el singleton real.
 */
export interface ContentDataServiceLike {
  getContenidoById(id: string): Content | undefined;
}

export interface ResolveContentArgs {
  contentId:   string;
  dataService: ContentDataServiceLike;
}

export type ResolveContentResult =
  | { ok: true;  content: Content }
  | { ok: false; error: SessionError };

export function resolveContent(args: ResolveContentArgs): ResolveContentResult;
