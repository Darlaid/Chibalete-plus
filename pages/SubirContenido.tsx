
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { UploadCloud, FileImage, FileText, Film, Music, BookOpen, Plus, Trash, Link as LinkIcon, Layers, CheckCircle, Eye, Scan, Users, X, ChevronLeft, Edit2, AlertCircle, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { dataService } from '../services/dataService';
import * as analyticsService from '../services/analyticsService';
import type { Content, AlbumRegion, AlbumReadingRoute, RegionAction, RegionActionType, AlbumMediaAsset, Section } from '../types';
import { useNavigate } from 'react-router-dom';
import { analizarIlustracionAlbum, sugerirEtiquetasThema } from '../services/geminiService';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Define types for the form state
interface MaterialAdjunto {
    id: string; // temporary ID for UI handling
    tipo: 'guia' | 'video' | 'podcast' | 'actividad' | 'contexto_pedagogico';
    titulo: string;
    publico: 'todos' | 'profesores' | 'estudiantes';
    file: File | null;
    url?: string; // New: support for external links
    autor?: string;
    descripcion?: string;
    etiquetas?: string[];
}

// Types for Album Editor
interface AlbumPageDraft {
    id: string;
    /** Undefined when the page was loaded from an existing album URL (not re-uploaded). */
    file?: File;
    imageUrl: string;
    regions: AlbumRegion[];
    text?: string;
    /** @deprecated Use pageType instead. Preserved for legacy read compat only. */
    doubleSpread?: boolean;
    pageType?: 'single' | 'double';
    /** How this spread groups with an adjacent page. Only relevant when pageType === 'double'. */
    doublePageMode?: 'with_next' | 'with_previous';
    ambientAudioUrl?: string;
    /** Pending file — uploaded on save, URL stored in ambientAudioUrl */
    ambientAudioFile?: File;
    /** Whether the ambient audio loops. Defaults to true in the viewer. */
    ambientAudioLoop?: boolean;
}

interface AlbumValidationError {
    pageIndex: number;  // -1 = global
    regionIndex?: number;
    rule: string;
    message: string;
}

function validateAlbumPages(pages: AlbumPageDraft[]): AlbumValidationError[] {
    const errors: AlbumValidationError[] = [];

    // V1: Must have at least one page
    if (pages.length === 0) {
        errors.push({ pageIndex: -1, rule: 'V1', message: 'El álbum debe tener al menos una lámina.' });
        return errors; // No point checking further
    }

    pages.forEach((page, pi) => {
        // V2: Page must have an image
        if (!page.imageUrl) {
            errors.push({ pageIndex: pi, rule: 'V2', message: 'Esta lámina no tiene imagen.' });
        }

        // V3 removed: pages with regions:[] are valid (overview-only pages).

        page.regions.forEach((region, ri) => {
            // Resolve effective action for validation (canonical 2.0-C or legacy)
            const effectiveActionType = region.action?.type;
            const isLegacyAudio = region.type === 'audio' && !region.action;
            const isLegacyNav   = region.type === 'nav'   && !region.action;
            const isAudioAction = effectiveActionType === 'audio' || isLegacyAudio;
            const isJumpAction  = effectiveActionType === 'jump'  || isLegacyNav;

            // V4: focus regions with 'read' action (or no action) must have text.
            // Exempt: audio, jump/nav, contemplative, text/leo/none/return actions.
            const actionExemptsText = isAudioAction || isJumpAction
                || effectiveActionType === 'text' || effectiveActionType === 'leo'
                || effectiveActionType === 'none' || effectiveActionType === 'return';
            const needsText = region.type !== 'contemplative' && !actionExemptsText;
            if (needsText && (!region.text || region.text.trim() === '')) {
                errors.push({ pageIndex: pi, regionIndex: ri, rule: 'V4', message: `Zona ${ri + 1}: falta el texto que se leerá.` });
            }

            // V4b / VA2: audio action requires audioUrl.
            if (isAudioAction) {
                const url = region.action?.audioUrl || region.audioUrl;
                if (!url || url.trim() === '') {
                    errors.push({ pageIndex: pi, regionIndex: ri, rule: 'V4b', message: `Zona ${ri + 1}: acción 'audio' requiere una URL de audio.` });
                }
            }

            // V4c / VA1: jump action requires a valid target page.
            if (isJumpAction) {
                const targetId = region.action?.targetPageId || region.navTargetPageId;
                if (!targetId) {
                    errors.push({ pageIndex: pi, regionIndex: ri, rule: 'V4c', message: `Zona ${ri + 1}: acción 'ir a lámina' requiere seleccionar una página destino.` });
                } else {
                    const targetExists = pages.some(p => p.id === targetId);
                    if (!targetExists) {
                        errors.push({ pageIndex: pi, regionIndex: ri, rule: 'V4d', message: `Zona ${ri + 1}: la página destino ya no existe en este álbum.` });
                    }
                }
            }

            // VA3: text action should have content.
            if (effectiveActionType === 'text' && (!region.action?.text || region.action.text.trim() === '')) {
                errors.push({ pageIndex: pi, regionIndex: ri, rule: 'VA3', message: `Zona ${ri + 1}: acción 'mostrar texto' está vacía — agrega el texto a mostrar.` });
            }

            // V5: Coordinates must be in bounds
            if (
                region.x < 0 || region.y < 0 ||
                region.x + region.width > 100 ||
                region.y + region.height > 100
            ) {
                errors.push({ pageIndex: pi, regionIndex: ri, rule: 'V5', message: `Zona ${ri + 1}: coordenadas fuera de límites (0–100%).` });
            }

            // V6: Region must have positive dimensions
            if (region.width <= 0 || region.height <= 0) {
                errors.push({ pageIndex: pi, regionIndex: ri, rule: 'V6', message: `Zona ${ri + 1}: dimensiones inválidas.` });
            }

            // V7: Legacy isInteractive must have a hint (backward compat)
            if (region.isInteractive && (!region.interactiveHint || region.interactiveHint.trim() === '')) {
                errors.push({ pageIndex: pi, regionIndex: ri, rule: 'V7', message: `Zona ${ri + 1}: zona interactiva sin pista. Añade el texto del desafío.` });
            }

            // V8: type='challenge' is the canonical challenge check — also requires interactiveHint
            if (region.type === 'challenge' && (!region.interactiveHint || region.interactiveHint.trim() === '')) {
                errors.push({ pageIndex: pi, regionIndex: ri, rule: 'V8', message: `Zona ${ri + 1}: tipo 'challenge' requiere una pista visible para el estudiante (interactiveHint).` });
            }
        });
    });

    return errors;
}

// ── Content Intelligence Suggestions (BLOQUE 7) ──────────────────────────────
// Non-blocking hints surfaced after hard validation passes.
// Do NOT add to blockingErrors — these are editorial nudges, not errors.

interface AlbumSuggestion {
    pageIndex:    number;       // 0-based; -1 = global
    regionIndex?: number;
    code:         string;
    message:      string;
    // 'editorial' — quality issue the editor should address; shown with a warning marker.
    // 'idea'      — enrichment opportunity; shown as a softer hint.
    severity:     'editorial' | 'idea';
}

function getAlbumSuggestions(pages: AlbumPageDraft[]): AlbumSuggestion[] {
    const hints: AlbumSuggestion[] = [];

    pages.forEach((page, pi) => {
        // S1: Page with no narrative text and no regions — pure image, no interaction.
        const hasNarrative = !!(page.text?.trim());
        const hasRegions   = page.regions.length > 0;
        if (!hasNarrative && !hasRegions) {
            hints.push({
                pageIndex: pi,
                code: 'S1',
                severity: 'editorial',
                message: `Lámina ${pi + 1}: solo imagen, sin texto ni zonas. Los lectores no podrán interactuar.`,
            });
        }

        // S2: Page with many regions (>7) — may overwhelm young readers.
        if (page.regions.length > 7) {
            hints.push({
                pageIndex: pi,
                code: 'S2',
                severity: 'editorial',
                message: `Lámina ${pi + 1}: ${page.regions.length} zonas puede resultar excesivo para lectores de 8–12 años. Considera reducirlas.`,
            });
        }

        page.regions.forEach((region, ri) => {
            const effectiveType = region.action?.type;
            const isDefaultFocus = region.type === 'focus' && (!effectiveType || effectiveType === 'read');

            // S3: Focus region with 'read' action but empty text — will try TTS but may fall silent.
            if (isDefaultFocus && region.text?.trim()) {
                // OK — has text, TTS will work.
            } else if (isDefaultFocus && !region.text?.trim() && effectiveType !== 'audio') {
                hints.push({
                    pageIndex: pi, regionIndex: ri,
                    code: 'S3',
                    severity: 'idea',
                    message: `Lámina ${pi + 1}, zona ${ri + 1}: zona de enfoque sin texto. Considera añadir texto narrativo.`,
                });
            }

            // S4: Explicitly 'none' action on a non-contemplative region — likely an oversight.
            if (effectiveType === 'none' && region.type !== 'contemplative') {
                hints.push({
                    pageIndex: pi, regionIndex: ri,
                    code: 'S4',
                    severity: 'editorial',
                    message: `Lámina ${pi + 1}, zona ${ri + 1}: acción 'ninguna' en zona no-contemplativa. ¿Falta configurar la acción?`,
                });
            }
        });
    });

    // ── Structural / album-wide analysis ──────────────────────────────────────
    // SA1: Album with 5+ pages but no contemplative regions → no emotional breathing room.
    if (pages.length >= 5) {
        const hasContemplative = pages.some(p =>
            p.regions.some(r => r.type === 'contemplative')
        );
        if (!hasContemplative) {
            hints.push({
                pageIndex: -1,
                code: 'SA1',
                severity: 'idea',
                message: 'El álbum no tiene zonas contemplativas. Una o dos láminas de observación silenciosa (sin texto) dan ritmo emocional y reducen la fatiga cognitiva del lector.',
            });
        }
    }

    // SA2: 3+ consecutive pages without any interactive regions — rhythm gap.
    {
        let runStart = -1;
        for (let i = 0; i <= pages.length; i++) {
            const hasRegions = i < pages.length && pages[i].regions.length > 0;
            if (!hasRegions && i < pages.length) {
                if (runStart < 0) runStart = i;
            } else {
                if (runStart >= 0 && i - runStart >= 3) {
                    hints.push({
                        pageIndex: runStart,
                        code: 'SA2',
                        severity: 'idea',
                        message: `Láminas ${runStart + 1}–${i}: ${i - runStart} láminas seguidas sin zonas interactivas. Considera distribuir la interacción de forma más pareja.`,
                    });
                }
                runStart = -1;
            }
        }
    }

    // SA3: All interactive regions use the same action type — no variety.
    // Only fires when there are 4+ interactive regions across the album.
    {
        const actionTypeCounts: Record<string, number> = {};
        pages.forEach(p => {
            p.regions.forEach(r => {
                const t = r.action?.type ?? (r.type !== 'contemplative' ? 'read' : 'none');
                if (t !== 'none') {
                    actionTypeCounts[t] = (actionTypeCounts[t] || 0) + 1;
                }
            });
        });
        const typeKeys  = Object.keys(actionTypeCounts);
        const typeTotal = Object.values(actionTypeCounts).reduce((a, b) => a + b, 0);
        if (typeKeys.length === 1 && typeTotal >= 4) {
            const typeLabel: Record<string, string> = {
                read:      'lectura narrativa',
                audio:     'audio',
                leo:       'conversación con Leo',
                jump:      'salto de lámina',
                challenge: 'desafío',
                text:      'texto superpuesto',
                return:    'retorno',
            };
            const label = typeLabel[typeKeys[0]] || typeKeys[0];
            hints.push({
                pageIndex: -1,
                code: 'SA3',
                severity: 'idea',
                message: `Todas las zonas usan la acción "${label}". Mezclar tipos (texto, audio, Leo, desafío) enriquece el ritmo de la experiencia.`,
            });
        }
    }

    return hints;
}

// ── Route Validation ──────────────────────────────────────────────────────────
// Each RouteValidationResult is per-route.
// errors   → blocking: shown prominently, prevent save.
// warnings → informational: shown clearly, do NOT block save.
// coverage → informational stat shown beneath the route.

interface RouteValidationResult {
    routeIndex: number;
    routeId:    string;
    errors:     string[];
    warnings:   string[];
    coverage:   { pages: number; total: number } | null;
}

function validateAlbumRoutes(
    routes: AlbumReadingRoute[],
    pages:  AlbumPageDraft[],
): RouteValidationResult[] {
    return routes.map((route, ri) => {
        const errors:   string[] = [];
        const warnings: string[] = [];

        // B6: No name — blocking: a nameless route is shown to the reader as "Ruta sin nombre".
        if (!route.name.trim()) {
            errors.push('Sin nombre. El lector no podrá identificar esta ruta.');
        }

        // B1: Empty sequence — blocking: there is literally nothing to navigate.
        if (route.sequence.length === 0) {
            errors.push('Secuencia vacía. El lector no podrá navegar por esta ruta.');
            return { routeIndex: ri, routeId: route.id, errors, warnings, coverage: null };
        }

        // B2: Missing pages — blocking: viewer would silently skip missing entries.
        const missingIds = route.sequence.filter(id => !pages.some(p => p.id === id));
        if (missingIds.length > 0) {
            errors.push(
                `${missingIds.length} ${missingIds.length === 1 ? 'lámina referenciada ya no existe' : 'láminas referenciadas ya no existen'} en el álbum.`
            );
        }

        // B3: Duplicate pages — warning only; some editorial paths revisit a page intentionally.
        const seen = new Set<string>();
        let dupeCount = 0;
        for (const id of route.sequence) {
            if (seen.has(id)) dupeCount++;
            else seen.add(id);
        }
        if (dupeCount > 0) {
            warnings.push(
                `${dupeCount} ${dupeCount === 1 ? 'lámina aparece' : 'láminas aparecen'} más de una vez. El lector visitará la misma lámina varias veces.`
            );
        }

        // Build valid-unique set for coverage analysis.
        const validUniqueIds = new Set(route.sequence.filter(id => pages.some(p => p.id === id)));
        const coverage = { pages: validUniqueIds.size, total: pages.length };

        // B4: Single-page route — warning; a one-page route is barely a route.
        if (validUniqueIds.size === 1) {
            warnings.push('Ruta de una sola lámina. La experiencia de ruta será mínima.');
        }

        // B5: Low coverage — warning only if album has ≥4 pages and route covers <35%.
        if (pages.length >= 4 && validUniqueIds.size > 0 && validUniqueIds.size < pages.length) {
            const pct = Math.round((validUniqueIds.size / pages.length) * 100);
            if (pct < 35) {
                warnings.push(
                    `Cubre ${validUniqueIds.size} de ${pages.length} láminas (${pct}%). Revisa si refleja el recorrido editorial deseado.`
                );
            }
        }

        return { routeIndex: ri, routeId: route.id, errors, warnings, coverage };
    });
}

const SubirContenido: React.FC = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    // Mode: "new" = Creating a new parent + materials. "existing" = Adding materials to existing parent. "manage" = Managing existing content.
    const [uploadMode, setUploadMode] = useState<'new' | 'existing' | 'manage'>('new');
    const [existingParents, setExistingParents] = useState<Content[]>([]);
    const [availableSections, setAvailableSections] = useState<Section[]>([]); // Sections List

    useEffect(() => {
        // Load initial data
        Promise.all([
            dataService.getContenidos(['administrador']),
            dataService.getSections()
        ]).then(([content, sections]) => {
            setExistingParents(content);
            setAvailableSections(sections);
        });
    }, []);

    const [selectedParentId, setSelectedParentId] = useState<string>('');
    const [editingId, setEditingId] = useState<string | null>(null); // New State for Editing

    const handleEditContent = async (content: Content) => {
        setUploadMode('new'); // Reuse 'new' mode for editor
        setEditingId(content.id);

        // Populate form with existing data
        setMainContent({
            titulo: content.titulo,
            autor: content.autor,
            biografia_autor: content.biografia_autor || '',
            tipo: content.tipo,
            descripcion: content.descripcion_corta,
            isCollection: content.isCollection || false,
            coverFile: null, // Keep null to indicate "no change" unless user uploads new
            resourceFile: null,
            textoPlanoFile: null,
            textoInglesFile: null,
            textoPortuguesFile: null,
            ilustracionesFiles: [],
            sectionIds: content.sectionIds || [],
            resourceURL: (content.tipo === 'video' && content.url_recurso) ? content.url_recurso : '',
            etiquetasString: content.etiquetas ? content.etiquetas.join(', ') : ''
        });

        // Clear any validation errors from a previous editing session.
        setAlbumValidationErrors([]);
        setAlbumRoutes(content.readingRoutes ?? []);
        setAlbumMediaAssets(content.mediaAssets ?? []);

        // Initialize album pages from existing data.
        // Pages loaded this way have no File — they reference the stored imageUrl directly.
        // The save path already handles this: only pages where file instanceof File are re-uploaded.
        if (content.album_data && content.album_data.length > 0) {
            const loadedPages: AlbumPageDraft[] = content.album_data.map(p => ({
                id: p.id,
                file: undefined,
                imageUrl: p.imageUrl,
                // Normalize legacy region types into canonical 2.0-C action form
                regions: (p.regions || []).map(r => {
                    if (r.type === 'audio' && !r.action) {
                        return { ...r, type: 'focus' as const, action: { type: 'audio' as const, audioUrl: r.audioUrl } };
                    }
                    if (r.type === 'nav' && !r.action) {
                        return { ...r, type: 'focus' as const, action: { type: 'jump' as const, targetPageId: r.navTargetPageId } };
                    }
                    return r;
                }),
                text: p.text,
                // Normalize legacy 'double-prev' → pageType:'double' + doublePageMode:'with_previous'.
                // 'double-prev' was a transitional value; canonical model uses separate fields.
                pageType: ((p as any).pageType === 'double-prev' || p.pageType === 'double')
                    ? 'double'
                    : ((p as any).doubleSpread ? 'double' : 'single'),
                doublePageMode: ((p as any).pageType === 'double-prev')
                    ? 'with_previous'
                    : (p.pageType === 'double' ? ((p as any).doublePageMode ?? 'with_next') : undefined),
                ambientAudioUrl: p.ambientAudioUrl,
                ambientAudioLoop: p.ambientAudioLoop,
            }));
            setAlbumPages(loadedPages);
        } else {
            setAlbumPages([]);
        }
        // Load Children
        const children = await dataService.getContenidosHijos(content.id, user?.roles || []);
        const mappedChildren: MaterialAdjunto[] = children.map(child => ({
            id: child.id,
            tipo: (child.tipo === 'guia' ? 'guia' : child.tipo) as any, // Cast for safety
            titulo: child.titulo,
            publico: child.publico_objetivo as any,
            file: null,
            url: child.url_recurso,
            autor: child.autor,
            descripcion: child.descripcion_corta,
            etiquetas: child.etiquetas
        }));
        setMateriales(mappedChildren);

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteContent = async (id: string, title: string) => {
        if (confirm(`¿Estás seguro de que deseas eliminar permanentemente "${title}" y todos sus archivos? Esta acción no se puede deshacer.`)) {
            try {
                await dataService.deleteContent(id);
                setExistingParents(prev => prev.filter(c => c.id !== id));
                alert("Contenido eliminado correctamente.");
            } catch (error) {
                console.error("Error al eliminar:", error);
                alert("Hubo un error al eliminar el contenido.");
            }
        }
    };
    const [mainContent, setMainContent] = useState({
        titulo: '',
        autor: '',
        biografia_autor: '', // New field
        tipo: 'libro' as Content['tipo'],
        descripcion: '',
        isCollection: false,
        coverFile: null as File | null,
        resourceFile: null as File | null,
        textoPlanoFile: null as File | null,
        textoInglesFile: null as File | null,
        textoPortuguesFile: null as File | null, // New field
        ilustracionesFiles: [] as File[],
        sectionIds: [] as string[],
        resourceURL: '', // New: URL for video/external content
        etiquetasString: '', // New UI state for tags
    });

    // Album Editor State
    const [albumPages, setAlbumPages] = useState<AlbumPageDraft[]>([]);
    const [albumRoutes, setAlbumRoutes] = useState<AlbumReadingRoute[]>([]);
    const [albumValidationErrors, setAlbumValidationErrors] = useState<AlbumValidationError[]>([]);
    // BLOQUE 7: Soft-warn modal for V4b (audio regions without URL).
    // Hard errors still block save; V4b shows a confirmable warning.
    const [albumAudioWarnings, setAlbumAudioWarnings] = useState<AlbumValidationError[]>([]);
    const [showAudioWarningModal, setShowAudioWarningModal] = useState(false);
    const bypassAudioV4bRef = useRef(false);
    const formRef = useRef<HTMLFormElement>(null);
    // Content intelligence: non-blocking suggestions, recomputed live as pages change.
    const albumSuggestions = useMemo(
        () => albumPages.length > 0 ? getAlbumSuggestions(albumPages) : [],
        [albumPages],
    );
    // Media library for this album — uploaded or external audio assets.
    // Regions reference assets via action.mediaAssetId + action.audioUrl (both always set).
    const [albumMediaAssets, setAlbumMediaAssets] = useState<AlbumMediaAsset[]>([]);
    // Per-region upload state: key = `${pageIdx}:${regionIdx}`, value = 'idle'|'uploading'|'error'
    const [audioUploadState, setAudioUploadState] = useState<Record<string, 'idle' | 'uploading' | 'error'>>({});
    // Which region is showing the external URL input: `${pageIdx}:${regionIdx}` or null.
    const [showExternalUrlRegion, setShowExternalUrlRegion] = useState<string | null>(null);
    const [analyzingIndex, setAnalyzingIndex] = useState<number | null>(null);
    // detectError: shown near the Auto-Detectar button when the AI call fails.
    // Cleared at the start of each new analysis so stale errors don't persist.
    const [detectError, setDetectError] = useState<{ index: number; message: string } | null>(null);
    // Per-page image refs — used so drag/resize calculations are relative to the
    // actual rendered image area (not the container, which may have min-h padding).
    const editorImgRefs = useRef<Map<number, HTMLImageElement>>(new Map());

    // Materials State (The "Ecosystem")
    const [materiales, setMateriales] = useState<MaterialAdjunto[]>([]);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [createdContentId, setCreatedContentId] = useState<string | null>(null);

    // Section Modal State
    const [isSectionModalOpen, setIsSectionModalOpen] = useState(false);
    const [newSectionData, setNewSectionData] = useState<Partial<Section>>({ titulo: '', unlockCost: 1500, isPublic: true });

    const handleCreateSection = async () => {
        if (!newSectionData.titulo) return alert("El título es obligatorio");
        try {
            const created = await dataService.saveSection({
                id: '', // Empty ID tells dataService/Server to create new
                titulo: newSectionData.titulo!,
                descripcion: newSectionData.descripcion || '',
                icono: 'BookOpen',
                unlockCost: newSectionData.unlockCost || 0,
                isPublic: newSectionData.isPublic || false,
                isHidden: false,
                order: availableSections.length
            });
            setAvailableSections(prev => [...prev, created]);
            setMainContent(prev => ({ ...prev, sectionIds: [...prev.sectionIds, created.id] })); // Auto-select
            setIsSectionModalOpen(false);
            setNewSectionData({ titulo: '', unlockCost: 1500, isPublic: true }); // Reset
        } catch (e) {
            alert("Error al crear sección");
        }
    };

    // Album Logic State
    const [highlightedRegionId, setHighlightedRegionId] = useState<string | null>(null);
    const [activeDrag, setActiveDrag] = useState<{ pageIdx: number, regionId: string, type: 'move' | 'resize', offsetX: number, offsetY: number } | null>(null);



    const handleMainChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setMainContent(prev => ({ ...prev, [name]: value }));
    };

    const handleSectionToggle = (secId: string) => {
        setMainContent(prev => {
            const current = prev.sectionIds || [];
            if (current.includes(secId)) {
                return { ...prev, sectionIds: current.filter(id => id !== secId) };
            } else {
                return { ...prev, sectionIds: [...current, secId] };
            }
        });
    };


    const handleIsCollectionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMainContent(prev => ({ ...prev, isCollection: e.target.checked }));
    }

    const handleMainFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'coverFile' | 'resourceFile' | 'textoPlanoFile' | 'textoInglesFile' | 'textoPortuguesFile') => {
        const file = e.target.files?.[0] || null;
        setMainContent(prev => ({ ...prev, [field]: file }));
    };

    const handleIllustrationsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setMainContent(prev => ({ ...prev, ilustracionesFiles: Array.from(e.target.files as FileList) }));
        }
    }

    // -- Album Logic --
    const handleAlbumPagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const files = Array.from(e.target.files as FileList);
            const newPages = files.map(f => ({
                id: `draft-page-${Date.now()}-${Math.random()}`,
                file: f,
                imageUrl: URL.createObjectURL(f),
                regions: [],
                text: '',
            }));
            setAlbumPages(prev => [...prev, ...newPages]);
        }
    }

    const detectRegions = async (index: number) => {
        setAnalyzingIndex(index);
        setDetectError(null);
        const page = albumPages[index];
        if (!page.file) {
            setDetectError({ index, message: 'Auto-Detectar requiere la imagen original. Esta lámina fue cargada desde una URL existente.' });
            setAnalyzingIndex(null);
            return;
        }
        try {
            // analizarIlustracionAlbum returns regions without ids — assign stable ids here
            const suggested = await analizarIlustracionAlbum(page.file);
            const withIds = suggested.map((r, i) => ({
                ...r,
                id: `reg-ai-${Date.now()}-${i}`,
            }));
            setAlbumPages(prev => {
                const updated = [...prev];
                updated[index] = { ...updated[index], regions: withIds };
                return updated;
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Error desconocido al analizar la imagen.';
            setDetectError({ index, message });
        } finally {
            setAnalyzingIndex(null);
        }
    }

    // -- Materials Logic --
    // Delete album page — checks for broken nav references first.
    const handleDeleteAlbumPage = (idx: number) => {
        const pageToDelete = albumPages[idx];
        const broken: string[] = [];
        albumPages.forEach((p, pi) => {
            if (pi === idx) return;
            p.regions.forEach((r, ri) => {
                if (r.type === 'nav' && r.navTargetPageId === pageToDelete.id) {
                    broken.push(`Lámina ${pi + 1}, Zona ${ri + 1}`);
                }
            });
        });
        const msg = broken.length > 0
            ? `Eliminar esta lámina romperá la navegación de:\n${broken.join('\n')}\n\n¿Continuar?`
            : '¿Eliminar esta lámina? Esta acción no se puede deshacer.';
        if (!confirm(msg)) return;
        setAlbumPages(prev => prev.filter((_, i) => i !== idx));
    };

    const addMaterial = () => {
        setMateriales(prev => [
            ...prev,
            { id: Date.now().toString(), tipo: 'guia', titulo: '', publico: 'profesores', file: null, url: '' }
        ]);
    };

    const removeMaterial = (id: string) => {
        setMateriales(prev => prev.filter(m => m.id !== id));
    };

    const updateMaterial = (id: string, field: keyof MaterialAdjunto, value: any) => {
        setMateriales(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
    };

    const [suggestTagsLoading, setSuggestTagsLoading] = useState(false);
    const [suggestTagsError, setSuggestTagsError] = useState<string | null>(null);

    const handleSuggestTags = async () => {
        if (!mainContent.titulo || !mainContent.descripcion) return alert("Ingresa título y descripción primero.");
        setSuggestTagsLoading(true);
        setSuggestTagsError(null);
        const suggested = await sugerirEtiquetasThema(mainContent.titulo, mainContent.descripcion);
        setSuggestTagsLoading(false);
        if (suggested && suggested.length > 0) {
            setMainContent(prev => ({ ...prev, etiquetasString: suggested.join(', ') }));
        } else {
            setSuggestTagsError("No se pudieron generar etiquetas. Verifica la clave API o ingresa las etiquetas manualmente.");
        }
    };

    // Loading + error state for uploads
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    // Double-submit guard — ref prevents concurrent submits even if state batching delays the disable
    const submittingRef = useRef(false);

    // UX-5A — feedback de progreso por archivo durante la publicación.
    // El estado vive aquí (no en dataService) porque sólo este formulario
    // necesita rendering; el servicio devuelve un callback `onProgress`
    // que actualiza este estado.
    //
    // Forma del estado:
    //   { label, fraction, phase }
    //   · label    — nombre humano del archivo en curso
    //   · fraction — 0..1 mientras suben bytes; 1 cuando el último byte
    //                salió pero el servidor sigue validando (la promesa
    //                aún no resolvió)
    //   · phase    — 'uploading' | 'processing'
    //
    // Cuando phase === 'processing' mostramos "Procesando…" en vez del
    // porcentaje — el cliente ya entregó todo y el servidor está
    // hasheando/validando, no avanza a 100% por culpa del cliente.
    type UploadProgress = { label: string; fraction: number; phase: 'uploading' | 'processing' };
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

    // Pre-upload validation — UX-5A. Removed the 50 MB hard cap (now
    // delegated to backend `MAX_UPLOAD_BYTES` defensive limit). El
    // formulario sigue protegiendo solo lo que el backend NO puede
    // detectar a tiempo razonable: archivos vacíos (FormData de 0 bytes
    // produce error críptico de multer) y archivos sin extensión legible.
    const validateFileBasic = (file: File | null, label: string): string | null => {
        if (!file) return null;
        if (file.size === 0) return `${label}: el archivo está vacío.`;
        return null;
    };

    const handleRetryTTS = async (id: string) => {
        if (!confirm('¿Deseas reiniciar el proceso de generación de audio para este libro? esto puede tardar varios minutos.')) return;
        try {
            await dataService.retryContent(id);
            alert('Proceso reiniciado correctamente. El estado se actualizará en unos instantes.');
            // Force refresh local data
            window.location.reload();
        } catch (e) {
            alert('Error al reiniciar proceso: ' + e);
        }
    };



    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Double-submit guard — ref check is synchronous, unlike state
        if (submittingRef.current) return;
        submittingRef.current = true;

        // Admin identity guard — belt-and-suspenders before any network request
        if (!user || !user.roles?.includes('administrador')) {
            setUploadError('Error de permisos: tu sesión no tiene rol de administrador. Vuelve a iniciar sesión.');
            submittingRef.current = false;
            return;
        }

        // Session storage guard — verify x-user-id is available before any fetch
        if (!dataService.hasActiveSession()) {
            setUploadError('Tu sesión expiró. Vuelve a iniciar sesión como administrador y reintenta la publicación.');
            submittingRef.current = false;
            return;
        }

        // Pre-upload sanity check — fail fast en archivos vacíos. El
        // tope de tamaño se valida en el backend (defensive 2 GiB) y en
        // nginx — el frontend ya no impone límite editorial artificial.
        const basicErrors = [
            validateFileBasic(mainContent.coverFile, 'Portada'),
            validateFileBasic(mainContent.resourceFile, 'Archivo principal'),
            validateFileBasic(mainContent.textoPlanoFile, 'Texto plano (ES)'),
            validateFileBasic(mainContent.textoInglesFile, 'Texto (EN)'),
            validateFileBasic(mainContent.textoPortuguesFile, 'Texto (PT)'),
            ...mainContent.ilustracionesFiles.map((f, i) => validateFileBasic(f, `Ilustración ${i + 1}`)),
            ...materiales.map((m, i) => validateFileBasic(m.file, `Material ${i + 1}: ${m.titulo || 'sin nombre'}`)),
        ].filter(Boolean);
        if (basicErrors.length > 0) {
            setUploadError(basicErrors.join('\n'));
            submittingRef.current = false;
            return;
        }

        setIsUploading(true);
        setUploadError(null);

        // Declared OUTSIDE try so the catch block can access it for orphan cleanup.
        const uploadedUrlsForCleanup: string[] = [];

        try {
            // Special Handling for Club Memories (Community Post)
            if (mainContent.tipo === 'memoria_club' && user) {
                if (!mainContent.titulo || !mainContent.descripcion) {
                    alert("Por favor, completa el título del club y la descripción.");
                    setIsUploading(false);
                    return;
                }

                // NOTE: Community posts are still local-only for now unless we add an API for them too.
                // Keeping existing logic for club memories to avoid breaking it, but focusing on Content API.
                dataService.addCommunityPost({
                    tipo: 'club',
                    autor_id: user.id,
                    autor_nombre: user.nombre_completo,
                    autor_avatar: user.avatar_url,
                    club_nombre: mainContent.titulo,
                    contenido: mainContent.descripcion,
                    estado: 'aprobado',
                    calificacion_comunidad: 5,
                    votos: 1
                });
                setIsSubmitted(true);
                setIsUploading(false);
                return;
            }

            // Determine Parent ID (New, Existing-Linked, or Editing)
            const parentId = editingId ? editingId : (uploadMode === 'existing' ? selectedParentId : `content-${Date.now()}`);

            // UX-5A — wrapper que reporta progreso visible al usuario por
            // archivo. El backend tarda más de lo que dura el stream HTTP
            // (validación binaria, hash con stream, mover a destino), así
            // que distinguimos dos fases:
            //   · 'uploading'  — bytes en vuelo, fraction = 0..1
            //   · 'processing' — último byte ya salió, servidor validando
            // Cuando el progress callback llega a 1 marcamos 'processing'
            // hasta que la promesa resuelve.
            const uploadWithProgress = async (file: File, label: string): Promise<string> => {
                setUploadProgress({ label, fraction: 0, phase: 'uploading' });
                try {
                    const url = await dataService.uploadFile(file, parentId, (frac) => {
                        setUploadProgress({
                            label,
                            fraction: frac,
                            phase: frac >= 1 ? 'processing' : 'uploading',
                        });
                    });
                    return url;
                } finally {
                    // Limpieza del progress queda a cargo del caller del
                    // flujo completo (handleSubmit) — entre archivos se
                    // sustituye por el siguiente label.
                }
            };

            // Helper to safely upload if file exists. UX-5A: ahora con
            // progreso visible. `label` es el nombre humano que aparece
            // en la barra mientras sube ese archivo concreto.
            const uploadIfFile = async (file: File | null, label: string) => {
                if (!file) return undefined;
                const url = await uploadWithProgress(file, label);
                if (url) uploadedUrlsForCleanup.push(url);
                return url;
            };

            // Hoisted so the materials loop (section 2) can access the uploaded cover URL
            // without heuristics. Assigned inside the 'new' block below.
            let savedCoverUrl: string | undefined;
            let savedExistingContent: Content | undefined;

            // 1. Create OR Update Main Content
            if (uploadMode === 'new') { // Mode is 'new' even when editing (reused UI)
                const isUpdate = !!editingId;

                // FIX: Evitar que el frontend mande un tipo que no tiene visor real como ePub ciegamente
                if (mainContent.resourceFile && mainContent.resourceFile.name.toLowerCase().endsWith('.epub')) {
                    alert("Error: El formato ePub aún no está soportado en los visores activos de la app. Por favor, sube PDF o TXT.");
                    setIsUploading(false);
                    return;
                }

                // Validation: Only strict if NEW. If UPDATE, files are optional.
                // Cover: Required unless video/podcast. Resource: Required unless album/collection.
                const isMedia = ['video', 'podcast'].includes(mainContent.tipo);
                const requiresCover = !isMedia;
                // FIX: El recurso (PDF/Video) es requerido A MENOS QUE exista un campo que lo reemplace de manera válida como "textoPlanoFile"
                const hasValidAlternative = !!mainContent.textoPlanoFile;
                // Resource required unless album, collection, OR if it's a video with a URL provided, OR if it has TXT alternative
                const requiresResource = mainContent.tipo !== 'libro_album' && !mainContent.isCollection && !(mainContent.tipo === 'video' && mainContent.resourceURL) && !hasValidAlternative;

                // Validation: Album pages structure (only when tipo is libro_album)
                if (mainContent.tipo === 'libro_album') {
                    const albumErrors = validateAlbumPages(albumPages);
                    // On update with no pages loaded in the editor, V1 ("album has no pages")
                    // is suppressed: existing album_data is preserved via the save-path fallback
                    // (line: album_data: albumDataForApi || existingContent?.album_data).
                    // All other rules (V4–V7) still apply if new pages were loaded.
                    const blockingErrors = (isUpdate && albumPages.length === 0)
                        ? albumErrors.filter(e => e.rule !== 'V1')
                        : albumErrors;

                    // BLOQUE 7: Separate V4b (audio without URL) from hard-blocking errors.
                    // V4b becomes a soft-confirm warning — editor can proceed after acknowledging.
                    // All other validation errors are hard blocks (content would be broken).
                    const hardErrors   = blockingErrors.filter(e => e.rule !== 'V4b');
                    const audioV4bWarn = blockingErrors.filter(e => e.rule === 'V4b');

                    if (hardErrors.length > 0) {
                        setAlbumValidationErrors(hardErrors);
                        setIsUploading(false);
                        document.getElementById('album-editor-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        return;
                    }
                    if (audioV4bWarn.length > 0 && !bypassAudioV4bRef.current) {
                        setAlbumAudioWarnings(audioV4bWarn);
                        setShowAudioWarningModal(true);
                        setIsUploading(false);
                        return;
                    }
                    // Reset bypass flag after it's been consumed by this save.
                    bypassAudioV4bRef.current = false;
                    setAlbumValidationErrors([]);

                    // Route validation — only errors block save; warnings are shown in the editor.
                    if (albumRoutes.length > 0) {
                        const routeResults = validateAlbumRoutes(albumRoutes, albumPages);
                        const routeErrors = routeResults.filter(r => r.errors.length > 0);
                        if (routeErrors.length > 0) {
                            // Re-surface as album validation errors (using pageIndex -1 for global scope)
                            setAlbumValidationErrors(
                                routeErrors.flatMap(r =>
                                    r.errors.map(msg => ({
                                        pageIndex: -1,
                                        rule: `R${r.routeIndex + 1}`,
                                        message: `Ruta "${albumRoutes[r.routeIndex]?.name || `#${r.routeIndex + 1}`}": ${msg}`,
                                    }))
                                )
                            );
                            setIsUploading(false);
                            document.getElementById('album-editor-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            return;
                        }
                    }
                }

                if (!isUpdate && ((requiresCover && !mainContent.coverFile) || (requiresResource && !mainContent.resourceFile))) {
                    alert(isMedia ? "Por favor, sube el archivo multimedia o ingresa una URL." : "Por favor, sube la portada y el archivo principal. (Si no tienes PDF, al menos provee un Archivo de Texto).");
                    setIsUploading(false);
                    return;
                }

                // Upload Main Files for Content (Only if changed/present)
                const coverUrl = await uploadIfFile(mainContent.coverFile, 'Portada');
                savedCoverUrl = coverUrl; // hoist to outer scope for materials loop
                const resourceUrl = await uploadIfFile(mainContent.resourceFile, 'Archivo principal');
                const txtEsUrl = await uploadIfFile(mainContent.textoPlanoFile, 'Texto plano (ES)');
                const txtEnUrl = await uploadIfFile(mainContent.textoInglesFile, 'Texto (EN)');
                const txtPtUrl = await uploadIfFile(mainContent.textoPortuguesFile, 'Texto (PT)');

                // Illustrations: upload sequentially so each URL can be tracked for cleanup.
                // Promise.all would lose partial results if one throws mid-array.
                const illustrationUrls: string[] = [];
                for (let i = 0; i < mainContent.ilustracionesFiles.length; i++) {
                    const f = mainContent.ilustracionesFiles[i];
                    const iUrl = await uploadWithProgress(f, `Ilustración ${i + 1}/${mainContent.ilustracionesFiles.length}`);
                    uploadedUrlsForCleanup.push(iUrl);
                    illustrationUrls.push(iUrl);
                }

                // Upload Album Pages logic
                let albumDataForApi: any[] | undefined = undefined;
                if (mainContent.tipo === 'libro_album') {
                    // Logic remains similar: upload if file present.
                    albumDataForApi = await Promise.all(albumPages.map(async (p, pageIdx) => {
                        // Upload page image if a new file was selected
                        let pageUrl = p.imageUrl;
                        if (p.file instanceof File) {
                            pageUrl = await uploadWithProgress(p.file, `Página ${pageIdx + 1} (imagen)`);
                            if (pageUrl) uploadedUrlsForCleanup.push(pageUrl);
                        }

                        // Upload ambient audio file if one was selected in the editor
                        let ambientUrl = p.ambientAudioUrl;
                        if (p.ambientAudioFile instanceof File) {
                            ambientUrl = await uploadWithProgress(p.ambientAudioFile, `Página ${pageIdx + 1} (audio)`);
                            if (ambientUrl) uploadedUrlsForCleanup.push(ambientUrl);
                        }

                        // Write canonical model: pageType 'double' + optional doublePageMode.
                        // Never write 'single' (it's the default) or the legacy 'double-prev'.
                        // doubleSpread intentionally omitted — pageType is the canonical field.
                        const isDouble = p.pageType === 'double';

                        return {
                            id: p.id,
                            imageUrl: pageUrl,
                            regions: p.regions,
                            ...(p.text           ? { text: p.text }                          : {}),
                            ...(isDouble         ? { pageType: 'double' }                    : {}),
                            ...(isDouble && p.doublePageMode
                                                 ? { doublePageMode: p.doublePageMode }      : {}),
                            ...(ambientUrl        ? { ambientAudioUrl: ambientUrl }           : {}),
                            // ambientAudioLoop: only write false explicitly; true is the viewer default
                            ...(p.ambientAudioLoop === false ? { ambientAudioLoop: false }   : {}),
                        };
                    }));
                }

                // Fetch existing content if updating to preserve old URLs if not replaced
                let existingContent: Content | undefined;
                if (isUpdate) {
                    existingContent = existingParents.find(c => c.id === editingId);
                }
                savedExistingContent = existingContent; // hoist to outer scope for materials loop

                const newContent: Content = {
                    // Default / New Values
                    id: parentId,
                    tipo: mainContent.tipo as Content['tipo'],
                    editorial: 'Chibalete',

                    // Defaults that might be overwritten if spread below
                    metricas: { veces_leido: 0, calificacion_promedio: 0 },
                    publico_objetivo: 'todos',

                    // ...Spreaing Existing Content to PRESERVE fields like etiquetas, metricas, ID, etc.
                    ...(existingContent || {}),

                    // OVERRIDES from Form (Must come after spread)
                    // OVERRIDES from Form (Must come after spread)
                    titulo: mainContent.titulo || "Sin Título", // Ensure form title wins
                    autor: mainContent.autor || "Anónimo",
                    biografia_autor: mainContent.biografia_autor,
                    descripcion_corta: mainContent.descripcion,
                    etiquetas: mainContent.etiquetasString ? mainContent.etiquetasString.split(',').map(s => s.trim()) : (existingContent?.etiquetas || ['Nuevo', mainContent.tipo]),
                    isCollection: mainContent.isCollection,
                    sectionIds: mainContent.sectionIds, // Included in payload

                    // Files: Use new URL if uploaded, else keep existing (from spread), else string fallback
                    portada_url: coverUrl || existingContent?.portada_url || '',
                    // Logic: If Video/Podcast and URL provided, use it. Else upload.
                    url_recurso: (mainContent.tipo === 'video' && mainContent.resourceURL)
                        ? mainContent.resourceURL
                        : (mainContent.tipo === 'libro_album' ? '' : (mainContent.isCollection ? '' : (resourceUrl || existingContent?.url_recurso || ''))),

                    // Texts
                    texto_plano_url: txtEsUrl || existingContent?.texto_plano_url,
                    texto_ingles_url: txtEnUrl || existingContent?.texto_ingles_url,
                    texto_portugues_url: txtPtUrl || existingContent?.texto_portugues_url,

                    // Logic: Append illustrations to existing ones to prevent data loss
                    ilustraciones_url: [
                        ...(existingContent?.ilustraciones_url || []),
                        ...illustrationUrls
                    ],

                    // Album Data
                    // Use newly uploaded pages if any were loaded in the editor; otherwise
                    // fall back to existing pages. albumDataForApi is [] (truthy) when
                    // albumPages is empty, so || would incorrectly discard existing data.
                    album_data: albumPages.length > 0 ? albumDataForApi : existingContent?.album_data,
                    // Album reading routes — follow the same guard as album_data.
                    readingRoutes: albumPages.length > 0
                        ? (albumRoutes.length > 0 ? albumRoutes : undefined)
                        : existingContent?.readingRoutes,
                    // Media assets — always save current state (merged with any prior assets
                    // not overwritten by this session).
                    mediaAssets: albumMediaAssets.length > 0 ? albumMediaAssets : existingContent?.mediaAssets,

                    // Pages count logic — preserve existing count on metadata-only updates
                    numero_paginas: mainContent.tipo === 'libro' ? 10 : (mainContent.tipo === 'libro_album' ? (albumPages.length > 0 ? albumPages.length : (existingContent?.numero_paginas || undefined)) : (existingContent?.numero_paginas || undefined)),
                };

                await dataService.saveContentToApi(newContent);
            }

            // 2. Create Child Materials — sequential for orphan tracking
            // savedCoverUrl es la URL real subida para el contenido padre — sin heurísticas.
            // Fallback a la portada existente (edición) y luego a placeholder de emergencia.
            const parentCoverUrl: string = savedCoverUrl || savedExistingContent?.portada_url || 'https://picsum.photos/200';

            for (let index = 0; index < materiales.length; index++) {
                const mat = materiales[index];
                // Check if File OR URL
                if (mat.file || mat.url) {
                    let matFileUrl = mat.url || '';
                    if (mat.file) {
                        matFileUrl = await uploadWithProgress(mat.file, `Material ${index + 1}: ${mat.titulo || 'sin nombre'}`);
                        uploadedUrlsForCleanup.push(matFileUrl); // track for cleanup on failure
                    }
                    const matCoverUrl = parentCoverUrl;

                    const childContent: Content = {
                        id: `child-${parentId}-${index}-${Date.now()}`,
                        parentId: parentId,
                        tipo: mat.tipo === 'actividad' ? 'guia' : mat.tipo as any,
                        titulo: mat.titulo,
                        autor: mat.autor || mainContent.autor || 'Chibalete',
                        editorial: 'Chibalete',
                        descripcion_corta: mat.descripcion || `Material complementario para ${mainContent.titulo}`,
                        portada_url: matCoverUrl,
                        url_recurso: matFileUrl,
                        etiquetas: mat.etiquetas || ['Material', mat.tipo],
                        metricas: { veces_leido: 0, calificacion_promedio: 0 },
                        publico_objetivo: mat.tipo === 'contexto_pedagogico' ? 'administrador' : mat.publico,
                        // --- LEO CONTEXT METADATA ---
                        ...(mat.tipo === 'contexto_pedagogico' ? { useForLeoContext: true } : {})
                    } as Content;

                    // ID resolution: materials loaded from the server have a stable ID
                    // (stored in the content DB). Materials added fresh in this session
                    // have a temp numeric ID from Date.now(). The reliable signal is
                    // whether the ID exists in the list of server-loaded children (existingParents
                    // doesn't have children, but we loaded them into `materiales` with their real IDs
                    // via handleEditContent → dataService.getContenidosHijos). A purely numeric
                    // string (length ≤ 15, all digits) is a Date.now() temp ID.
                    const isServerPersisted = mat.id && mat.id.length > 15 && /\D/.test(mat.id);
                    if (!isServerPersisted) {
                        childContent.id = `content-${Date.now()}-${index}`;
                    } else {
                        childContent.id = mat.id;
                    }

                    await dataService.saveContentToApi(childContent);
                }
            }

            setCreatedContentId(parentId);
            setIsSubmitted(true);
            setIsUploading(false);
            setUploadProgress(null);
            submittingRef.current = false;

        } catch (error: any) {
            console.error("Error al subir:", error);

            // Compensatory purge: best-effort cleanup of all uploaded files that
            // weren't persisted because the operation failed. Fire-and-forget.
            if (uploadedUrlsForCleanup.length > 0) {
                console.warn(`⚠️ Purgando ${uploadedUrlsForCleanup.length} archivo(s) huérfano(s):`, uploadedUrlsForCleanup);
                uploadedUrlsForCleanup.forEach(url => {
                    dataService.purgeOrphanFile(url); // best-effort, never throws
                });
            }

            const errorMessage: string =
                error?.response?.data?.error ||
                error?.message ||
                String(error);

            // Map error signals to admin-friendly messages.
            // UX-5A: el límite editorial artificial fue eliminado. El único
            // tope que puede disparar mensaje de tamaño es el límite duro
            // defensivo del backend (2 GiB) — y solo si un asset realmente
            // lo excede. El backend devuelve `code: LIMIT_FILE_SIZE` con el
            // límite real, así que no quemamos un número en el cliente.
            let userFriendlyMessage: string;
            if (errorMessage.includes('Invalid file type') || errorMessage.includes('extensión')) {
                userFriendlyMessage = 'El tipo de archivo no está permitido. Revisa las extensiones aceptadas.';
            } else if (errorMessage.includes('LIMIT_FILE_SIZE') || errorMessage.includes('tope técnico') || errorMessage.includes('too large')) {
                userFriendlyMessage = errorMessage; // El backend ya da mensaje con el tope real
            } else if (errorMessage.includes('Network') || errorMessage.includes('Failed to fetch') || errorMessage.includes('ERR_NETWORK')) {
                userFriendlyMessage = 'Error de red: no se pudo conectar con el servidor. Verifica tu conexión y vuelve a intentarlo.\n\nSi los archivos ya habían subido antes del error, se intentó limpiarlos automáticamente.';
            } else if (errorMessage.includes('401') || errorMessage.includes('x-user-id missing')) {
                userFriendlyMessage = 'Tu sesión venció o no está activa. Vuelve a iniciar sesión como administrador.';
            } else if (errorMessage.includes('403') || errorMessage.includes('Acceso denegado') || errorMessage.includes('rol administrador')) {
                userFriendlyMessage = 'Tu cuenta no tiene permisos de administrador para realizar esta operación.';
            } else if (errorMessage.includes('album_data inválido')) {
                userFriendlyMessage = `El álbum tiene datos inválidos: ${errorMessage}`;
            } else {
                userFriendlyMessage = `Error al publicar: ${errorMessage}`;
            }

            console.error('[Upload Error - technical]', errorMessage);
            setUploadError(userFriendlyMessage);
            setIsUploading(false);
            setUploadProgress(null);
            submittingRef.current = false; // always release guard — never leave the form frozen
        }
    };

    const getIcon = (tipo: string) => {
        switch (tipo) {
            case 'libro': return <BookOpen className="w-5 h-5" />;
            case 'articulo_pedagogico': return <FileText className="w-5 h-5" />;
            case 'libro_album': return <Eye className="w-5 h-5" />;
            case 'guia': return <FileText className="w-5 h-5" />;
            case 'podcast': return <Music className="w-5 h-5" />;
            case 'video': return <Film className="w-5 h-5" />;
            case 'actividad': return <Layers className="w-5 h-5" />;
            case 'memoria_club': return <Users className="w-5 h-5" />;
            default: return <BookOpen className="w-5 h-5" />;
        }
    };

    if (isSubmitted) {
        return (
            <div className="p-4 md:p-8 max-w-2xl mx-auto text-center animate-in fade-in zoom-in duration-300">
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
                </div>
                <h1 className="text-3xl font-bold mb-4">¡Contenido Publicado!</h1>
                <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
                    {mainContent.tipo === 'memoria_club'
                        ? "La memoria del club ha sido publicada en el muro de la Comunidad."
                        : `Se ha subido correctamente ${mainContent.titulo ? `"${mainContent.titulo}"` : 'el contenido'} junto con sus materiales.`}
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-4">
                    {createdContentId && mainContent.tipo !== 'memoria_club' && (
                        <button
                            onClick={() => navigate(`/contenido/${createdContentId}`)}
                            className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold transition-colors"
                        >
                            Ver Contenido Creado
                        </button>
                    )}
                    {mainContent.tipo === 'memoria_club' && (
                        <button
                            onClick={() => navigate(`/biblioteca`)}
                            className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold transition-colors"
                        >
                            Ir a Comunidad
                        </button>
                    )}
                    <button
                        onClick={() => {
                            setIsSubmitted(false);
                            setMateriales([]);
                            setAlbumPages([]);
                            setMainContent({
                                titulo: '', autor: '', biografia_autor: '', tipo: 'libro', descripcion: '', isCollection: false,
                                coverFile: null, resourceFile: null, textoPlanoFile: null, textoInglesFile: null, textoPortuguesFile: null, ilustracionesFiles: []
                            });
                            setCreatedContentId(null);
                            setEditingId(null); // Reset Editing State
                        }}
                        className="px-8 py-3 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold transition-colors"
                    >
                        {editingId ? "Volver a Gestión" : "Subir otro contenido"}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 max-w-4xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Gestor de Contenido y Ecosistemas</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Sube archivos desde tu equipo o carpetas locales.</p>
            </div>

            {/* BLOQUE 7 — Audio warning modal: soft confirm before saving
                albums with audio regions that have no URL assigned. */}
            {showAudioWarningModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="bg-gray-900 border border-amber-500/40 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle size={20} className="text-amber-400 flex-shrink-0" />
                            <h3 className="text-white font-semibold">Regiones de audio sin archivo</h3>
                        </div>
                        <div className="space-y-1 mb-4 max-h-40 overflow-y-auto">
                            {albumAudioWarnings.map((w, i) => (
                                <p key={i} className="text-amber-300/80 text-sm">
                                    Lámina {w.pageIndex + 1}{w.regionIndex != null ? `, zona ${w.regionIndex + 1}` : ''}: sin audio asignado
                                </p>
                            ))}
                        </div>
                        <p className="text-white/55 text-sm mb-5">
                            Los lectores no podrán escuchar audio en esas zonas. ¿Guardar de todas formas?
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setShowAudioWarningModal(false)}
                                className="flex-1 px-4 py-2 border border-white/20 rounded-xl text-white/70 hover:bg-white/10 text-sm transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowAudioWarningModal(false);
                                    bypassAudioV4bRef.current = true;
                                    formRef.current?.requestSubmit();
                                }}
                                className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-sm font-semibold transition-colors"
                            >
                                Guardar igual
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <form ref={formRef} onSubmit={handleSubmit} className="space-y-8">

                {/* 1. Selector de Contexto */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <h2 className="text-lg font-semibold mb-4 text-indigo-600 dark:text-indigo-400">¿Qué deseas hacer?</h2>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <button
                            type="button"
                            onClick={() => setUploadMode('new')}
                            className={`flex-1 p-4 rounded-lg border-2 text-left transition-all ${uploadMode === 'new' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'}`}
                        >
                            <div className="flex items-center mb-2"><UploadCloud className="mr-2 text-indigo-500" /> <span className="font-bold">Crear Nueva Obra / Colección</span></div>
                            <p className="text-sm text-gray-500">Subir libros, álbumes, series o memorias de club.</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setUploadMode('existing')}
                            className={`flex-1 p-4 rounded-lg border-2 text-left transition-all ${uploadMode === 'existing' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'}`}
                        >
                            <div className="flex items-center mb-2"><LinkIcon className="mr-2 text-indigo-500" /> <span className="font-bold">Añadir a Existente</span></div>
                            <p className="text-sm text-gray-500">Agregar guías o videos nuevos a un libro que ya está en la biblioteca.</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => setUploadMode('manage')}
                            className={`flex-1 p-4 rounded-lg border-2 text-left transition-all ${uploadMode === 'manage' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'}`}
                        >
                            <div className="flex items-center mb-2"><Trash className="mr-2 text-red-500" /> <span className="font-bold">Gestionar Biblioteca</span></div>
                            <p className="text-sm text-gray-500">Eliminar libros o contenidos obsoletos.</p>
                        </button>
                    </div>
                </div>

                {/* MANAGEMENT VIEW */}
                {uploadMode === 'manage' && (
                    <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 animate-in slide-in-from-bottom-4">
                        <h2 className="text-xl font-bold mb-6 text-gray-800 dark:text-gray-200 border-b pb-4">Gestión de Contenidos</h2>

                        {existingParents.length === 0 ? (
                            <p className="text-gray-500">No hay contenidos registrados.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 uppercase">
                                        <tr>
                                            <th className="p-3 rounded-tl-lg">Tipo</th>
                                            <th className="p-3">Título</th>
                                            <th className="p-3">Autor</th>
                                            <th className="p-3">Estado TTS</th>
                                            <th className="p-3 rounded-tr-lg text-right">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {existingParents.map(content => (
                                            <tr key={content.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                <td className="p-3 text-gray-500" title={content.tipo}>{getIcon(content.tipo)}</td>
                                                <td className="p-3 font-medium text-gray-900 dark:text-gray-100">{content.titulo}</td>
                                                <td className="p-3 text-gray-500">{content.autor}</td>
                                                <td className="p-3">
                                                    <div className="flex flex-col gap-1">
                                                        {(content.status === 'procesando' || (content.processingStatus && content.processingStatus.status === 'processing')) && (
                                                            <>
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                                                    <RefreshCw size={10} className="mr-1 animate-spin" />
                                                                    Procesando ({content.processingStatus?.percentage || 0}%)
                                                                </span>
                                                                <button onClick={() => handleRetryTTS(content.id)} className="text-[10px] text-orange-600 hover:underline">
                                                                    ¿Detenido? Reiniciar
                                                                </button>
                                                            </>
                                                        )}
                                                        {(content.status === 'error' || (content.processingStatus && content.processingStatus.status === 'failed')) && (
                                                            <div className="flex flex-col items-start gap-1">
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800" title={content.processingStatus?.error}>
                                                                    <AlertTriangle size={10} className="mr-1" />
                                                                    Fallido
                                                                </span>
                                                                <button onClick={() => handleRetryTTS(content.id)} className="text-[10px] text-indigo-600 hover:underline">Reparar</button>
                                                            </div>
                                                        )}
                                                        {content.status === 'disponible' && (
                                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                                                <CheckCircle size={10} className="mr-1" />
                                                                Listo
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleEditContent(content)}
                                                        className="mr-2 px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-md hover:bg-indigo-200 dark:hover:bg-indigo-900/50 font-bold transition-colors inline-flex items-center"
                                                    >
                                                        <Edit2 size={14} className="mr-1" /> Editar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteContent(content.id, content.titulo)}
                                                        className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-md hover:bg-red-200 dark:hover:bg-red-900/50 font-bold transition-colors inline-flex items-center"
                                                    >
                                                        <Trash size={14} className="mr-1" /> Eliminar
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* 2. Información de la Obra Principal (Solo si es NEW) */}
                {uploadMode === 'new' && (
                    <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 animate-in slide-in-from-bottom-4">
                        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 pb-4 mb-6">Información Principal</h2>

                        <div className="grid md:grid-cols-2 gap-6 mb-6">
                            <div>
                                <label className="block text-sm font-medium mb-1">Tipo de Contenido</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">{getIcon(mainContent.tipo)}</div>
                                    <select name="tipo" value={mainContent.tipo} onChange={handleMainChange} className="w-full pl-10 p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg">
                                        <option value="libro">Libro (PDF)</option>
                                        <option value="libro_album">Libro Álbum (Interactivo)</option>
                                        <option value="articulo_pedagogico">Artículo Pedagógico</option>
                                        <option value="memoria_club">Memoria de Club de Lectura</option>
                                        <option value="podcast">Podcast</option>
                                        <option value="video">Video</option>
                                    </select>
                                </div>
                            </div>
                            {mainContent.tipo !== 'memoria_club' && (
                                <div className="flex items-center">
                                    <input type="checkbox" id="isCollection" checked={mainContent.isCollection} onChange={handleIsCollectionChange} className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500" />
                                    <label htmlFor="isCollection" className="ml-2 text-sm text-gray-700 dark:text-gray-300">¿Es una colección? (Ej. Serie de videos)</label>
                                </div>
                            )}
                        </div>



                        <div className="grid md:grid-cols-2 gap-6 mb-6">
                            <div>
                                <label className="block text-sm font-medium mb-1">{mainContent.tipo === 'memoria_club' ? 'Nombre del Club' : 'Título de la Obra'}</label>
                                <input type="text" name="titulo" value={mainContent.titulo} onChange={handleMainChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg" placeholder={mainContent.tipo === 'memoria_club' ? "Ej. Club Los Exploradores" : "Ej. El Principito"} />
                            </div>
                            {mainContent.tipo !== 'memoria_club' && (
                                <div>
                                    <label className="block text-sm font-medium mb-1">Autor / Creador</label>
                                    <input type="text" name="autor" value={mainContent.autor} onChange={handleMainChange} className="w-full p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg" placeholder="Ej. Antoine de Saint-Exupéry" />
                                </div>
                            )}
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-medium mb-1">{mainContent.tipo === 'memoria_club' ? 'Contenido de la Memoria' : 'Descripción Corta'}</label>
                            <textarea name="descripcion" value={mainContent.descripcion} onChange={handleMainChange} rows={mainContent.tipo === 'memoria_club' ? 6 : 2} className="w-full p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg resize-none" placeholder={mainContent.tipo === 'memoria_club' ? "Describe las actividades, conclusiones y aprendizajes del club..." : "Breve sinopsis..."}></textarea>
                        </div>

                        {mainContent.tipo !== 'memoria_club' && (
                            <div className="mb-6">
                                <label className="block text-sm font-medium mb-1">Etiquetas (Temas/Categorías)</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        name="etiquetasString"
                                        value={mainContent.etiquetasString}
                                        onChange={handleMainChange}
                                        className="flex-1 p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg"
                                        placeholder="Ej. Aventura, Ciencia Ficción, Amistad"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSuggestTags}
                                        disabled={suggestTagsLoading}
                                        className="px-4 py-2 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 rounded-lg font-bold flex items-center hover:bg-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Sparkles size={16} className="mr-2" />
                                        {suggestTagsLoading ? 'Analizando...' : 'Sugerir (IA)'}
                                    </button>
                                </div>
                                {suggestTagsError && (
                                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                                        <AlertCircle size={12} /> {suggestTagsError}
                                    </p>
                                )}
                                <p className="text-xs text-gray-500 mt-1">Separa las etiquetas con comas.</p>
                            </div>
                        )}

                        {mainContent.tipo !== 'memoria_club' && (
                            <div className="mb-6">
                                <label className="block text-sm font-medium mb-1">Biografía del Autor (Opcional)</label>
                                <textarea name="biografia_autor" value={mainContent.biografia_autor} onChange={handleMainChange} rows={3} className="w-full p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg resize-none" placeholder="Escribe aquí una breve biografía del autor..."></textarea>
                            </div>
                        )}

                        {mainContent.tipo !== 'memoria_club' && (
                            <div className="mb-6">
                                <label className="block text-sm font-medium mb-1">Secciones (Opcional)</label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {availableSections.map(sec => (
                                        <button
                                            key={sec.id}
                                            type="button"
                                            onClick={() => handleSectionToggle(sec.id)}
                                            className={`px-3 py-1.5 rounded-full text-sm border transition-colors flex items-center ${mainContent.sectionIds?.includes(sec.id)
                                                ? 'bg-indigo-100 border-indigo-500 text-indigo-700 font-bold'
                                                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                                                }`}
                                        >
                                            {mainContent.sectionIds?.includes(sec.id) && <CheckCircle size={14} className="mr-1" />}
                                            {sec.titulo}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={() => setIsSectionModalOpen(true)}
                                        className="px-3 py-1.5 rounded-full text-sm border border-dashed border-indigo-400 text-indigo-600 hover:bg-indigo-50 font-medium flex items-center"
                                    >
                                        <Plus size={14} className="mr-1" /> Nueva Sección
                                    </button>
                                </div>
                                <p className="text-xs text-gray-400">
                                    Organiza este libro en estanterías temáticas (ej. "Aventura", "Clásicos").
                                </p>
                            </div>
                        )}

                        {mainContent.tipo !== 'memoria_club' && (
                            <div className="grid md:grid-cols-2 gap-6 pb-6 border-b border-gray-200 dark:border-gray-700">
                                <div>
                                    <label className="block text-sm font-bold mb-2">1. Imagen de Portada</label>
                                    <input type="file" accept="image/*" onChange={(e) => handleMainFileChange(e, 'coverFile')} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" required={!editingId && !['video', 'podcast'].includes(mainContent.tipo)} />
                                    {mainContent.coverFile && (
                                        <div className="mt-4 relative w-32 rounded-lg overflow-hidden shadow-md group">
                                            <img
                                                src={URL.createObjectURL(mainContent.coverFile)}
                                                alt="Vista previa portada"
                                                className="w-full h-auto max-h-48 object-cover"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setMainContent(prev => ({ ...prev, coverFile: null }))}
                                                className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="Quitar imagen"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    )}
                                    {editingId && !mainContent.coverFile && existingParents.find(p => p.id === editingId)?.portada_url && (
                                        <div className="mt-2">
                                            <p className="text-xs text-green-600 mb-2">✓ Portada actual:</p>
                                            <img src={existingParents.find(p => p.id === editingId)?.portada_url} alt="Portada actual" className="w-24 h-auto rounded shadow-sm opacity-80" />
                                        </div>
                                    )}
                                </div>
                                {mainContent.tipo !== 'libro_album' && !mainContent.isCollection && (
                                    <div>
                                        <label className="block text-sm font-bold mb-2">2. Archivo Principal {mainContent.tipo === 'video' ? '(O Enlace)' : '(PDF/Audio)'}</label>

                                        {mainContent.tipo === 'video' && (
                                            <div className="mb-2">
                                                <label className="block text-xs text-gray-400 mb-1">Opción A: Enlace de YouTube / Vimeo / Externo</label>
                                                <div className="flex items-center">
                                                    <LinkIcon className="text-gray-400 mr-2" size={16} />
                                                    <input
                                                        type="url"
                                                        value={mainContent.resourceURL}
                                                        onChange={(e) => setMainContent(prev => ({ ...prev, resourceURL: e.target.value }))}
                                                        placeholder="https://www.youtube.com/watch?v=..."
                                                        className="flex-1 p-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm"
                                                    />
                                                </div>
                                                <p className="text-center text-xs text-gray-400 my-2">- O -</p>
                                            </div>
                                        )}

                                        <label className="block text-xs text-gray-400 mb-1">{mainContent.tipo === 'video' ? 'Opción B: Subir Archivo Local' : 'Subir Archivo'}</label>
                                        <input type="file" onChange={(e) => handleMainFileChange(e, 'resourceFile')} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" required={!editingId && !mainContent.resourceURL} />
                                        {editingId && !mainContent.resourceFile && existingParents.find(p => p.id === editingId)?.url_recurso && (
                                            <p className="mt-1 text-xs text-green-600">✓ Archivo actual existente (Sube otro para cambiarlo)</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ALBUM EDITOR */}
                        {mainContent.tipo === 'libro_album' && (
                            <div id="album-editor-section" className="pt-6 border-b border-gray-200 dark:border-gray-700 pb-6">
                                <h3 className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mb-4 flex items-center">
                                    <Eye className="mr-2" /> Editor Visual de Álbum
                                </h3>

                                {/* Global validation errors (V1: no pages) */}
                                {albumValidationErrors.filter(e => e.pageIndex === -1).map((err, ei) => (
                                    <div key={ei} className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
                                        <AlertTriangle size={16} className="text-red-500 shrink-0" />
                                        <p className="text-red-600 dark:text-red-400 text-sm font-medium">{err.message}</p>
                                    </div>
                                ))}

                                {/* BLOQUE 7 — Content intelligence: non-blocking suggestions with severity hierarchy.
                                    Recomputed live. Never prevent save. 'editorial' = quality issue; 'idea' = enrichment. */}
                                {albumSuggestions.length > 0 && (() => {
                                    const editorialItems = albumSuggestions.filter(s => s.severity === 'editorial');
                                    const ideaItems      = albumSuggestions.filter(s => s.severity === 'idea');
                                    return (
                                        <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/60 overflow-hidden">
                                            {editorialItems.length > 0 && (
                                                <div className="bg-amber-50 dark:bg-amber-900/15 px-4 py-3">
                                                    <p className="text-amber-700 dark:text-amber-300 text-xs font-semibold uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                                                        <span>⚠</span> Recomendaciones editoriales
                                                    </p>
                                                    <ul className="space-y-1">
                                                        {editorialItems.map((s, i) => (
                                                            <li key={i} className="text-amber-800 dark:text-amber-200 text-sm flex items-start gap-1.5">
                                                                <span className="mt-0.5 shrink-0 text-amber-500">·</span>
                                                                {s.message}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                            {ideaItems.length > 0 && (
                                                <div className="bg-sky-50 dark:bg-sky-900/10 px-4 py-3">
                                                    <p className="text-sky-700 dark:text-sky-300 text-xs font-semibold uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                                                        <span>💡</span> Ideas de mejora
                                                    </p>
                                                    <ul className="space-y-1">
                                                        {ideaItems.map((s, i) => (
                                                            <li key={i} className="text-sky-600 dark:text-sky-400 text-sm flex items-start gap-1.5">
                                                                <span className="mt-0.5 shrink-0 text-sky-400">·</span>
                                                                {s.message}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                <div className="mb-6">
                                    <label className="block text-sm font-medium mb-2">Subir Láminas (Páginas)</label>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleAlbumPagesChange}
                                        className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                    />
                                </div>

                                <div className="space-y-8">
                                    <div className="space-y-12">
                                        {albumPages.map((page, idx) => {
                                            const pageErrors = albumValidationErrors.filter(e => e.pageIndex === idx);
                                            // Route membership badge — which routes include this page
                                            const routesWithPage = albumRoutes.filter(r => r.sequence.includes(page.id));
                                            return (
                                            <div key={page.id} className={`bg-gray-50 dark:bg-gray-900/50 p-6 rounded-xl border shadow-sm ${pageErrors.length > 0 ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
                                                <div className="flex justify-between items-center mb-4">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="font-bold text-lg text-indigo-700 dark:text-indigo-400">Lámina {idx + 1}</h4>
                                                        {/* Route membership badge */}
                                                        {albumRoutes.length > 0 && (
                                                            routesWithPage.length > 0 ? (
                                                                <span
                                                                    className="text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-full px-2 py-0.5 cursor-default"
                                                                    title={routesWithPage.map(r => r.name || '(sin nombre)').join(', ')}
                                                                >
                                                                    {routesWithPage.length === 1
                                                                        ? (routesWithPage[0].name || '1 ruta')
                                                                        : `${routesWithPage.length} rutas`}
                                                                </span>
                                                            ) : (
                                                                <span className="text-xs text-gray-400 dark:text-gray-600 italic">
                                                                    No incluida en rutas
                                                                </span>
                                                            )
                                                        )}
                                                        {/* Page reorder */}
                                                        <button
                                                            type="button"
                                                            disabled={idx === 0}
                                                            title="Mover arriba"
                                                            onClick={() => setAlbumPages(prev => {
                                                                const next = [...prev];
                                                                [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
                                                                return next;
                                                            })}
                                                            className="text-gray-400 hover:text-indigo-600 disabled:opacity-20"
                                                        >
                                                            <ChevronLeft className="rotate-90" size={16} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={idx === albumPages.length - 1}
                                                            title="Mover abajo"
                                                            onClick={() => setAlbumPages(prev => {
                                                                const next = [...prev];
                                                                [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                                                return next;
                                                            })}
                                                            className="text-gray-400 hover:text-indigo-600 disabled:opacity-20"
                                                        >
                                                            <ChevronLeft className="-rotate-90" size={16} />
                                                        </button>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setAlbumPages(prev => prev.map((p, i) => {
                                                                    if (i !== idx) return p;
                                                                    return {
                                                                        ...p,
                                                                        regions: [
                                                                            ...p.regions,
                                                                            {
                                                                                id: `region-${Date.now()}`,
                                                                                x: 40, y: 40, width: 20, height: 20,
                                                                                text: ''
                                                                            }
                                                                        ]
                                                                    };
                                                                }));
                                                            }}
                                                            className="flex items-center px-3 py-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-bold transition-colors"
                                                        >
                                                            <Plus size={14} className="mr-1" /> Zona
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => detectRegions(idx)}
                                                            disabled={analyzingIndex === idx}
                                                            className="flex items-center px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 text-xs font-bold transition-colors disabled:opacity-50"
                                                        >
                                                            <Scan size={14} className="mr-1" /> {analyzingIndex === idx ? 'Analizando...' : 'Auto-Detectar (IA)'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteAlbumPage(idx)}
                                                            className="flex items-center px-3 py-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs font-bold transition-colors"
                                                            title="Eliminar esta lámina"
                                                        >
                                                            <X size={14} className="mr-1" /> Eliminar
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* AI detection error — cleared on next analysis attempt */}
                                                {detectError?.index === idx && (
                                                    <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                                                        {detectError.message}
                                                    </div>
                                                )}

                                                {/* Per-page validation errors */}
                                                {pageErrors.length > 0 && (
                                                    <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 space-y-1">
                                                        {pageErrors.map((err, ei) => (
                                                            <p key={ei} className="text-red-600 dark:text-red-400 text-xs flex items-center gap-1.5">
                                                                <AlertTriangle size={12} className="shrink-0" />
                                                                {err.message}
                                                            </p>
                                                        ))}
                                                    </div>
                                                )}

                                                <div className="grid md:grid-cols-2 gap-6">
                                                    {/* VISUAL EDITOR */}
                                                    {/* Outer container: provides min-height and mouse event surface.
                                                        onMouseMove must use the img rect (not this div's rect) so
                                                        drag coordinates are in image-space matching region coords. */}
                                                    <div
                                                        className="relative w-full h-auto min-h-[400px] bg-gray-200 dark:bg-black/20 rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 select-none group"
                                                        onMouseMove={(e) => {
                                                            if (activeDrag && activeDrag.pageIdx === idx) {
                                                                // Use img rect, not container rect — the container's
                                                                // min-h may be taller than the image, which would skew
                                                                // percentage coordinates.
                                                                const imgEl = editorImgRefs.current.get(idx);
                                                                if (!imgEl) return;
                                                                const rect = imgEl.getBoundingClientRect();
                                                                const xPerc = ((e.clientX - rect.left) / rect.width) * 100;
                                                                const yPerc = ((e.clientY - rect.top) / rect.height) * 100;

                                                                setAlbumPages(prev => prev.map((p, i) => {
                                                                    if (i !== idx) return p;
                                                                    return {
                                                                        ...p,
                                                                        regions: p.regions.map(r => {
                                                                            if (r.id !== activeDrag.regionId) return r;
                                                                            const newR = { ...r };
                                                                            if (activeDrag.type === 'move') {
                                                                                newR.x = Math.max(0, Math.min(100 - newR.width, xPerc - activeDrag.offsetX));
                                                                                newR.y = Math.max(0, Math.min(100 - newR.height, yPerc - activeDrag.offsetY));
                                                                            } else if (activeDrag.type === 'resize') {
                                                                                newR.width = Math.max(5, xPerc - newR.x);
                                                                                newR.height = Math.max(5, yPerc - newR.y);
                                                                            }
                                                                            return newR;
                                                                        })
                                                                    };
                                                                }));
                                                            }
                                                        }}
                                                        onMouseUp={() => setActiveDrag(null)}
                                                        onMouseLeave={() => setActiveDrag(null)}
                                                    >
                                                        {/* Inner wrapper: sized to image content (h-auto matches img height).
                                                            Region overlays use % coords relative to this div = image-space. */}
                                                        <div className="relative w-full">
                                                        <img
                                                            ref={(el) => { if (el) editorImgRefs.current.set(idx, el); else editorImgRefs.current.delete(idx); }}
                                                            src={page.imageUrl}
                                                            className="block w-full h-auto object-contain pointer-events-none"
                                                            alt={`Lámina ${idx}`}
                                                        />

                                                        {/* Replace-image affordance — only for pages loaded from existing URLs (no File).
                                                            Allows swapping the image without deleting and re-creating the page + regions. */}
                                                        {!page.file && (
                                                            <label
                                                                className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/60 hover:bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded cursor-pointer transition-colors"
                                                                title="Reemplazar imagen de esta lámina"
                                                            >
                                                                <RefreshCw size={11} />
                                                                Reemplazar
                                                                <input
                                                                    type="file"
                                                                    accept="image/*"
                                                                    className="hidden"
                                                                    onChange={(e) => {
                                                                        const f = e.target.files?.[0];
                                                                        if (!f) return;
                                                                        const newUrl = URL.createObjectURL(f);
                                                                        setAlbumPages(prev => prev.map((p, i) =>
                                                                            i !== idx ? p : { ...p, file: f, imageUrl: newUrl }
                                                                        ));
                                                                    }}
                                                                />
                                                            </label>
                                                        )}

                                                        {/* Region Overlays — absolute % coords relative to inner wrapper = image-space */}
                                                        {page.regions.map((region, rIdx) => (
                                                            <div
                                                                key={region.id}
                                                                className={`absolute border-2 flex items-center justify-center cursor-move group/box transition-colors
                                                                ${highlightedRegionId === region.id ? 'border-indigo-500 bg-indigo-500/20 z-10' : 'border-yellow-400 bg-yellow-400/20 hover:border-yellow-500 hover:bg-yellow-400/30'}
                                                            `}
                                                                style={{
                                                                    left: `${region.x}%`,
                                                                    top: `${region.y}%`,
                                                                    width: `${region.width}%`,
                                                                    height: `${region.height}%`
                                                                }}
                                                                onMouseDown={(e) => {
                                                                    e.stopPropagation();
                                                                    // Use img rect (same source as onMouseMove) for
                                                                    // consistent offset calculation.
                                                                    const imgEl = editorImgRefs.current.get(idx);
                                                                    if (!imgEl) return;
                                                                    const rect = imgEl.getBoundingClientRect();
                                                                    const xPerc = ((e.clientX - rect.left) / rect.width) * 100;
                                                                    const yPerc = ((e.clientY - rect.top) / rect.height) * 100;
                                                                    setActiveDrag({ pageIdx: idx, regionId: region.id, type: 'move', offsetX: xPerc - region.x, offsetY: yPerc - region.y });
                                                                    setHighlightedRegionId(region.id);
                                                                }}
                                                            >
                                                                <span className={`text-[10px] px-1.5 py-0.5 font-bold rounded shadow-sm
                                                                ${highlightedRegionId === region.id ? 'bg-indigo-600 text-white' : 'bg-yellow-400 text-black'}
                                                            `}>
                                                                    {rIdx + 1}
                                                                </span>

                                                                {/* Resize Handle */}
                                                                <div
                                                                    className="absolute bottom-0 right-0 w-4 h-4 bg-white border border-gray-400 cursor-nwse-resize opacity-0 group-hover/box:opacity-100"
                                                                    onMouseDown={(e) => {
                                                                        e.stopPropagation();
                                                                        setActiveDrag({ pageIdx: idx, regionId: region.id, type: 'resize', offsetX: 0, offsetY: 0 });
                                                                    }}
                                                                />

                                                                {/* Delete Button (visible on hover) */}
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (confirm('¿Eliminar esta zona?')) {
                                                                            setAlbumPages(prev => prev.map((p, i) => {
                                                                                if (i !== idx) return p;
                                                                                return {
                                                                                    ...p,
                                                                                    regions: p.regions.filter(r => r.id !== region.id)
                                                                                };
                                                                            }));
                                                                        }
                                                                    }}
                                                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover/box:opacity-100 hover:scale-110 transition-all shadow-sm"
                                                                    title="Eliminar zona"
                                                                >
                                                                    <X size={10} />
                                                                </button>
                                                            </div>
                                                        ))}
                                                        </div> {/* /inner image wrapper */}
                                                    </div>

                                                    {/* TEXT & SEQUENCE LIST */}
                                                    <div className="flex flex-col h-full">
                                                        <div className="flex-1 space-y-3 overflow-y-auto pr-2 max-h-[300px] md:max-h-full scrollbar-thin">
                                                            {page.regions.length === 0 ? (
                                                                <div className="h-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-6">
                                                                    <Scan size={32} className="mb-2 opacity-50" />
                                                                    <p className="text-sm text-center">Inicia detectando zonas con IA o añade una manualmente.</p>
                                                                </div>
                                                            ) : (
                                                                page.regions.map((region, rIdx) => (
                                                                    <div
                                                                        key={region.id}
                                                                        className={`flex gap-2 items-start p-3 rounded-lg border transition-all
                                                                        ${highlightedRegionId === region.id ? 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-200 dark:bg-indigo-900/30 dark:border-indigo-700' : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700'}
                                                                    `}
                                                                        onMouseEnter={() => setHighlightedRegionId(region.id)}
                                                                        onMouseLeave={() => setHighlightedRegionId(null)}
                                                                    >
                                                                        <div className="flex flex-col items-center gap-1 mt-1">
                                                                            <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold
                                                                            ${highlightedRegionId === region.id ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}
                                                                        `}>
                                                                                {rIdx + 1}
                                                                            </span>

                                                                            {/* Sequence Controls */}
                                                                            <div className="flex flex-col">
                                                                                <button
                                                                                    type="button"
                                                                                    disabled={rIdx === 0}
                                                                                    onClick={() => {
                                                                                        setAlbumPages(prev => prev.map((p, i) => {
                                                                                            if (i !== idx) return p;
                                                                                            const newRegions = [...p.regions];
                                                                                            [newRegions[rIdx], newRegions[rIdx - 1]] = [newRegions[rIdx - 1], newRegions[rIdx]];
                                                                                            return { ...p, regions: newRegions };
                                                                                        }));
                                                                                    }}
                                                                                    className="text-gray-400 hover:text-indigo-600 disabled:opacity-20"
                                                                                >
                                                                                    <ChevronLeft className="rotate-90" size={14} />
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    disabled={rIdx === page.regions.length - 1}
                                                                                    onClick={() => {
                                                                                        setAlbumPages(prev => prev.map((p, i) => {
                                                                                            if (i !== idx) return p;
                                                                                            const newRegions = [...p.regions];
                                                                                            [newRegions[rIdx], newRegions[rIdx + 1]] = [newRegions[rIdx + 1], newRegions[rIdx]];
                                                                                            return { ...p, regions: newRegions };
                                                                                        }));
                                                                                    }}
                                                                                    className="text-gray-400 hover:text-indigo-600 disabled:opacity-20"
                                                                                >
                                                                                    <ChevronLeft className="-rotate-90" size={14} />
                                                                                </button>
                                                                            </div>
                                                                        </div>

                                                                        <div className="flex-1 space-y-2">
                                                                            {/* ── Region summary badge — at-a-glance action indicator ── */}
                                                                            {(() => {
                                                                                const actionType = region.action?.type || (region.type === 'focus' ? 'read' : region.type === 'challenge' ? 'challenge' : 'none');
                                                                                const audioMissing = actionType === 'audio' && !region.action?.audioUrl;
                                                                                const modeLabel = region.type === 'contemplative' ? 'Contemplación' : region.type === 'challenge' ? 'Desafío' : 'Narración';
                                                                                const actionLabel: Record<string, string> = {
                                                                                    read: '🔊 Narrar', audio: '🎵 Audio', jump: '→ Saltar',
                                                                                    return: '← Volver', text: '¶ Texto', leo: '✦ Leo',
                                                                                    none: '· Observar', challenge: '🎯 Desafío',
                                                                                };
                                                                                return (
                                                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                                                        <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 dark:text-gray-500 px-1.5 py-0.5 rounded-full">
                                                                                            {modeLabel}
                                                                                        </span>
                                                                                        {region.type !== 'challenge' && (
                                                                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                                                                                audioMissing ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' :
                                                                                                actionType === 'leo' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' :
                                                                                                actionType === 'jump' || actionType === 'return' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' :
                                                                                                actionType === 'audio' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' :
                                                                                                actionType === 'text' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                                                                                'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                                                                            }`}>
                                                                                                {actionLabel[actionType] ?? actionType}
                                                                                                {audioMissing && ' ⚠'}
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })()}

                                                                            <textarea
                                                                                value={region.text}
                                                                                onChange={(e) => {
                                                                                    const val = e.target.value;
                                                                                    setAlbumPages(prev => prev.map((p, i) => {
                                                                                        if (i !== idx) return p;
                                                                                        return {
                                                                                            ...p,
                                                                                            regions: p.regions.map((r, ri) => ri === rIdx ? { ...r, text: val } : r)
                                                                                        };
                                                                                    }));
                                                                                }}
                                                                                rows={3}
                                                                                className="w-full text-sm p-2 bg-transparent border-0 focus:ring-0 resize-none font-medium placeholder-gray-400"
                                                                                placeholder={
                                                                                    region.type === 'contemplative' ? 'Sin texto — zona de observación silenciosa' :
                                                                                    region.type === 'audio'         ? 'Opcional: texto descriptivo para acompañar el audio' :
                                                                                    region.type === 'nav'           ? 'Opcional: texto antes de saltar' :
                                                                                    'Escribe el texto que se leerá al tocar esta zona…'
                                                                                }
                                                                                disabled={region.type === 'contemplative'}
                                                                                onFocus={() => setHighlightedRegionId(region.id)}
                                                                            />

                                                                            {/* ── Region 2.0-C fields — Unified Action Model ── */}
                                                                            <div className="border-t border-gray-100 dark:border-gray-700 pt-2 space-y-2">
                                                                                <div className="flex flex-wrap gap-3 items-center">
                                                                                    <div>
                                                                                        <label className="block text-[10px] text-gray-500 mb-0.5">Modo de experiencia</label>
                                                                                        <select
                                                                                            value={region.type || 'focus'}
                                                                                            onChange={(e) => {
                                                                                                const val = e.target.value as 'focus' | 'contemplative' | 'challenge';
                                                                                                setAlbumPages(prev => prev.map((p, i) => {
                                                                                                    if (i !== idx) return p;
                                                                                                    return { ...p, regions: p.regions.map((r, ri) => ri === rIdx ? {
                                                                                                        ...r,
                                                                                                        type: val,
                                                                                                        isInteractive: val === 'challenge',
                                                                                                        // Clear text and action when switching to contemplative
                                                                                                        ...(val === 'contemplative' ? { text: '', action: undefined } : {}),
                                                                                                        // Clear action when switching to challenge (challenge IS the action)
                                                                                                        ...(val === 'challenge' ? { action: undefined } : {}),
                                                                                                    } : r) };
                                                                                                }));
                                                                                            }}
                                                                                            className="text-xs p-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                                                                                        >
                                                                                            <option value="focus">Narración con zoom</option>
                                                                                            <option value="contemplative">Contemplación silenciosa</option>
                                                                                            <option value="challenge">Desafío interactivo</option>
                                                                                        </select>
                                                                                    </div>
                                                                                    <div>
                                                                                        <label className="block text-[10px] text-gray-500 mb-0.5">Objetivo pedagógico</label>
                                                                                        <select
                                                                                            value={region.pedagogicalObjective || ''}
                                                                                            onChange={(e) => {
                                                                                                const val = e.target.value as AlbumRegion['pedagogicalObjective'] | '';
                                                                                                setAlbumPages(prev => prev.map((p, i) => {
                                                                                                    if (i !== idx) return p;
                                                                                                    return { ...p, regions: p.regions.map((r, ri) => ri === rIdx ? { ...r, pedagogicalObjective: val || undefined } : r) };
                                                                                                }));
                                                                                            }}
                                                                                            className="text-xs p-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                                                                                        >
                                                                                            <option value="">— ninguno —</option>
                                                                                            <option value="literal">Literal</option>
                                                                                            <option value="inferential">Inferencial</option>
                                                                                            <option value="reflective">Reflexivo</option>
                                                                                            <option value="writing">Escritura</option>
                                                                                        </select>
                                                                                    </div>
                                                                                </div>

                                                                                {/* ── Acción al tocar — 2.0-C unified action (hidden for challenge) ── */}
                                                                                {region.type !== 'challenge' && (
                                                                                    <div>
                                                                                        <label className="block text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide mb-0.5">
                                                                                            Acción al tocar
                                                                                        </label>
                                                                                        <select
                                                                                            value={region.action?.type || (region.type === 'focus' ? 'read' : 'none')}
                                                                                            onChange={(e) => {
                                                                                                const val = e.target.value as RegionActionType;
                                                                                                // Reset action to new type, clearing previous sub-fields
                                                                                                setAlbumPages(prev => prev.map((p, i) => {
                                                                                                    if (i !== idx) return p;
                                                                                                    return { ...p, regions: p.regions.map((r, ri) => ri === rIdx ? {
                                                                                                        ...r,
                                                                                                        action: { type: val } as RegionAction,
                                                                                                    } : r) };
                                                                                                }));
                                                                                            }}
                                                                                            className="text-xs p-1 border border-indigo-200 dark:border-indigo-700 rounded bg-white dark:bg-gray-800"
                                                                                        >
                                                                                            {region.type === 'focus' && <option value="read">Leer texto en voz alta</option>}
                                                                                            <option value="none">Sin acción — solo observar</option>
                                                                                            <option value="audio">Reproducir audio</option>
                                                                                            <option value="jump">Ir a otra lámina</option>
                                                                                            <option value="return">Volver a la lámina anterior</option>
                                                                                            <option value="text">Mostrar texto especial</option>
                                                                                            <option value="leo">Abrir Leo</option>
                                                                                        </select>
                                                                                    </div>
                                                                                )}

                                                                                {/* Conditional: challenge → interactiveHint */}
                                                                                {(region.type === 'challenge' || region.isInteractive) && (
                                                                                    <input
                                                                                        type="text"
                                                                                        value={region.interactiveHint || ''}
                                                                                        onChange={(e) => {
                                                                                            const val = e.target.value;
                                                                                            setAlbumPages(prev => prev.map((p, i) => {
                                                                                                if (i !== idx) return p;
                                                                                                return { ...p, regions: p.regions.map((r, ri) => ri === rIdx ? { ...r, interactiveHint: val } : r) };
                                                                                            }));
                                                                                        }}
                                                                                        placeholder="Pista del desafío…"
                                                                                        className="w-full text-xs p-1.5 border border-orange-200 dark:border-orange-700 rounded bg-white dark:bg-gray-800"
                                                                                    />
                                                                                )}

                                                                                {/* ── action.audio → Panel de gestión de audio (4.3 Media System) ── */}
                                                                                {region.action?.type === 'audio' && (() => {
                                                                                    const uploadKey  = `${idx}:${rIdx}`;
                                                                                    const uploadSt   = audioUploadState[uploadKey] ?? 'idle';
                                                                                    const currentUrl = region.action?.audioUrl;
                                                                                    const assetId    = region.action?.mediaAssetId;
                                                                                    const asset      = assetId ? albumMediaAssets.find(a => a.id === assetId) : null;
                                                                                    const assetLabel = asset?.title || asset?.originalFileName
                                                                                        || (currentUrl ? (currentUrl.startsWith('/uploads/') ? currentUrl.split('/').pop()! : 'Audio externo') : null);
                                                                                    const existingAudio = albumMediaAssets.filter(a => a.type === 'audio');

                                                                                    const applyAsset = (picked: AlbumMediaAsset) => {
                                                                                        setAlbumPages(prev => prev.map((p, i) => {
                                                                                            if (i !== idx) return p;
                                                                                            return { ...p, regions: p.regions.map((r, ri) => ri !== rIdx ? r : {
                                                                                                ...r, action: { type: 'audio' as const, audioUrl: picked.url, mediaAssetId: picked.id },
                                                                                            })};
                                                                                        }));
                                                                                    };

                                                                                    const removeAudio = () => {
                                                                                        setAlbumPages(prev => prev.map((p, i) => {
                                                                                            if (i !== idx) return p;
                                                                                            return { ...p, regions: p.regions.map((r, ri) => ri !== rIdx ? r : {
                                                                                                ...r, action: { type: 'audio' as const },
                                                                                            })};
                                                                                        }));
                                                                                    };

                                                                                    return (
                                                                                        <div className="space-y-1.5">
                                                                                            <label className="block text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                                                                                                Audio de la región
                                                                                            </label>

                                                                                            {/* Current audio display */}
                                                                                            {currentUrl ? (
                                                                                                <div className="flex items-center gap-1.5 p-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded text-xs">
                                                                                                    <Music size={11} className="text-blue-500 shrink-0" />
                                                                                                    <span className="flex-1 min-w-0 truncate text-blue-700 dark:text-blue-300 font-medium" title={currentUrl}>
                                                                                                        {assetLabel}
                                                                                                    </span>
                                                                                                    <audio src={currentUrl} controls preload="none" className="h-5 max-w-[100px]" />
                                                                                                    <button type="button" title="Quitar audio" onClick={removeAudio}
                                                                                                        className="text-red-400 hover:text-red-600 shrink-0 ml-0.5">
                                                                                                        <X size={11} />
                                                                                                    </button>
                                                                                                </div>
                                                                                            ) : (
                                                                                                <div className="flex items-center gap-1.5 p-1.5 rounded border border-dashed border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 text-red-600 dark:text-red-400">
                                                                                                    <AlertCircle size={11} className="shrink-0" />
                                                                                                    <p className="text-[10px] font-medium">Sin audio — esta acción no funcionará sin un archivo.</p>
                                                                                                </div>
                                                                                            )}

                                                                                            {/* Error badge */}
                                                                                            {uploadSt === 'error' && (
                                                                                                <div className="flex items-center gap-1.5 p-1.5 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                                                                                    <AlertCircle size={11} className="text-red-500 shrink-0" />
                                                                                                    <p className="text-[10px] text-red-600 dark:text-red-400 font-medium">Error al subir. El audio anterior se mantiene — vuelve a intentarlo.</p>
                                                                                                </div>
                                                                                            )}

                                                                                            {/* Action row */}
                                                                                            <div className="flex flex-wrap gap-1">
                                                                                                {/* Upload */}
                                                                                                <label className={`cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                                                                                                    uploadSt === 'uploading'
                                                                                                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                                                                                        : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700'
                                                                                                }`}>
                                                                                                    {uploadSt === 'uploading'
                                                                                                        ? <><RefreshCw size={9} className="animate-spin" /> Subiendo…</>
                                                                                                        : <><UploadCloud size={9} /> {currentUrl ? 'Reemplazar' : 'Subir audio'}</>
                                                                                                    }
                                                                                                    <input
                                                                                                        type="file"
                                                                                                        accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/*"
                                                                                                        disabled={uploadSt === 'uploading'}
                                                                                                        className="hidden"
                                                                                                        onChange={async (e) => {
                                                                                                            const file = e.target.files?.[0];
                                                                                                            e.target.value = '';
                                                                                                            if (!file) return;
                                                                                                            setAudioUploadState(prev => ({ ...prev, [uploadKey]: 'uploading' }));
                                                                                                            try {
                                                                                                                const uploadParentId = editingId ?? undefined;
                                                                                                                const url = await dataService.uploadFile(file, uploadParentId);
                                                                                                                const newAssetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                                                                                                                const newAsset: AlbumMediaAsset = {
                                                                                                                    id: newAssetId,
                                                                                                                    type: 'audio',
                                                                                                                    title: file.name.replace(/\.[^.]+$/, ''),
                                                                                                                    url,
                                                                                                                    source: 'upload',
                                                                                                                    mimeType: file.type || 'audio/mpeg',
                                                                                                                    originalFileName: file.name,
                                                                                                                };
                                                                                                                setAlbumMediaAssets(prev => [...prev, newAsset]);
                                                                                                                applyAsset(newAsset);
                                                                                                                setAudioUploadState(prev => ({ ...prev, [uploadKey]: 'idle' }));
                                                                                                                // @analytics: album_media_uploaded
                                                                                                                analyticsService.track({
                                                                                                                    event: 'album_media_uploaded',
                                                                                                                    userId: user?.id ?? 'unknown',
                                                                                                                    contentId: editingId ?? 'new',
                                                                                                                    timestamp: Date.now(),
                                                                                                                    streak: 0, level: 0, sessionDuration: 0,
                                                                                                                    assetId: newAssetId,
                                                                                                                    mimeType: file.type || 'audio/mpeg',
                                                                                                                    fileSizeBytes: file.size,
                                                                                                                    originalFileName: file.name,
                                                                                                                });
                                                                                                            } catch {
                                                                                                                setAudioUploadState(prev => ({ ...prev, [uploadKey]: 'error' }));
                                                                                                            }
                                                                                                        }}
                                                                                                    />
                                                                                                </label>

                                                                                                {/* Pick existing asset */}
                                                                                                {existingAudio.length > 0 && (
                                                                                                    <select
                                                                                                        value={assetId || ''}
                                                                                                        onChange={(e) => {
                                                                                                            const picked = albumMediaAssets.find(a => a.id === e.target.value);
                                                                                                            if (picked) applyAsset(picked);
                                                                                                        }}
                                                                                                        className="text-[10px] px-1.5 py-1 border border-blue-200 dark:border-blue-700 rounded bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 max-w-[130px]"
                                                                                                    >
                                                                                                        <option value="">Usar existente…</option>
                                                                                                        {existingAudio.map(a => (
                                                                                                            <option key={a.id} value={a.id}>
                                                                                                                {a.title || a.originalFileName || a.url.split('/').pop()}
                                                                                                            </option>
                                                                                                        ))}
                                                                                                    </select>
                                                                                                )}

                                                                                                {/* External URL toggle */}
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={() => setShowExternalUrlRegion(prev => prev === uploadKey ? null : uploadKey)}
                                                                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                                                                                >
                                                                                                    <LinkIcon size={9} /> URL externa
                                                                                                </button>
                                                                                            </div>

                                                                                            {/* External URL input (colapsable) */}
                                                                                            {showExternalUrlRegion === uploadKey && (
                                                                                                <div className="flex gap-1">
                                                                                                    <input
                                                                                                        type="url"
                                                                                                        defaultValue=""
                                                                                                        placeholder="https://ejemplo.com/audio.mp3"
                                                                                                        className="flex-1 text-xs p-1.5 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800"
                                                                                                        onKeyDown={(e) => {
                                                                                                            if (e.key !== 'Enter') return;
                                                                                                            const val = (e.target as HTMLInputElement).value.trim();
                                                                                                            if (!val) return;
                                                                                                            const newAssetId = `asset-ext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                                                                                                            const existing = albumMediaAssets.find(a => a.url === val);
                                                                                                            const picked = existing ?? {
                                                                                                                id: newAssetId, type: 'audio' as const,
                                                                                                                title: val.split('/').pop() ?? 'Audio externo',
                                                                                                                url: val, source: 'external' as const,
                                                                                                            };
                                                                                                            if (!existing) setAlbumMediaAssets(prev => [...prev, picked]);
                                                                                                            applyAsset(picked);
                                                                                                            setShowExternalUrlRegion(null);
                                                                                                        }}
                                                                                                    />
                                                                                                    <button type="button" onClick={() => setShowExternalUrlRegion(null)}
                                                                                                        className="text-gray-400 hover:text-gray-600 px-1">
                                                                                                        <X size={11} />
                                                                                                    </button>
                                                                                                </div>
                                                                                            )}
                                                                                        {/* 1.5 Unused assets hint — informational only, non-blocking */}
                                                                                        {(() => {
                                                                                            const usedIds = new Set(
                                                                                                albumPages.flatMap(p => p.regions.map(r => r.action?.mediaAssetId)).filter(Boolean)
                                                                                            );
                                                                                            const orphans = albumMediaAssets.filter(a => a.type === 'audio' && !usedIds.has(a.id));
                                                                                            if (orphans.length === 0) return null;
                                                                                            return (
                                                                                                <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">
                                                                                                    {orphans.length === 1
                                                                                                        ? `1 audio en la biblioteca no está usado en ninguna zona.`
                                                                                                        : `${orphans.length} audios en la biblioteca no están usados en ninguna zona.`}
                                                                                                </p>
                                                                                            );
                                                                                        })()}
                                                                                        </div>
                                                                                    );
                                                                                })()}

                                                                                {/* Conditional: action.jump → page selector */}
                                                                                {region.action?.type === 'jump' && (
                                                                                    <div className="space-y-1">
                                                                                        <label className="block text-[10px] font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide">
                                                                                            Lámina destino
                                                                                        </label>
                                                                                        <select
                                                                                            value={region.action?.targetPageId || ''}
                                                                                            onChange={(e) => {
                                                                                                const val = e.target.value;
                                                                                                setAlbumPages(prev => prev.map((p, i) => {
                                                                                                    if (i !== idx) return p;
                                                                                                    return { ...p, regions: p.regions.map((r, ri) => ri === rIdx ? { ...r, action: { ...r.action, type: 'jump' as const, targetPageId: val || undefined } } : r) };
                                                                                                }));
                                                                                            }}
                                                                                            className="w-full text-xs p-1.5 border border-purple-200 dark:border-purple-700 rounded bg-white dark:bg-gray-800"
                                                                                        >
                                                                                            <option value="">— seleccionar lámina —</option>
                                                                                            {albumPages.map((p, pi) => pi !== idx && (
                                                                                                <option key={p.id} value={p.id}>
                                                                                                    Lámina {pi + 1}{p.text ? ` — ${p.text.slice(0, 40)}` : ''}
                                                                                                </option>
                                                                                            ))}
                                                                                        </select>
                                                                                        {region.action?.targetPageId && !albumPages.some(p => p.id === region.action?.targetPageId) && (
                                                                                            <p className="text-[10px] text-red-600">⚠ Referencia rota — la lámina destino ya no existe.</p>
                                                                                        )}
                                                                                    </div>
                                                                                )}

                                                                                {/* Conditional: action.text → secondary text input */}
                                                                                {region.action?.type === 'text' && (
                                                                                    <div>
                                                                                        <label className="block text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide mb-0.5">
                                                                                            Texto especial a mostrar
                                                                                        </label>
                                                                                        <textarea
                                                                                            value={region.action?.text || ''}
                                                                                            onChange={(e) => {
                                                                                                const val = e.target.value;
                                                                                                setAlbumPages(prev => prev.map((p, i) => {
                                                                                                    if (i !== idx) return p;
                                                                                                    return { ...p, regions: p.regions.map((r, ri) => ri === rIdx ? { ...r, action: { ...r.action, type: 'text' as const, text: val || undefined } } : r) };
                                                                                                }));
                                                                                            }}
                                                                                            placeholder="Ej: ¿Qué crees que siente el personaje?"
                                                                                            rows={2}
                                                                                            className="w-full text-xs p-1.5 border border-emerald-200 dark:border-emerald-700 rounded bg-white dark:bg-gray-800 resize-none"
                                                                                        />
                                                                                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Se muestra como panel secundario bajo el texto narrativo.</p>
                                                                                    </div>
                                                                                )}

                                                                                {/* Conditional: action.leo → optional seed prompt */}
                                                                                {region.action?.type === 'leo' && (
                                                                                    <div>
                                                                                        <label className="block text-[10px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide mb-0.5">
                                                                                            Mensaje inicial de Leo (opcional)
                                                                                        </label>
                                                                                        <input
                                                                                            type="text"
                                                                                            value={region.action?.leoPrompt || ''}
                                                                                            onChange={(e) => {
                                                                                                const val = e.target.value;
                                                                                                setAlbumPages(prev => prev.map((p, i) => {
                                                                                                    if (i !== idx) return p;
                                                                                                    return { ...p, regions: p.regions.map((r, ri) => ri === rIdx ? { ...r, action: { ...r.action, type: 'leo' as const, leoPrompt: val || undefined } } : r) };
                                                                                                }));
                                                                                            }}
                                                                                            placeholder="Ej: ¿Qué te hace sentir esta imagen?"
                                                                                            className="w-full text-xs p-1.5 border border-indigo-200 dark:border-indigo-600 rounded bg-white dark:bg-gray-800"
                                                                                        />
                                                                                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Leo lo dirá al lector al abrir el chat desde esta zona.</p>
                                                                                    </div>
                                                                                )}

                                                                                {/* Optional: leoHint — context injected into Leo's system prompt */}
                                                                                <input
                                                                                    type="text"
                                                                                    value={region.leoHint || ''}
                                                                                    onChange={(e) => {
                                                                                        const val = e.target.value;
                                                                                        setAlbumPages(prev => prev.map((p, i) => {
                                                                                            if (i !== idx) return p;
                                                                                            return { ...p, regions: p.regions.map((r, ri) => ri === rIdx ? { ...r, leoHint: val || undefined } : r) };
                                                                                        }));
                                                                                    }}
                                                                                    placeholder="Contexto para Leo (opcional)…"
                                                                                    className="w-full text-xs p-1.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* ── Page-level 2.0-A fields ── */}
                                                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Opciones de lámina</p>
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Texto narrativo (estado panorámica)</label>
                                                        <textarea
                                                            value={page.text || ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                setAlbumPages(prev => prev.map((p, i) => i === idx ? { ...p, text: val } : p));
                                                            }}
                                                            rows={2}
                                                            placeholder="Texto que aparece al ver la página completa antes de entrar en zonas…"
                                                            className="w-full text-sm p-2 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 resize-none"
                                                        />
                                                    </div>
                                                    <div className="flex flex-wrap gap-4 items-center">
                                                        {/* Tipo de página + modo de agrupación para dobles */}
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tipo de página</label>
                                                            <div className="flex flex-col gap-1">
                                                                <select
                                                                    value={page.pageType || 'single'}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value as 'single' | 'double';
                                                                        setAlbumPages(prev => prev.map((p, i) => i === idx
                                                                            ? { ...p, pageType: val, doublePageMode: val === 'double' ? (p.doublePageMode ?? 'with_next') : undefined }
                                                                            : p
                                                                        ));
                                                                    }}
                                                                    className="text-sm p-1.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                                                                >
                                                                    <option value="single">Simple</option>
                                                                    <option value="double">Doble (panorámica)</option>
                                                                </select>
                                                                {page.pageType === 'double' && (
                                                                    <select
                                                                        value={page.doublePageMode ?? 'with_next'}
                                                                        onChange={(e) => {
                                                                            const val = e.target.value as 'with_next' | 'with_previous';
                                                                            setAlbumPages(prev => prev.map((p, i) => i === idx ? { ...p, doublePageMode: val } : p));
                                                                        }}
                                                                        className="text-sm p-1.5 border border-indigo-200 dark:border-indigo-700 rounded bg-indigo-50 dark:bg-indigo-900/20"
                                                                    >
                                                                        <option value="with_next">→ continúa en la siguiente</option>
                                                                        <option value="with_previous">← continúa desde la anterior</option>
                                                                    </select>
                                                                )}
                                                                {page.pageType === 'double' && (page.doublePageMode ?? 'with_next') === 'with_previous' && idx === 0 && (
                                                                    <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Primera lámina: no tiene anterior.</p>
                                                                )}
                                                                {page.pageType === 'double' && (page.doublePageMode ?? 'with_next') === 'with_next' && idx === albumPages.length - 1 && (
                                                                    <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Última lámina: no tiene siguiente.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {/* Audio ambiente — uploader + selección de banco de media + URL externa */}
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Audio ambiente (opcional)</label>
                                                        <div className="flex flex-col gap-1.5">
                                                            {/* Tier 1: upload new file */}
                                                            <div className="flex items-center gap-2">
                                                                <label className="cursor-pointer flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                                                    <Music size={13} />
                                                                    {page.ambientAudioFile ? page.ambientAudioFile.name : 'Subir MP3 / WAV'}
                                                                    <input
                                                                        type="file"
                                                                        accept=".mp3,.wav,.ogg,.aac,.m4a,audio/*"
                                                                        className="hidden"
                                                                        onChange={(e) => {
                                                                            const file = e.target.files?.[0] ?? null;
                                                                            if (file) {
                                                                                setAlbumPages(prev => prev.map((p, i) =>
                                                                                    i === idx ? { ...p, ambientAudioFile: file, ambientAudioUrl: '' } : p
                                                                                ));
                                                                            }
                                                                        }}
                                                                    />
                                                                </label>
                                                                {(page.ambientAudioFile || page.ambientAudioUrl) && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setAlbumPages(prev => prev.map((p, i) =>
                                                                            i === idx ? { ...p, ambientAudioFile: undefined, ambientAudioUrl: '' } : p
                                                                        ))}
                                                                        className="text-xs text-red-400 hover:text-red-600"
                                                                        title="Quitar audio"
                                                                    >
                                                                        <X size={13} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {/* Tier 2: pick from album media assets (only when assets exist) */}
                                                            {!page.ambientAudioFile && albumMediaAssets.filter(a => a.type === 'audio').length > 0 && (
                                                                <select
                                                                    value={albumMediaAssets.find(a => a.url === page.ambientAudioUrl)?.id ?? ''}
                                                                    onChange={(e) => {
                                                                        const asset = albumMediaAssets.find(a => a.id === e.target.value);
                                                                        setAlbumPages(prev => prev.map((p, i) =>
                                                                            i === idx ? { ...p, ambientAudioUrl: asset?.url ?? '', ambientAudioFile: undefined } : p
                                                                        ));
                                                                    }}
                                                                    className="text-sm p-1.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                                                                >
                                                                    <option value="">— elegir del banco de audio —</option>
                                                                    {albumMediaAssets.filter(a => a.type === 'audio').map(a => (
                                                                        <option key={a.id} value={a.id}>
                                                                            {a.title ?? a.originalFileName ?? a.id}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            )}
                                                            {/* Tier 3: external URL fallback */}
                                                            {!page.ambientAudioFile && (
                                                                <input
                                                                    type="text"
                                                                    value={page.ambientAudioUrl || ''}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value;
                                                                        setAlbumPages(prev => prev.map((p, i) => i === idx ? { ...p, ambientAudioUrl: val } : p));
                                                                    }}
                                                                    placeholder="o pega una URL externa: https://…"
                                                                    className="w-full text-sm p-2 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                                                                />
                                                            )}
                                                            {/* Loop toggle — shown whenever audio is configured */}
                                                            {(page.ambientAudioFile || page.ambientAudioUrl) && (
                                                                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={page.ambientAudioLoop !== false}
                                                                        onChange={(e) => setAlbumPages(prev => prev.map((p, i) =>
                                                                            i === idx ? { ...p, ambientAudioLoop: e.target.checked } : p
                                                                        ))}
                                                                        className="rounded"
                                                                    />
                                                                    Repetir en bucle
                                                                </label>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ); })}
                                    </div>
                                </div>

                                {/* ── Rutas de lectura del álbum ──────────────────────────────────── */}
                                {albumPages.length > 0 && (
                                    <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                                        {(() => {
                                            const totalWarnings = albumRoutes.reduce((acc, r) => {
                                                const v = validateAlbumRoutes([r], albumPages)[0];
                                                return acc + v.warnings.length;
                                            }, 0);
                                            const totalErrors = albumRoutes.reduce((acc, r) => {
                                                const v = validateAlbumRoutes([r], albumPages)[0];
                                                return acc + v.errors.length;
                                            }, 0);
                                            return (
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-sm font-bold text-indigo-600 dark:text-indigo-400">Rutas de lectura del álbum</h3>
                                                    {totalErrors > 0 && (
                                                        <span className="text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded">
                                                            {totalErrors} {totalErrors === 1 ? 'error' : 'errores'}
                                                        </span>
                                                    )}
                                                    {totalErrors === 0 && totalWarnings > 0 && (
                                                        <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                                                            {totalWarnings} {totalWarnings === 1 ? 'advertencia' : 'advertencias'}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Caminos editoriales que el lector elige al abrir el álbum. Sin rutas → lectura lineal.</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const id = `route-${Date.now()}`;
                                                    // Pre-populate with all album pages in order.
                                                    // This gives the editor a starting point — remove
                                                    // or reorder to create the actual path.
                                                    setAlbumRoutes(prev => [...prev, {
                                                        id,
                                                        name: '',
                                                        sequence: albumPages.map(p => p.id),
                                                    }]);
                                                }}
                                                className="flex items-center px-3 py-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 text-xs font-bold shrink-0 ml-4"
                                            >
                                                <Plus size={13} className="mr-1" /> Nueva ruta
                                            </button>
                                        </div>
                                            );
                                        })()}

                                        {albumRoutes.length === 0 ? (
                                            <p className="text-xs text-gray-400 dark:text-gray-600 text-center italic py-4">Sin rutas. El álbum se leerá en orden lineal.</p>
                                        ) : (
                                            <div className="space-y-4">
                                                {albumRoutes.map((route, ri) => {
                                                    const routeVal = validateAlbumRoutes([route], albumPages)[0];
                                                    const hasErrors   = routeVal.errors.length > 0;
                                                    const hasWarnings = routeVal.warnings.length > 0;
                                                    return (
                                                    <div key={route.id} className={`bg-white dark:bg-gray-800 border rounded-xl p-4 ${hasErrors ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
                                                        {/* Route header: icon + name + delete */}
                                                        <div className="flex items-start gap-2 mb-2">
                                                            <input
                                                                type="text"
                                                                value={route.icon ?? ''}
                                                                onChange={e => setAlbumRoutes(prev => prev.map((r, i) => i === ri ? { ...r, icon: e.target.value } : r))}
                                                                placeholder="📖"
                                                                maxLength={2}
                                                                title="Emoji o símbolo"
                                                                className="w-11 text-center text-lg p-1 border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 shrink-0"
                                                            />
                                                            <input
                                                                type="text"
                                                                value={route.name}
                                                                onChange={e => setAlbumRoutes(prev => prev.map((r, i) => i === ri ? { ...r, name: e.target.value } : r))}
                                                                placeholder="Nombre de la ruta (ej: Ruta del protagonista)"
                                                                className={`flex-1 text-sm p-2 border rounded bg-gray-50 dark:bg-gray-700 ${!route.name.trim() ? 'border-red-300 dark:border-red-600' : 'border-gray-200 dark:border-gray-600'}`}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setAlbumRoutes(prev => prev.filter((_, i) => i !== ri))}
                                                                className="p-2 text-red-400 hover:text-red-600 shrink-0"
                                                                title="Eliminar ruta"
                                                            >
                                                                <Trash size={14} />
                                                            </button>
                                                        </div>
                                                        {/* Description */}
                                                        <input
                                                            type="text"
                                                            value={route.description ?? ''}
                                                            onChange={e => setAlbumRoutes(prev => prev.map((r, i) => i === ri ? { ...r, description: e.target.value } : r))}
                                                            placeholder="Descripción breve (opcional, visible al lector)"
                                                            className="w-full text-xs p-2 border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 mb-2"
                                                        />
                                                        {/* Validation feedback */}
                                                        {hasErrors && (
                                                            <div className="mb-2 space-y-1">
                                                                {routeVal.errors.map((err, ei) => (
                                                                    <p key={ei} className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                                                        <AlertTriangle size={11} className="shrink-0" /> {err}
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {hasWarnings && (
                                                            <div className="mb-2 space-y-1">
                                                                {routeVal.warnings.map((w, wi) => (
                                                                    <p key={wi} className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                                                        <AlertCircle size={11} className="shrink-0" /> {w}
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {!hasErrors && routeVal.coverage && routeVal.coverage.total > 0 && (
                                                            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                                                                Cubre {routeVal.coverage.pages} de {routeVal.coverage.total} láminas
                                                            </p>
                                                        )}
                                                        {/* Sequence editor */}
                                                        <div>
                                                            <div className="flex items-center justify-between mb-2">
                                                                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Secuencia de láminas</p>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const nextPage = albumPages.find(p => !route.sequence.includes(p.id));
                                                                        if (nextPage) {
                                                                            setAlbumRoutes(prev => prev.map((r, i) =>
                                                                                i === ri ? { ...r, sequence: [...r.sequence, nextPage.id] } : r
                                                                            ));
                                                                        }
                                                                    }}
                                                                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                                                                >
                                                                    + Añadir lámina
                                                                </button>
                                                            </div>
                                                            {route.sequence.length === 0 ? (
                                                                <p className="text-xs text-gray-400 italic">Sin láminas en esta ruta.</p>
                                                            ) : (
                                                                <ol className="space-y-1.5">
                                                                    {route.sequence.map((pageId, si) => {
                                                                        const pageIdx = albumPages.findIndex(p => p.id === pageId);
                                                                        const pageExists = pageIdx >= 0;
                                                                        return (
                                                                            <li key={`${pageId}-${si}`} className="flex items-center gap-1.5 text-xs">
                                                                                <span className="text-gray-400 w-4 text-right shrink-0">{si + 1}.</span>
                                                                                <select
                                                                                    value={pageId}
                                                                                    onChange={e => {
                                                                                        const newId = e.target.value;
                                                                                        setAlbumRoutes(prev => prev.map((r, i) => {
                                                                                            if (i !== ri) return r;
                                                                                            const s = [...r.sequence];
                                                                                            s[si] = newId;
                                                                                            return { ...r, sequence: s };
                                                                                        }));
                                                                                    }}
                                                                                    className={`flex-1 p-1 border rounded text-xs bg-white dark:bg-gray-700 ${pageExists ? 'border-gray-200 dark:border-gray-600' : 'border-red-300 text-red-600'}`}
                                                                                >
                                                                                    {!pageExists && <option value={pageId}>⚠ Lámina no encontrada</option>}
                                                                                    {albumPages.map((p, pi) => (
                                                                                        <option key={p.id} value={p.id}>
                                                                                            Lámina {pi + 1}{p.text ? ` — ${p.text.slice(0, 28)}` : ''}
                                                                                        </option>
                                                                                    ))}
                                                                                </select>
                                                                                <button
                                                                                    type="button"
                                                                                    disabled={si === 0}
                                                                                    onClick={() => setAlbumRoutes(prev => prev.map((r, i) => {
                                                                                        if (i !== ri) return r;
                                                                                        const s = [...r.sequence]; [s[si], s[si - 1]] = [s[si - 1], s[si]]; return { ...r, sequence: s };
                                                                                    }))}
                                                                                    className="text-gray-400 hover:text-indigo-600 disabled:opacity-20 px-0.5"
                                                                                    title="Subir"
                                                                                >↑</button>
                                                                                <button
                                                                                    type="button"
                                                                                    disabled={si === route.sequence.length - 1}
                                                                                    onClick={() => setAlbumRoutes(prev => prev.map((r, i) => {
                                                                                        if (i !== ri) return r;
                                                                                        const s = [...r.sequence]; [s[si], s[si + 1]] = [s[si + 1], s[si]]; return { ...r, sequence: s };
                                                                                    }))}
                                                                                    className="text-gray-400 hover:text-indigo-600 disabled:opacity-20 px-0.5"
                                                                                    title="Bajar"
                                                                                >↓</button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setAlbumRoutes(prev => prev.map((r, i) => {
                                                                                        if (i !== ri) return r;
                                                                                        return { ...r, sequence: r.sequence.filter((_, j) => j !== si) };
                                                                                    }))}
                                                                                    className="text-red-400 hover:text-red-600 px-0.5"
                                                                                    title="Quitar de la ruta"
                                                                                >×</button>
                                                                            </li>
                                                                        );
                                                                    })}
                                                                </ol>
                                                            )}
                                                        </div>
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {(mainContent.tipo === 'libro' || mainContent.tipo === 'articulo_pedagogico') && (
                            <div className="pt-6">
                                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">Archivos Opcionales para Experiencia Enriquecida</h3>

                                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg mb-4 border border-yellow-200 dark:border-yellow-700">
                                    <p className="text-sm text-yellow-800 dark:text-yellow-200 flex items-start">
                                        <span className="mr-2 text-lg">⚠️</span>
                                        <b>Importante para Accesibilidad:</b> Para que funcionen el "Modo Guiado" (Dislexia/TTS) y el "Modo Inmersivo", es <u>obligatorio</u> subir el archivo de texto plano (.txt) correspondiente.
                                    </p>
                                </div>

                                <div className="grid md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium mb-1">Texto Plano (Español)</label>
                                        <input type="file" accept=".txt,.md" onChange={(e) => handleMainFileChange(e, 'textoPlanoFile')} className="w-full text-xs text-gray-500" />
                                        <p className="text-[10px] text-gray-500 mt-1">Requerido para voz y adaptación.</p>
                                        {editingId && !mainContent.textoPlanoFile && existingParents.find(p => p.id === editingId)?.texto_plano_url && (
                                            <p className="mt-1 text-[10px] text-green-600">✓ Archivo actual existe</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium mb-1">Texto Plano (Inglés)</label>
                                        <input type="file" accept=".txt" onChange={(e) => handleMainFileChange(e, 'textoInglesFile')} className="w-full text-xs text-gray-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium mb-1">Texto Plano (Portugués)</label>
                                        <input type="file" accept=".txt" onChange={(e) => handleMainFileChange(e, 'textoPortuguesFile')} className="w-full text-xs text-gray-500" />
                                    </div>
                                    <div className="md:col-span-3 mt-2">
                                        <label className="block text-xs font-medium mb-1">Galería de Ilustraciones (Selección múltiple)</label>
                                        <input type="file" accept="image/*" multiple onChange={handleIllustrationsChange} className="w-full text-xs text-gray-500" />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 3. Selector de Padre Existente (Solo si es EXISTING) */}
                {
                    uploadMode === 'existing' && mainContent.tipo !== 'memoria_club' && (
                        <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 animate-in slide-in-from-bottom-4">
                            <h2 className="text-xl font-bold mb-4 flex items-center"><LinkIcon className="mr-2" /> Vincular a Obra Existente</h2>
                            <label className="block text-sm font-medium mb-2">Selecciona el Libro o Colección al que pertenecen los materiales:</label>
                            <select
                                value={selectedParentId}
                                onChange={(e) => setSelectedParentId(e.target.value)}
                                className="w-full p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg"
                            >
                                <option value="">-- Selecciona una obra --</option>
                                {existingParents.map(p => (
                                    <option key={p.id} value={p.id}>{p.titulo} ({p.tipo})</option>
                                ))}
                            </select>
                        </div>
                    )
                }

                {/* 4. Materiales del Ecosistema (Hijos) */}
                {
                    mainContent.tipo !== 'memoria_club' && (
                        <div className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200 flex items-center">
                                    <Layers className="mr-2 text-indigo-500" /> Materiales del Ecosistema
                                </h2>
                                <button type="button" onClick={addMaterial} className="flex items-center px-4 py-2 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 rounded-lg hover:bg-indigo-200 transition-colors text-sm font-bold">
                                    <Plus size={16} className="mr-2" /> Añadir Material
                                </button>
                            </div>

                            {materiales.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    No hay materiales adicionales. Haz clic en "Añadir Material" para subir guías, videos o actividades asociadas.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {materiales.map((mat, index) => (
                                        <div key={mat.id || index} className="animate-in fade-in transition-all">
                                            <div className="bg-white dark:bg-gray-800 p-4 rounded-t-lg shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col md:flex-row gap-4 items-start md:items-end z-10 relative">
                                                <div className="w-full md:w-1/5">
                                                    <label className="block text-xs font-bold text-gray-500 mb-1">Tipo</label>
                                                    <select
                                                        value={mat.tipo}
                                                        onChange={(e) => updateMaterial(mat.id, 'tipo', e.target.value)}
                                                        className="w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                                                    >
                                                        <option value="guia">Guía (PDF)</option>
                                                        <option value="video">Video</option>
                                                        <option value="podcast">Podcast</option>
                                                        <option value="actividad">Actividad</option>
                                                        {user?.roles?.includes('administrador') && (
                                                            <option value="contexto_pedagogico">Contexto Pedagógico (PDF/TXT, Solo Admin)</option>
                                                        )}
                                                    </select>
                                                </div>
                                                <div className="w-full md:w-1/3">
                                                    <label className="block text-xs font-bold text-gray-500 mb-1">Título del Material</label>
                                                    <input
                                                        type="text"
                                                        value={mat.titulo}
                                                        onChange={(e) => updateMaterial(mat.id, 'titulo', e.target.value)}
                                                        placeholder="Ej. Guía para el docente"
                                                        className="w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                                                        required
                                                    />
                                                </div>
                                                <div className="w-full md:w-1/5">
                                                    <label className="block text-xs font-bold text-gray-500 mb-1">Público</label>
                                                    <select
                                                        value={mat.tipo === 'contexto_pedagogico' ? 'administrador' : mat.publico}
                                                        onChange={(e) => updateMaterial(mat.id, 'publico', e.target.value)}
                                                        disabled={mat.tipo === 'contexto_pedagogico'}
                                                        className="w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 disabled:opacity-50"
                                                    >
                                                        <option value="profesores">Profesores</option>
                                                        <option value="estudiantes">Estudiantes</option>
                                                        <option value="todos">Todos</option>
                                                        <option value="administrador">Solo Administradores</option>
                                                    </select>
                                                </div>
                                                <div className="w-full md:flex-1">
                                                    <label className="block text-xs font-bold text-gray-500 mb-1">Archivo o Enlace</label>
                                                    <div className="flex flex-col gap-2">
                                                        <input
                                                            type="text"
                                                            placeholder="Pegar enlace (https://...)"
                                                            value={mat.url || ''}
                                                            onChange={(e) => updateMaterial(mat.id, 'url', e.target.value)}
                                                            className="w-full p-2 text-sm rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
                                                        />
                                                        <div className="text-center text-[10px] text-gray-400">- O -</div>
                                                        <input
                                                            type="file"
                                                            accept={mat.tipo === 'contexto_pedagogico' ? '.pdf,.txt' : '*/*'}
                                                            onChange={(e) => updateMaterial(mat.id, 'file', e.target.files?.[0] || null)}
                                                            className="w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                                                            required={!mat.url}
                                                        />
                                                    </div>
                                                </div>
                                                <button type="button" onClick={() => removeMaterial(mat.id)} className="text-red-500 hover:bg-red-50 p-2 rounded transition-colors" title="Eliminar">
                                                    <Trash size={18} />
                                                </button>
                                            </div>
                                            {/* Extended Metadata for Material */}
                                            < div className="bg-white dark:bg-gray-800 p-4 -mt-2 mb-4 rounded-b-lg border-x border-b border-gray-200 dark:border-gray-700 flex gap-4 animate-in fade-in" >
                                                <div className="flex-1">
                                                    <input
                                                        type="text"
                                                        placeholder="Autor del material (Opcional)"
                                                        value={mat.autor || ''}
                                                        onChange={(e) => updateMaterial(mat.id, 'autor', e.target.value)}
                                                        className="w-full p-2 text-xs border border-gray-200 dark:border-gray-600 rounded mb-2"
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Etiquetas (sep. por comas)"
                                                        value={mat.etiquetas ? mat.etiquetas.join(', ') : ''}
                                                        onChange={(e) => updateMaterial(mat.id, 'etiquetas', e.target.value.split(',').map(s => s.trim()))}
                                                        className="w-full p-2 text-xs border border-gray-200 dark:border-gray-600 rounded"
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <textarea
                                                        placeholder="Descripción del material..."
                                                        value={mat.descripcion || ''}
                                                        onChange={(e) => updateMaterial(mat.id, 'descripcion', e.target.value)}
                                                        className="w-full h-full p-2 text-xs border border-gray-200 dark:border-gray-600 rounded resize-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                }

                <div className="pt-4">
                    {/* Inline error — shown instead of alert() so the form stays accessible for retry */}
                    {uploadError && (
                        <div className="mb-3 flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg px-4 py-3">
                            <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-red-700 dark:text-red-300 text-sm font-medium">{uploadError}</p>
                                <p className="text-red-500 dark:text-red-400 text-xs mt-0.5">Revisa los datos y vuelve a intentarlo.</p>
                            </div>
                            <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-600 shrink-0 ml-1">
                                <X size={14} />
                            </button>
                        </div>
                    )}
                    {/* UX-5A — barra de progreso por archivo. Solo se muestra
                        durante uploads activos. En fase 'processing' (último
                        byte ya salió pero el servidor sigue validando/hashing)
                        cambiamos el texto para que el usuario sepa que el
                        sistema está vivo aunque el % no avance. */}
                    {isUploading && uploadProgress && (
                        <div className="mb-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded-lg px-4 py-3">
                            <div className="flex items-center justify-between text-xs font-medium text-blue-800 dark:text-blue-200">
                                <span className="truncate pr-2">{uploadProgress.label}</span>
                                <span className="tabular-nums shrink-0">
                                    {uploadProgress.phase === 'processing'
                                        ? 'Procesando…'
                                        : `${Math.round(uploadProgress.fraction * 100)}%`}
                                </span>
                            </div>
                            <div
                                role="progressbar"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(uploadProgress.fraction * 100)}
                                aria-label={`Subida de ${uploadProgress.label}`}
                                className="mt-2 w-full h-2 bg-blue-100 dark:bg-blue-950 rounded overflow-hidden"
                            >
                                <div
                                    className={`h-full transition-all duration-200 ${uploadProgress.phase === 'processing' ? 'bg-blue-400 dark:bg-blue-500 animate-pulse w-full' : 'bg-blue-600 dark:bg-blue-400'}`}
                                    style={uploadProgress.phase === 'processing'
                                        ? undefined
                                        : { width: `${Math.round(uploadProgress.fraction * 100)}%` }}
                                />
                            </div>
                        </div>
                    )}
                    <button
                        type="submit"
                        disabled={isUploading}
                        className={`w-full py-4 font-bold rounded-xl shadow-lg transition-transform transform ${isUploading ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-[1.01] text-white'}`}
                    >
                        {isUploading ? 'Subiendo archivos al servidor...' : (mainContent.tipo === 'memoria_club' ? 'Publicar Memoria en Comunidad' : (uploadMode === 'new' ? 'Publicar Ecosistema Completo' : 'Añadir Materiales al Ecosistema'))}
                    </button>
                </div>

            </form>

            {/* SECTION CREATION MODAL */}
            {isSectionModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in duration-200">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Plus className="text-indigo-600" /> Nueva Sección
                            </h3>
                            <button onClick={() => setIsSectionModalOpen(false)}>
                                <X className="text-gray-400 hover:text-gray-600" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">
                                    Título de la Sección
                                </label>
                                <input
                                    type="text"
                                    value={newSectionData.titulo}
                                    onChange={e =>
                                        setNewSectionData(prev => ({
                                            ...prev,
                                            titulo: e.target.value
                                        }))
                                    }
                                    placeholder="Ej. Aventuras Espaciales"
                                    className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600"
                                    autoFocus
                                />
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium mb-1">
                                        Costo (Puntos)
                                    </label>
                                    <input
                                        type="number"
                                        value={newSectionData.unlockCost}
                                        onChange={e =>
                                            setNewSectionData(prev => ({
                                                ...prev,
                                                unlockCost: parseInt(e.target.value) || 0
                                            }))
                                        }
                                        className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600"
                                    />
                                </div>

                                <div className="flex items-center pt-6">
                                    <label className="flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={newSectionData.isPublic}
                                            onChange={e =>
                                                setNewSectionData(prev => ({
                                                    ...prev,
                                                    isPublic: e.target.checked
                                                }))
                                            }
                                            className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                                        />
                                        <span className="ml-2 text-sm font-medium">
                                            ¿Es Pública?
                                        </span>
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => setIsSectionModalOpen(false)}
                                className="px-4 py-2 text-gray-500 font-medium"
                            >
                                Cancelar
                            </button>

                            <button
                                onClick={handleCreateSection}
                                className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700"
                            >
                                Crear Sección
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SubirContenido;


