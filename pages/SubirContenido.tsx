
import React, { useState, useEffect } from 'react';
import { UploadCloud, FileImage, FileText, Film, Music, BookOpen, Plus, Trash, Link as LinkIcon, Layers, CheckCircle, Eye, Scan, Users, X, ChevronLeft, Edit2, AlertCircle, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { dataService } from '../services/dataService';
import type { Content, AlbumRegion, Section } from '../types';
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
    file: File;
    imageUrl: string;
    regions: AlbumRegion[];
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

        // Initialize materials/pages
        setAlbumPages([]); // Reset album pages for now (complex to reload visual editor from URLs without re-downloading)
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
    const [analyzingIndex, setAnalyzingIndex] = useState<number | null>(null);

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
                regions: []
            }));
            setAlbumPages(prev => [...prev, ...newPages]);
        }
    }

    const detectRegions = async (index: number) => {
        setAnalyzingIndex(index);
        const page = albumPages[index];
        const detectedRegions = await analizarIlustracionAlbum(page.imageUrl);

        setAlbumPages(prev => {
            const updated = [...prev];
            updated[index].regions = detectedRegions;
            return updated;
        });
        setAnalyzingIndex(null);
    }

    // -- Materials Logic --
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

    const handleSuggestTags = async () => {
        if (!mainContent.titulo || !mainContent.descripcion) return alert("Ingresa título y descripción primero.");
        const suggested = await sugerirEtiquetasThema(mainContent.titulo, mainContent.descripcion);
        setMainContent(prev => ({ ...prev, etiquetasString: suggested.join(', ') }));
    };

    // Loading state for uploads
    const [isUploading, setIsUploading] = useState(false);

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
        setIsUploading(true);

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

            // Trazabilidad de huérfanos para futuras limpiezas
            const uploadedUrlsForCleanup: string[] = [];

            // Helper to safely upload if file exists
            const uploadIfFile = async (file: File | null) => {
                if (!file) return undefined;
                const url = await dataService.uploadFile(file, parentId);
                if(url) uploadedUrlsForCleanup.push(url);
                return url;
            };

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

                if (!isUpdate && ((requiresCover && !mainContent.coverFile) || (requiresResource && !mainContent.resourceFile))) {
                    alert(isMedia ? "Por favor, sube el archivo multimedia o ingresa una URL." : "Por favor, sube la portada y el archivo principal. (Si no tienes PDF, al menos provee un Archivo de Texto).");
                    setIsUploading(false);
                    return;
                }

                // Upload Main Files for Content (Only if changed/present)
                const coverUrl = await uploadIfFile(mainContent.coverFile);
                const resourceUrl = await uploadIfFile(mainContent.resourceFile);
                const txtEsUrl = await uploadIfFile(mainContent.textoPlanoFile);
                const txtEnUrl = await uploadIfFile(mainContent.textoInglesFile);
                const txtPtUrl = await uploadIfFile(mainContent.textoPortuguesFile);

                // Illustrations: If new ones added, upload them. Ideally we append or replace. For simplicty, simple upload.
                const illustrationUrls = await Promise.all(mainContent.ilustracionesFiles.map(f => dataService.uploadFile(f, parentId)));

                // Upload Album Pages logic
                let albumDataForApi: any[] | undefined = undefined;
                if (mainContent.tipo === 'libro_album') {
                    // Logic remains similar: upload if file present.
                    albumDataForApi = await Promise.all(albumPages.map(async (p) => {
                        // If p.file is a File object, upload it. If it's a string URL (from existing), keep it.
                        let pageUrl = p.imageUrl;
                        if (p.file instanceof File) {
                            pageUrl = await dataService.uploadFile(p.file, parentId);
                        }

                        return {
                            id: p.id,
                            imageUrl: pageUrl,
                            regions: p.regions
                        };
                    }));
                }

                // Fetch existing content if updating to preserve old URLs if not replaced
                let existingContent: Content | undefined;
                if (isUpdate) {
                    existingContent = existingParents.find(c => c.id === editingId);
                }

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
                    album_data: albumDataForApi || existingContent?.album_data,

                    // Pages count logic
                    numero_paginas: mainContent.tipo === 'libro' ? 10 : (mainContent.tipo === 'libro_album' ? albumPages.length : (existingContent?.numero_paginas || undefined)),
                };

                await dataService.saveContentToApi(newContent);
            }

            // 2. Create Child Materials
            // We iterate sequentially to avoid overloading simpler servers, or parallel is fine.
            for (let index = 0; index < materiales.length; index++) {
                const mat = materiales[index];
                // Check if File OR URL
                if (mat.file || mat.url) {
                    const matFileUrl = mat.file ? await dataService.uploadFile(mat.file, parentId) : (mat.url || '');
                    const matCoverUrl = (uploadMode === 'new' && mainContent.coverFile)
                        ? (await uploadIfFile(mainContent.coverFile) || 'https://picsum.photos/200') // Re-uploading implies duplication? Optimally reuse URL but getting it from above is cleaner in code for now. Actually, let's reuse if possible? No, file object is same, hash might be diff. Let's just use generic placeholder or re-upload.
                        : 'https://picsum.photos/200';

                    const childContent: Content = {
                        id: `child-${parentId}-${index}-${Date.now()}`,
                        parentId: parentId,
                        tipo: mat.tipo === 'actividad' ? 'guia' : mat.tipo as any,
                        titulo: mat.titulo,
                        autor: mat.autor || mainContent.autor || 'Chibalete',
                        editorial: 'Chibalete',
                        descripcion_corta: mat.descripcion || `Material complementario para ${mainContent.titulo}`,
                        portada_url: matCoverUrl.startsWith('http') ? matCoverUrl : matCoverUrl, // Simple check
                        url_recurso: matFileUrl,
                        etiquetas: mat.etiquetas || ['Material', mat.tipo],
                        metricas: { veces_leido: 0, calificacion_promedio: 0 },
                        publico_objetivo: mat.tipo === 'contexto_pedagogico' ? 'administrador' : mat.publico,
                        // --- LEO CONTEXT METADATA ---
                        ...(mat.tipo === 'contexto_pedagogico' ? { useForLeoContext: true } : {})
                    } as Content;

                    // If content has a REAL ID (not temporary timestamp), we Update instead of Create
                    // Simple check: if ID doesn't start with 'child-' or is in our loaded list? 
                    // Actually, if we loaded it, it has a real ID. If we created it new in UI, it has temp ID.
                    // But dataService.saveContentToApi handles upsert if ID exists.
                    // The issue: mat.id in state is EITHER real ID (from edit load) OR temp ID (Date.now).
                    // We must determine if it's a temp ID to generate a NEW proper ID, or use existing.
                    if (mat.id.length < 20 || mat.id.startsWith('child-')) {
                        // Likely temp ID logic from prior code. Let's rely on saveContentToApi's ID logic.
                    }
                    // Wait, earlier logic generated unique ID always: id: `child-${parentId}-${index}-${Date.now()}`.
                    // We should only use that for NEW items. For existing, use mat.id.

                    if (!mat.id || !String(mat.id).includes('content-')) {
                        // It's a new ui-generated item
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

        } catch (error: any) {
            console.error("Error al subir:", error);
            
            // W1: Best-effort purge of any files that were uploaded before the crash.
            // Routed through dataService to keep auth centralized. Fire-and-forget.
            if (uploadedUrlsForCleanup && uploadedUrlsForCleanup.length > 0) {
                console.warn("⚠️ Intentando purga de archivos huérfanos:", uploadedUrlsForCleanup);
                uploadedUrlsForCleanup.forEach(url => {
                    dataService.purgeOrphanFile(url); // best-effort, never throws
                });
            }

            const errorMessage =
                error?.response?.data?.error ||
                error?.message ||
                String(error);

            // Enhanced Error Feedback
            let userFriendlyMessage = `Hubo un error (${errorMessage}).`;

            if (errorMessage.includes("Invalid file type")) {
                userFriendlyMessage = "Error: Tipo de archivo no permitido. Revisa las extensiones.";
            } 
            else if (
                errorMessage.includes("File too large") ||
                errorMessage.includes("supera el tamaño máximo permitido") ||
                errorMessage.includes("500 MB")
            ) {
                userFriendlyMessage = "Error: El archivo es demasiado pesado (Max 500MB).";
            } 
            else if (errorMessage.includes("Network")) {
                userFriendlyMessage = "Error de Red: No se pudo conectar con el servidor.";
            } 
            else if (errorMessage.includes("Unauthorized")) {
                userFriendlyMessage = "Error de Permisos: No estás autorizado (Clave incorrecta). Verifique la configuración del servidor.";
            }

            // L2: User sees only the friendly message; technical detail goes to console only
            console.error('[Upload Error - technical]', errorMessage);
            alert(userFriendlyMessage);

            setIsUploading(false);
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

            <form onSubmit={handleSubmit} className="space-y-8">

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
                                        className="px-4 py-2 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 rounded-lg font-bold flex items-center hover:bg-indigo-200 transition-colors"
                                    >
                                        <Sparkles size={16} className="mr-2" /> Sugerir (IA)
                                    </button>
                                </div>
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
                            <div className="pt-6 border-b border-gray-200 dark:border-gray-700 pb-6">
                                <h3 className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mb-4 flex items-center">
                                    <Eye className="mr-2" /> Editor Visual de Álbum
                                </h3>
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
                                        {albumPages.map((page, idx) => (
                                            <div key={page.id} className="bg-gray-50 dark:bg-gray-900/50 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
                                                <div className="flex justify-between items-center mb-4">
                                                    <h4 className="font-bold text-lg text-indigo-700 dark:text-indigo-400">Lámina {idx + 1}</h4>
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
                                                    </div>
                                                </div>

                                                <div className="grid md:grid-cols-2 gap-6">
                                                    {/* VISUAL EDITOR */}
                                                    <div
                                                        className="relative w-full h-auto min-h-[400px] bg-gray-200 dark:bg-black/20 rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 select-none group"
                                                        onMouseMove={(e) => {
                                                            if (activeDrag && activeDrag.pageIdx === idx) {
                                                                const rect = e.currentTarget.getBoundingClientRect();
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
                                                        <img src={page.imageUrl} className="w-full h-auto object-contain pointer-events-none mx-auto" alt={`Lámina ${idx}`} />

                                                        {/* Region Overlays */}
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
                                                                    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
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

                                                                        <div className="flex-1">
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
                                                                                placeholder="Escribe el texto que se leerá al tocar esta zona..."
                                                                                onFocus={() => setHighlightedRegionId(region.id)}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {(mainContent.tipo === 'libro' || mainContent.tipo === 'articulo_pedagogico') && (
                            <div className="pt-6">
                                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">Archivos Opcionales para Experiencia Enriquecida</h3>

                                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg mb-4 border border-yellow-200 dark:border-yellow-700">
                                    <p className="text-sm text-yellow-800 dark:text-yellow-200 flex items-start">
                                        <span className="mr-2 text-lg">⚠️</span>
                                        <b>Importante para Accesibilidad:</b> Para que funcionen el "Modo Lectura Accesible" (Dislexia/TTS) y el "Modo Inmersivo", es <u>obligatorio</u> subir el archivo de texto plano (.txt) correspondiente.
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


