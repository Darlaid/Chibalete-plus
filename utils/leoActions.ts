import type { LeoTriggerReason } from './leoTriggerEngine';

// ── Action model ────────────────────────────────────────────────────────────

export type LeoActionId =
  | 'resume'
  | 'quick_recap'
  | 'continue_reading'
  | 'simplify'
  | 'define_word'
  | 'ask_question'
  | 'reflect'
  | 'open_anchor'
  | 'play_audio';

export type LeoActionKind = 'navigation' | 'leo_query' | 'playback';

export interface LeoAction {
  id: LeoActionId;
  label: string;
  kind: LeoActionKind;
}

export interface ResolveLeoActionsInput {
  triggerReason: LeoTriggerReason | null;
  hasAnchorAvailable: boolean;
  hasAudioAvailable: boolean;
  isAudioPlaying: boolean;
}

// ── Action catalog ───────────────────────────────────────────────────────────

const ACTION_CATALOG: Record<LeoActionId, LeoAction> = {
  resume:           { id: 'resume',           label: 'Seguir leyendo',      kind: 'navigation' },
  quick_recap:      { id: 'quick_recap',       label: 'Resumen rápido',      kind: 'leo_query'  },
  continue_reading: { id: 'continue_reading',  label: 'Continuar',           kind: 'navigation' },
  simplify:         { id: 'simplify',          label: 'Explicar más simple', kind: 'leo_query'  },
  define_word:      { id: 'define_word',       label: 'Buscar una palabra',  kind: 'leo_query'  },
  ask_question:     { id: 'ask_question',      label: 'Hazme una pregunta',  kind: 'leo_query'  },
  reflect:          { id: 'reflect',           label: 'Reflexionar',         kind: 'leo_query'  },
  open_anchor:      { id: 'open_anchor',       label: 'Ver nota del texto',  kind: 'navigation' },
  play_audio:       { id: 'play_audio',        label: 'Escuchar el texto',   kind: 'playback'   },
};

// ── Trigger → candidate actions (priority-ordered) ───────────────────────────

const TRIGGER_ACTIONS: Record<NonNullable<LeoTriggerReason> | 'default', LeoActionId[]> = {
  welcome_back: ['resume',       'quick_recap',     'play_audio'      ],
  checkpoint:   ['ask_question', 'quick_recap',     'continue_reading'],
  confusion:    ['simplify',     'define_word',     'open_anchor'     ],
  retention:    ['quick_recap',  'continue_reading','play_audio'      ],
  anchor:       ['open_anchor',  'define_word',     'ask_question'    ],
  default:      ['ask_question', 'continue_reading'                   ],
};

// ── Pure resolver ────────────────────────────────────────────────────────────

/**
 * Returns 2–3 contextually appropriate actions for the Leo companion menu.
 * Pure function — no side effects.
 */
export function resolveLeoActions(input: ResolveLeoActionsInput): LeoAction[] {
  const { triggerReason, hasAnchorAvailable, hasAudioAvailable, isAudioPlaying } = input;

  const candidates = TRIGGER_ACTIONS[triggerReason ?? 'default'] ?? TRIGGER_ACTIONS.default;

  const filtered = candidates.filter((id) => {
    if (id === 'open_anchor' && !hasAnchorAvailable) return false;
    if (id === 'play_audio' && (!hasAudioAvailable || isAudioPlaying)) return false;
    return true;
  });

  // Ensure at least 2 actions by filling from defaults
  const result = [...filtered];
  for (const id of TRIGGER_ACTIONS.default) {
    if (result.length >= 3) break;
    if (!result.includes(id)) result.push(id);
  }

  return result.slice(0, 3).map((id) => ACTION_CATALOG[id]);
}
