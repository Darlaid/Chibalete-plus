import React, { useState, useEffect } from 'react';
import { Users, School, Upload, FileText, Check, Plus, Edit2, Trash2, UserPlus, GraduationCap, UserCog, X, Download, Shield, BookOpen, EyeOff, MinusCircle, PenTool, UploadCloud, AlertCircle, CheckCircle, Save, Zap, Clock } from 'lucide-react';
import { dataService } from '../services/dataService';
import { isMediator, isAdmin } from '../utils/permissions';
import type { User, Group, SchoolConfig, Content } from '../types';

/**
 * CHP-ID-CANON-01A — traduce los códigos de error del backend a algo accionable
 * para el administrador. Nunca se muestra el payload ni datos del usuario.
 */
const describeUserSaveError = (err: any): string => {
    switch (err?.code) {
        case 'AMBIGUOUS_GROUP':
            return 'Este colegio tiene varios grupos. Selecciona explícitamente el curso o club del estudiante.';
        case 'GROUP_REQUIRED':
            return 'Falta el grupo: todo estudiante debe pertenecer a un curso o club para aparecer en Aula Viva.';
        case 'GROUP_NOT_FOUND':
            return 'El grupo seleccionado ya no existe. Recarga la página y vuelve a elegirlo.';
        case 'GROUP_SCHOOL_MISMATCH':
            return 'El grupo seleccionado pertenece a otra institución.';
        case 'DUPLICATE_USER':
            return 'Ya existe un usuario con ese email.';
        default:
            return err?.message || 'No se pudo guardar el usuario. Intenta de nuevo.';
    }
};

const AdminUsuarios: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'gestion' | 'carga'>('gestion');

    // --- STATE FOR CSV UPLOAD ---
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [previewErrors, setPreviewErrors] = useState<{row: number, email: string, reason: string}[]>([]);
    const [previewStats, setPreviewStats] = useState({ totalRows: 0, validRows: 0, invalidRows: 0, duplicateRows: 0, warningRows: 0 });
    const [uploadError, setUploadError] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState<any | null>(null);

    // --- STATE FOR MANAGEMENT ---
    const [selectedSchool, setSelectedSchool] = useState<string>('');
    const [schools, setSchools] = useState<string[]>([]);
    const [schoolUsers, setSchoolUsers] = useState<User[]>([]);
    const [schoolGroups, setSchoolGroups] = useState<Group[]>([]);
    const [roleFilter, setRoleFilter] = useState<'all' | 'lector' | 'mediador' | 'administrador'>('all');
    const [groupTypeFilter, setGroupTypeFilter] = useState<'all' | 'course' | 'club'>('all');
    // --- MODAL STATES ---
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [editingGroup, setEditingGroup] = useState<Partial<Group> | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [groupSaveMsg, setGroupSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [isUserModalOpen, setIsUserModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<Partial<User> | null>(null);
    // CHP-ID-CANON-01A — el guardado de usuario ya no usa alert() con el error
    // técnico crudo del backend; se muestra inline y traducido.
    const [userSaveMsg, setUserSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isSavingUser, setIsSavingUser] = useState(false);

    const [isSchoolModalOpen, setIsSchoolModalOpen] = useState(false);
    const [schoolNameInput, setSchoolNameInput] = useState('');
    const [isRenamingSchool, setIsRenamingSchool] = useState(false);
    // --- QUICK CLUB STATE ---
    const [isQuickClubModalOpen, setIsQuickClubModalOpen] = useState(false);
    const [quickClubForm, setQuickClubForm] = useState({
        name: '',
        mediatorId: '',
        contentType: 'all' as 'all' | 'collection' | 'book',
        selectedContentId: '',
        durationMonths: '1'
    });

    // Initial Load
    useEffect(() => {
        refreshData();
    }, []);

    const refreshData = () => {
        const uniqueSchools = dataService.getColegios();
        setSchools(uniqueSchools);
        // Reselect school if it still exists, otherwise defaulting to empty
        if (selectedSchool && !uniqueSchools.includes(selectedSchool)) {
            setSelectedSchool('');
        } else if (!selectedSchool && uniqueSchools.length > 0) {
            setSelectedSchool(uniqueSchools[0]);
        }
    };

    // Load School Data when selection changes
    useEffect(() => {
        if (selectedSchool) {
            setSchoolUsers(dataService.getUsuariosByColegio(selectedSchool));
            setSchoolGroups(dataService.getGroupsByColegio(selectedSchool));
        } else {
            setSchoolUsers([]);
            setSchoolGroups([]);
        }
    }, [selectedSchool]);

    // Derived State
    const filteredUsers = schoolUsers.filter(u => roleFilter === 'all' || u.roles.includes(roleFilter));
    // managers: usuarios con rol mediador o administrador. Usados para asignar mediadores a grupos.
    const managers = schoolUsers.filter(u => isMediator(u) || isAdmin(u));
    const filteredGroups = schoolGroups.filter(g => groupTypeFilter === 'all' || (g.type || 'course') === groupTypeFilter);

    // CHP-ID-CANON-01A — contrato de grupos en el formulario de usuario.
    // Un estudiante (lector) debe llegar al backend con un groupId explícito:
    // sin eso el backend tendría que inferir el grupo desde el nombre de la
    // institución, que es justo lo que produce AMBIGUOUS_GROUP cuando el
    // colegio tiene más de un grupo. Mediadores y administradores conservan el
    // contrato actual: el grupo es opcional.
    const editingUserIsLector = (editingUser?.roles || []).includes('lector');
    const userNeedsGroup = editingUserIsLector;

    // CHP-ID-CANON-01B — sólo los grupos de la institución seleccionada son
    // elegibles. `authorizedGroupIds` es el conjunto autorizado y `selectedGroupIds`
    // la selección ya saneada: una selección heredada de otro colegio no cuenta
    // como válida ni puede llegar al backend.
    const authorizedGroupIds = React.useMemo(
        () => new Set(schoolGroups.map(g => g.id)),
        [schoolGroups],
    );
    const selectedGroupIds = (editingUser?.groupIds || []).filter(id => authorizedGroupIds.has(id));
    const userHasGroup = selectedGroupIds.length > 0;

    // Al cambiar de institución (o cambiar sus grupos), purgar del formulario
    // cualquier groupId que ya no pertenezca al colegio en contexto.
    useEffect(() => {
        if (!isUserModalOpen || !editingUser) return;
        const current = editingUser.groupIds || [];
        const pruned  = current.filter(id => authorizedGroupIds.has(id));
        if (pruned.length !== current.length) {
            setEditingUser(prev => (prev ? { ...prev, groupIds: pruned } : prev));
        }
    }, [authorizedGroupIds, isUserModalOpen]);

    // --- HANDLERS FOR CSV ---
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setUploadError('');
        setUploadResult(null);
        setPreviewErrors([]);
        setPreviewStats({ totalRows: 0, validRows: 0, invalidRows: 0, duplicateRows: 0, warningRows: 0 });
        const file = e.target.files?.[0];
        if (file) {
            if (file.type !== 'text/csv' && !file.name.endsWith('.csv') && file.type !== 'application/vnd.ms-excel') {
                setUploadError('Por favor, sube un archivo CSV válido.');
                return;
            }
            setCsvFile(file);
            parseCSV(file);
        }
    };

    // Formato esperado: Nombre,Email,Password,Colegio,Curso,Rol
    const parseCSV = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            // Normalizar saltos de línea Windows (\r\n) y Mac (\r)
            const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            const parsed: any[] = [];
            const rowErrors: {row: number, email: string, reason: string}[] = [];
            const emailsSeen = new Set<string>();
            let invalidRows = 0;
            let warningRows = 0;
            let duplicateRows = 0;
            let totalRows = lines.length - 1; // Header ignorado

            if (totalRows <= 0) {
                setUploadError('El archivo parece estar vacío.');
                return;
            }

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) { totalRows--; continue; } // Saltar líneas en blanco

                // Soporte básico para campos con comas entre comillas
                const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
                const rowNum = i + 1; // Número de fila real para el usuario

                if (parts.length < 6) {
                    rowErrors.push({ row: rowNum, email: '', reason: 'Faltan columnas obligatorias o desfasadas' });
                    invalidRows++;
                    continue;
                }

                const nombre = parts[0] || '';
                const email = (parts[1] || '').toLowerCase();
                const password = parts[2] || '';
                const colegio = parts[3] || '';
                const curso = parts[4] || '';
                const rolRaw = (parts[5] || 'lector').toLowerCase().trim();
                // SUBFASE 3.2: Columna 6 opcional — mediatorKind
                const VALID_MK_VALUES = ['teacher', 'librarian', 'coordinator', 'parent'];
                const mkRaw = parts[6] ? parts[6].toLowerCase().trim() : undefined;
                const mediatorKind = mkRaw && VALID_MK_VALUES.includes(mkRaw)
                    ? mkRaw as 'teacher' | 'librarian' | 'coordinator' | 'parent'
                    : undefined;

                // Validaciones rigurosas
                const rowErrs: string[] = [];
                if (!nombre || nombre.length < 2) rowErrs.push('Nombre vacío o muy corto');
                if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrs.push('Email inválido');
                if (!password || password.length < 6) rowErrs.push('Password < 6 caracteres');
                if (!colegio) rowErrs.push('Colegio vacío');
                if (!curso) rowErrs.push('Curso vacío');
                
                if (emailsSeen.has(email) && email !== '') {
                    rowErrs.push('Email duplicado dentro del archivo');
                    duplicateRows++;
                    invalidRows++; 
                }

                if (rowErrs.length > 0) {
                    rowErrors.push({ row: rowNum, email: email || 'N/A', reason: rowErrs.join('; ') });
                    if (!emailsSeen.has(email)) invalidRows++; // si no se sumó en duplicate 
                    continue; // Omitir fila
                }

                emailsSeen.add(email);

                // Mapear rol — DT-05: 'profesor' eliminado del modelo; se normaliza → 'mediador'.
                let roles: ('lector' | 'mediador')[];
                if (rolRaw === 'mediador' || rolRaw === 'profesor') {
                    roles = ['mediador'];
                } else {
                    if (rolRaw !== 'lector') {
                        rowErrors.push({ row: rowNum, email, reason: `Rol "${rolRaw}" desconocido. Se forzó 'lector'` });
                        warningRows++;
                    }
                    roles = ['lector'];
                }

                parsed.push({ nombre_completo: nombre, email, password, colegio, curso, roles, mediatorKind, _rowNum: rowNum });
            }

            if (parsed.length === 0 && rowErrors.length === 0) {
                setUploadError('Archivo sin datos válidos.');
            } else {
                setPreviewData(parsed);
                setPreviewErrors(rowErrors);
                setPreviewStats({
                    totalRows,
                    validRows: parsed.length,
                    invalidRows,
                    duplicateRows,
                    warningRows
                });
            }
        };
        reader.readAsText(file, 'UTF-8');
    };

    const handleUpload = async () => {
        if (previewData.length === 0 || isUploading) return;
        setIsUploading(true);
        setUploadResult(null);
        try {
            const apiResult = await dataService.crearUsuariosMasivos(previewData);
            
            // Consolidar resultados locales y remotos
            const finalResult = {
                totalRows: previewStats.totalRows,
                validRows: previewStats.validRows,
                created: apiResult.created,
                duplicates: previewStats.duplicateRows + apiResult.duplicates,
                invalid: previewStats.invalidRows,
                warnings: previewStats.warningRows,
                errors: [...previewErrors, ...apiResult.errors].sort((a,b) => a.row - b.row)
            };
            
            setUploadResult(finalResult);
            // Mantenemos 'csvFile' en UI, pero podemos vaciar data para liberar memoria profunda u omitir
            if (finalResult.created > 0) refreshData();
        } catch (e: any) {
            setUploadError(`Error inesperado: ${e.message}`);
        } finally {
            setIsUploading(false);
        }
    };

    const downloadErrorReport = () => {
        if (!uploadResult || uploadResult.errors.length === 0) return;
        const csvContent = "Fila,Email,Motivo\n" + uploadResult.errors.map((e: any) => `${e.row},${e.email},"${e.reason.replace(/"/g, '""')}"`).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `reporte_errores_${new Date().getTime()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // --- HANDLERS FOR SCHOOLS ---
    const handleCreateSchool = () => {
        setIsRenamingSchool(false);
        setSchoolNameInput('');
        setIsSchoolModalOpen(true);
    };

    const handleEditSchool = () => {
        if (!selectedSchool) return;
        setIsRenamingSchool(true);
        setSchoolNameInput(selectedSchool);
        setIsSchoolModalOpen(true);
    };

    const handleSaveSchool = async () => {
        if (!schoolNameInput.trim()) return;

        if (isRenamingSchool && selectedSchool) {
            dataService.renameSchool(selectedSchool, schoolNameInput);
            refreshData();
            setSelectedSchool(schoolNameInput);
            setIsSchoolModalOpen(false);
        } else {
            try {
                await dataService.createSchool(schoolNameInput.trim());
                // Forzar recarga de la lista unificada
                const updatedSchools = dataService.getColegios();
                setSchools(updatedSchools);
                setSelectedSchool(schoolNameInput.trim());
                setIsSchoolModalOpen(false);
            } catch (error: any) {
                alert(`Error: ${error.message}`);
            }
        }
    };

    // --- HANDLERS FOR USERS ---
    const handleCreateUser = () => {
        setEditingUser({ nombre_completo: '', email: '', password: 'chibalete123', roles: ['lector'], colegio: selectedSchool, groupIds: [] });
        setUserSaveMsg(null);
        setIsUserModalOpen(true);
    };

    // Sprint 022 Fase 2A.2 — Caso CRÍTICO 2 cerrado.
    //
    // Antes: el form se abría con el snapshot de `user` que el caller
    // tenía en su lista renderizada. Si otro admin (otra pestaña, otra
    // sesión) había modificado los memberships de ese user en el
    // intervalo, los checkboxes de groupIds reflejaban un estado vencido
    // y guardar pisaba silenciosamente los cambios concurrentes vía el
    // diff de PUT /api/users/:id.
    //
    // Ahora: refrescamos this.users una sola vez antes de abrir el form,
    // y tomamos la versión más fresca disponible en cache. Si el refetch
    // falla (red caída), abrimos con el cache actual y dejamos warn —
    // el form sigue funcionando, solo sin garantía cross-actor.
    const handleEditUser = async (user: User) => {
        try {
            await dataService.reloadUsers();
        } catch (e) {
            console.warn('[ADMIN_USUARIOS_RELOAD] failed; abriendo form con cache actual', (e as Error).message);
        }
        const fresh = dataService.getUsuarioById(user.id) ?? user;
        setEditingUser({ ...fresh });
        setUserSaveMsg(null);
        setIsUserModalOpen(true);
    };

    const handleDeleteUser = (id: string, name: string) => {
        if (confirm(`¿Eliminar usuario ${name}?`)) {
            dataService.deleteUser(id);
            if (selectedSchool) setSchoolUsers(dataService.getUsuariosByColegio(selectedSchool));
        }
    };

    const handleSaveUser = async () => {
        if (!editingUser || !editingUser.nombre_completo || !editingUser.email) {
            setUserSaveMsg({ type: 'error', text: 'Nombre completo y email son obligatorios.' });
            return;
        }

        // CHP-ID-CANON-01A — el grupo se elige explícitamente; el formulario no
        // puede enviar una creación de estudiante que el backend tendría que
        // resolver adivinando desde el texto de curso/colegio.
        if (userNeedsGroup && !userHasGroup) {
            setUserSaveMsg({
                type: 'error',
                text: schoolGroups.length === 0
                    ? 'Este colegio todavía no tiene grupos. Crea el curso o club antes de registrar estudiantes.'
                    : 'Selecciona el curso o club al que pertenece el estudiante.',
            });
            return;
        }

        // Force school context + defensa en profundidad: nunca se envía un
        // groupId ajeno a la institución seleccionada, ni siquiera si quedó en
        // el estado por una edición previa (CHP-ID-CANON-01B).
        const userData = { ...editingUser, colegio: selectedSchool, groupIds: selectedGroupIds };

        setIsSavingUser(true);
        setUserSaveMsg(null);
        try {
            if (editingUser.id) {
                await dataService.updateUser(editingUser.id, userData);
            } else {
                await dataService.createUser(userData);
            }
            setIsUserModalOpen(false);
            if (selectedSchool) setSchoolUsers(dataService.getUsuariosByColegio(selectedSchool));
            refreshData(); // In case a new school was involved
        } catch (err: any) {
            setUserSaveMsg({ type: 'error', text: describeUserSaveError(err) });
        } finally {
            setIsSavingUser(false);
        }
    };

    // --- HANDLERS FOR GROUPS ---
    const handleCreateGroup = () => {
        setEditingGroup({ name: '', grade: '', school: selectedSchool, type: 'course', mediatorIds: [] });
        setIsGroupModalOpen(true);
    };

    const handleEditGroup = (group: Group) => {
        setEditingGroup({ 
            ...group, 
            type: group.type || 'course',
            mediatorIds: dataService.getGroupMediatorIds(group) 
        });
        setIsGroupModalOpen(true);
    };

    const handleSaveGroup = async () => {
        if (!editingGroup || !editingGroup.name || !selectedSchool) return;

        // --- Guardia de seguridad: bloqueo total (Fase 6C) ---
        const isBlockingAll = Array.isArray(editingGroup.availableContentIds) && editingGroup.availableContentIds.length === 0;
        if (isBlockingAll) {
            const confirmed = window.confirm(
                `⚠️ Bloqueo Total de Catálogo\n\nEstás a punto de bloquear completamente el acceso al catálogo para el grupo "${editingGroup.name}".\n\nLos miembros no podrán ver ningún contenido hasta que se modifique esta regla.\n\n¿Deseas continuar?`
            );
            if (!confirmed) return;
        }

        setIsSaving(true);
        setGroupSaveMsg(null);

        try {
            if (editingGroup.id) {
                // Update — teacherId derivado por dataService.updateGroup desde mediatorIds
                dataService.updateGroup(editingGroup.id, { ...editingGroup });
            } else {
                // Create — teacherId derivado por backend normalizeGroup desde mediatorIds
                dataService.createGroup({
                    name: editingGroup.name!,
                    grade: editingGroup.grade || 'General',
                    school: selectedSchool,
                    type: editingGroup.type || 'course',
                    mediatorIds: editingGroup.mediatorIds || [],
                    availableContentIds: editingGroup.availableContentIds,
                    collectionIds: editingGroup.collectionIds,
                    accessStartsAt: editingGroup.accessStartsAt,
                    accessEndsAt: editingGroup.accessEndsAt
                });
            }

            setSchoolGroups(dataService.getGroupsByColegio(selectedSchool)); // Refresh
            refreshData();

            setGroupSaveMsg({ type: 'success', text: '\u2713 Grupo guardado correctamente.' });
            // Cerramos el modal tras breve pausa para que el admin vea la confirmación
            setTimeout(() => {
                setIsGroupModalOpen(false);
                setGroupSaveMsg(null);
            }, 1200);
        } catch (err: any) {
            // Mantenemos el modal abierto para que el admin pueda intentar de nuevo
            setGroupSaveMsg({ type: 'error', text: `Error al guardar: ${err?.message || 'Intenta de nuevo.'}` });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteGroup = (id: string) => {
        if (confirm('¿Estás seguro de eliminar este grupo?')) {
            dataService.deleteGroup(id);
            setSchoolGroups(dataService.getGroupsByColegio(selectedSchool));
        }
    };

    const handleSaveQuickClub = async () => {
        if (!quickClubForm.name || !quickClubForm.mediatorId || !selectedSchool) return;

        setIsSaving(true);
        try {
            // Calcular fecha de expiración
            const months = parseInt(quickClubForm.durationMonths);
            const endsAtRequest = new Date();
            endsAtRequest.setMonth(endsAtRequest.getMonth() + months);

            const payload: any = {
                name: quickClubForm.name,
                school: selectedSchool,
                type: 'club',
                mediatorIds: [quickClubForm.mediatorId],
                accessEndsAt: endsAtRequest.toISOString(),
                grade: 'Club'
            };

            if (quickClubForm.contentType === 'book') {
                payload.availableContentIds = [quickClubForm.selectedContentId];
            } else if (quickClubForm.contentType === 'collection') {
                payload.availableContentIds = []; // Bloqueo de catálogo general a favor de colecciones
                payload.collectionIds = [quickClubForm.selectedContentId];
            } else {
                payload.availableContentIds = 'all'; // Acceso total
            }

            await dataService.createGroup(payload);
            
            setSchoolGroups(dataService.getGroupsByColegio(selectedSchool));
            setIsQuickClubModalOpen(false);
            alert('\u26a1 Club creado y listo para vender.');
        } catch (err: any) {
            alert(`Error al crear club: ${err.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    // --- SCHOOL CATALOG/FILTERING LOGIC ---
    const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
    const [schoolConfig, setSchoolConfig] = useState<SchoolConfig>({ schoolName: '', hiddenContentIds: [] });
    const [allBookContent, setAllBookContent] = useState<Content[]>([]);

    useEffect(() => {
        const loadContent = async () => {
            const content = await dataService.getContenidos(['administrador']);
            setAllBookContent(content);
        };
        loadContent();
    }, []);

    const openCatalogModal = async () => {
        if (!selectedSchool) return;
        const config = await dataService.getSchoolConfig(selectedSchool);
        setSchoolConfig(config);
        setIsCatalogModalOpen(true);
    };

    const handleToggleHidden = async (contentId: string) => {
        const currentHidden = schoolConfig.hiddenContentIds || [];
        const wasHidden = currentHidden.includes(contentId);
        const newHidden = wasHidden
            ? currentHidden.filter(id => id !== contentId)
            : [...currentHidden, contentId];

        const newConfig = { ...schoolConfig, hiddenContentIds: newHidden };

        // Actualización optimista: aplicar en UI inmediatamente
        setSchoolConfig(newConfig);

        try {
            // Fase E5: try/catch con rollback — si saveSchoolConfig falla,
            // revertir el estado local para mantener UI coherente con el servidor.
            await dataService.saveSchoolConfig(newConfig);
        } catch (err: any) {
            console.error('[AdminUsuarios] Error al guardar visibilidad de contenido:', err);
            // Rollback: restaurar la config previa en la UI
            setSchoolConfig(schoolConfig);
            alert(`Error al cambiar visibilidad: ${err?.message || 'Intenta de nuevo.'}`);
        }
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
            <h1 className="text-3xl font-bold mb-6 flex items-center text-gray-800 dark:text-white">
                <Users className="mr-3 text-indigo-600" /> Administración de Usuarios y Colegios
            </h1>

            {/* TABS */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-8">
                <button
                    onClick={() => setActiveTab('gestion')}
                    className={`pb-4 px-6 font-medium text-lg transition-colors border-b-2 ${activeTab === 'gestion'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
                        }`}
                >
                    Gestión de Colegios
                </button>
                <button
                    onClick={() => setActiveTab('carga')}
                    className={`pb-4 px-6 font-medium text-lg transition-colors border-b-2 ${activeTab === 'carga'
                        ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
                        }`}
                >
                    Carga Masiva (CSV)
                </button>
            </div>

            {activeTab === 'gestion' ? (
                <div className="space-y-8">
                    {/* SCHOOL HEADER & ACTIONS */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row items-center gap-4 justify-between">
                        <div className="flex items-center gap-4 w-full md:w-auto">
                            <School className="text-gray-400 hidden md:block" size={32} />
                            <div className="flex-grow">
                                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    Colegio / Institución
                                </label>
                                <select
                                    value={selectedSchool}
                                    onChange={(e) => setSelectedSchool(e.target.value)}
                                    className="w-full min-w-[250px] text-lg font-bold p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700"
                                >
                                    <option value="">-- Seleccionar Colegio --</option>
                                    {schools.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="flex gap-2 w-full md:w-auto mt-4 md:mt-0">
                            {selectedSchool && (
                                <>
                                    <button onClick={openCatalogModal} className="flex-1 md:flex-none flex items-center justify-center px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-200 transition-colors font-bold border border-amber-200 dark:border-amber-800">
                                        <BookOpen size={18} className="mr-2" /> Catálogo
                                    </button>
                                    <button onClick={handleEditSchool} className="flex-1 md:flex-none flex items-center justify-center px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 transition-colors font-medium">
                                        <PenTool size={18} className="mr-2" /> Editar Nombre
                                    </button>
                                </>
                            )}
                            <button onClick={handleCreateSchool} className="flex-1 md:flex-none flex items-center justify-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-bold shadow-md">
                                <Plus size={18} className="mr-2" /> Nuevo Colegio
                            </button>
                        </div>
                    </div>

                    {selectedSchool ? (
                        <div className="grid lg:grid-cols-3 gap-8">
                            {/* LEFT COLUMN: USERS */}
                            <div className="lg:col-span-2 space-y-6">
                                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                                    <div className="flex justify-between items-center mb-6">
                                        <h2 className="text-xl font-bold flex items-center">
                                            <GraduationCap className="mr-2 text-indigo-500" /> Usuarios
                                            <span className="ml-2 bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full">
                                                {filteredUsers.length}
                                            </span>
                                        </h2>

                                        <div className="flex gap-2">
                                            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                                                {(['all', 'lector', 'mediador'] as const).map(role => (
                                                    <button
                                                        key={role}
                                                        onClick={() => setRoleFilter(role)}
                                                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${roleFilter === role
                                                            ? 'bg-white dark:bg-gray-600 shadow-sm text-indigo-600 dark:text-indigo-300'
                                                            : 'text-gray-500 hover:text-gray-700'
                                                            }`}
                                                    >
                                                        {role === 'all' ? 'Todos' : role === 'lector' ? 'Alumnos' : 'Docentes'}
                                                    </button>
                                                ))}
                                            </div>
                                            <button onClick={handleCreateUser} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700" title="Agregar Usuario">
                                                <UserPlus size={20} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="overflow-y-auto max-h-[500px]">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                                                <tr>
                                                    <th className="p-3 rounded-tl-lg">Usuario</th>
                                                    <th className="p-3">Email</th>
                                                    <th className="p-3">Rol</th>
                                                    <th className="p-3 rounded-tr-lg">Acciones</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                                {filteredUsers.map(user => (
                                                    <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                                                        <td className="p-3 font-medium">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600">
                                                                    {user.nombre_completo.charAt(0)}
                                                                </div>
                                                                <div>
                                                                    <div className='font-bold'>{user.nombre_completo}</div>
                                                                    <div className='text-xs text-gray-400'>{user.nombre_usuario}</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-3 text-gray-500">{user.email}</td>
                                                        <td className="p-3">
                                                            {user.roles.map(r => (
                                                                <span key={r} className={`mr-1 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${r === 'administrador' ? 'bg-red-100 text-red-700' :
                                                                    r === 'mediador' ? 'bg-purple-100 text-purple-700' :
                                                                        'bg-green-100 text-green-700'
                                                                    }`}>
                                                                    {r}
                                                                </span>
                                                            ))}
                                                        </td>
                                                        <td className="p-3">
                                                            <div className="flex gap-2">
                                                                <button onClick={() => handleEditUser(user)} className="text-blue-500 hover:text-blue-700"><Edit2 size={16} /></button>
                                                                <button onClick={() => handleDeleteUser(user.id, user.nombre_completo)} className="text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {filteredUsers.length === 0 && (
                                                    <tr>
                                                        <td colSpan={4} className="p-8 text-center text-gray-400">
                                                            No hay usuarios registrados en este colegio. ¡Agrega uno!
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* RIGHT COLUMN: GROUPS */}
                            <div className="space-y-6">
                                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                                    <div className="flex justify-between items-center mb-6">
                                        <h2 className="text-xl font-bold flex items-center">
                                            <UserCog className="mr-2 text-indigo-500" /> Cursos / Grupos
                                        </h2>
                                        
                                        <div className="flex gap-2">
                                            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 hidden sm:flex">
                                                {(['all', 'course', 'club'] as const).map(type => (
                                                    <button
                                                        key={type}
                                                        onClick={() => setGroupTypeFilter(type)}
                                                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${groupTypeFilter === type
                                                            ? 'bg-white dark:bg-gray-600 shadow-sm text-indigo-600 dark:text-indigo-300'
                                                            : 'text-gray-500 hover:text-gray-700'
                                                            }`}
                                                    >
                                                        {type === 'all' ? 'Todos' : type === 'course' ? 'Cursos' : 'Clubes'}
                                                    </button>
                                                ))}
                                            </div>
                                            <button
                                                onClick={handleCreateGroup}
                                                className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                                                title="Crear Grupo"
                                            >
                                                <Plus size={20} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setQuickClubForm({
                                                        name: '',
                                                        mediatorId: managers.length > 0 ? managers[0].id : '',
                                                        contentType: 'all',
                                                        selectedContentId: '',
                                                        durationMonths: '1'
                                                    });
                                                    setIsQuickClubModalOpen(true);
                                                }}
                                                className="p-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1 font-bold text-xs"
                                                title="Creación Rápida de Club"
                                            >
                                                <Zap size={16} /> <span className="hidden sm:inline">CLUB RÁPIDO</span>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                                        {filteredGroups.map(group => {
                                            const mediatorIds = dataService.getGroupMediatorIds(group);
                                            const mediatorNames = mediatorIds.length > 0 
                                                ? mediatorIds.map(mId => managers.find(t => t.id === mId)?.nombre_completo).filter(Boolean).join(', ')
                                                : 'Sin asignar';
                                            const isClub = group.type === 'club';

                                            // --- Fase 6D: Estado de Vigencia Temporal ---
                                            const now = Date.now();
                                            const hasTemporalRules = !!(group.accessStartsAt || group.accessEndsAt);
                                            const startsAt = group.accessStartsAt ? new Date(group.accessStartsAt).getTime() : null;
                                            const endsAt = group.accessEndsAt ? new Date(group.accessEndsAt).getTime() : null;
                                            const isExpired = endsAt !== null && now > endsAt;
                                            const isUpcoming = startsAt !== null && now < startsAt;
                                            const isActiveWindow = hasTemporalRules && !isExpired && !isUpcoming;

                                            let temporalBadge: React.ReactNode = null;
                                            if (hasTemporalRules) {
                                                if (isExpired) {
                                                    temporalBadge = (
                                                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-700 flex items-center gap-1">
                                                            ⏱ Expirado
                                                        </span>
                                                    );
                                                } else if (isUpcoming) {
                                                    temporalBadge = (
                                                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 flex items-center gap-1">
                                                            🕐 Próximo
                                                        </span>
                                                    );
                                                } else if (isActiveWindow) {
                                                    temporalBadge = (
                                                        <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 flex items-center gap-1">
                                                            ✅ Vigente
                                                        </span>
                                                    );
                                                }
                                            }

                                            // --- Fase Comercial: Estado de Catálogo ---
                                            const isFullAccess = group.availableContentIds === 'all' || group.availableContentIds === undefined;
                                            const isRestricted = Array.isArray(group.availableContentIds) && group.availableContentIds.length > 0;
                                            const isZeroAccess = Array.isArray(group.availableContentIds) && group.availableContentIds.length === 0;
                                            const collectionsCount = Array.isArray(group.collectionIds) ? group.collectionIds.length : 0;
                                            
                                            let catalogBadge: React.ReactNode = null;
                                            if (isFullAccess && collectionsCount === 0) {
                                                catalogBadge = (
                                                    <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded font-medium flex items-center gap-1" title="Hereda Abierto">
                                                       📚 Catálogo Total
                                                    </span>
                                                );
                                            } else if (isRestricted || collectionsCount > 0) {
                                                const titlesCount = Array.isArray(group.availableContentIds) ? group.availableContentIds.length : 0;
                                                catalogBadge = (
                                                    <span className="text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 px-2 py-0.5 rounded font-bold flex items-center gap-1" title="Acceso Parcial">
                                                       🔒 {titlesCount} Títulos / {collectionsCount} Cols.
                                                    </span>
                                                );
                                            } else if (isZeroAccess && collectionsCount === 0) {
                                                catalogBadge = (
                                                    <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border border-red-200 dark:border-red-700 px-2 py-0.5 rounded font-bold flex items-center gap-1" title="Restringido Absoluto">
                                                       🚫 Sin Contenido
                                                    </span>
                                                );
                                            }

                                            return (
                                                <div key={group.id} className={`p-4 border rounded-lg hover:shadow-md transition-shadow ${
                                                    isExpired ? 'border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-900/5' :
                                                    isActiveWindow ? 'border-green-200 dark:border-green-900/50' :
                                                    'border-gray-200 dark:border-gray-700'
                                                }`}>
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div>
                                                            <h3 className="font-bold text-lg flex items-center">
                                                                {isClub ? <span className="mr-2 text-purple-600" title="Club de Lectura">🎪</span> : <span className="mr-2 text-indigo-600" title="Curso Escolar">🏫</span>}
                                                                {group.name}
                                                            </h3>
                                                            <div className="flex flex-wrap gap-2 mt-1">
                                                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${isClub ? 'bg-purple-100 text-purple-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                                                    {isClub ? 'Club' : 'Curso'}
                                                                </span>
                                                                {group.grade && (
                                                                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                                                        Nivel: {group.grade}
                                                                    </span>
                                                                )}
                                                                {catalogBadge}
                                                                {temporalBadge}
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-1">
                                                            <button onClick={() => handleEditGroup(group)} className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                                                                <Edit2 size={16} />
                                                            </button>
                                                            <button onClick={() => handleDeleteGroup(group.id)} className="p-1 text-red-600 hover:bg-red-50 rounded">
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="text-sm text-gray-500 mb-2 mt-3 bg-gray-50 dark:bg-gray-800/50 p-2 rounded">
                                                        <strong className="text-gray-700 dark:text-gray-300">Mediadores:</strong> {mediatorNames}
                                                    </div>
                                                    <div className="text-xs text-gray-400 flex items-center gap-3">
                                                        <span className="flex items-center">
                                                            <Users size={12} className="mr-1" /> {dataService.getGroupMemberIds(group).length} Miembros
                                                        </span>
                                                        {hasTemporalRules && endsAt && (
                                                            <span className={`flex items-center ${isExpired ? 'text-red-400' : 'text-gray-400'}`}>
                                                                🗓 Hasta: {new Date(endsAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {isExpired && (
                                                        <p className="mt-2 text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-1.5 rounded border border-red-100 dark:border-red-800">
                                                            ℹ️ Acceso expirado. El grupo y su historial se conservan intactos.
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {filteredGroups.length === 0 && (
                                            <div className="text-center p-6 text-gray-400 bg-gray-50 rounded-lg border-dashed border-2 border-gray-200">
                                                No hay grupos en este colegio con dichos filtros.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-20 bg-gray-50 dark:bg-gray-800 rounded-xl border-dashed border-2 border-gray-300 dark:border-gray-700">
                            <School className="mx-auto h-16 w-16 text-gray-300 mb-4" />
                            <h3 className="text-xl font-bold text-gray-600 dark:text-gray-300 mb-2">Ningún Colegio Seleccionado</h3>
                            <p className="text-gray-500 mb-6">Selecciona un colegio de la lista o crea uno nuevo para empezar a gestionar usuarios y grupos.</p>
                            <button onClick={handleCreateSchool} className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-lg hover:bg-indigo-700 transition-all transform hover:scale-105">
                                Crear Primer Colegio
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                // EXISTING CSV UPLOAD CONTENT
                <div className="grid md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
                        <div className="flex justify-between items-center mb-2">
                            <h2 className="text-xl font-bold">Carga Masiva (CSV)</h2>
                            <a href="/plantilla_usuarios_chibalete.csv" download className="flex items-center text-sm font-bold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg transition-colors">
                                <Download size={16} className="mr-1" />
                                Descargar plantilla CSV
                            </a>
                        </div>
                        <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
                            Utiliza la plantilla oficial para preparar tus datos. Todos los campos son requeridos obligatoriamente.
                        </p>

                        {!uploadResult ? (
                            <>
                                {/* Drop Zone */}
                                <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors relative mb-6">
                                    <input type="file" accept=".csv,application/vnd.ms-excel" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" disabled={isUploading} />
                                    <UploadCloud className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                                    <p className="font-medium text-indigo-600 dark:text-indigo-400">
                                        {csvFile ? csvFile.name : 'Haz clic o arrastra tu archivo CSV corregido'}
                                    </p>
                                </div>

                                {uploadError && (
                                    <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg flex items-start text-sm">
                                        <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0 mt-0.5" />
                                        {uploadError}
                                    </div>
                                )}

                                {/* Preview Stats Formal */}
                                {csvFile && !uploadError && (
                                    <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg p-5">
                                        <h3 className="font-bold mb-4 text-gray-800 dark:text-gray-200 flex items-center">
                                            <FileText className="w-5 h-5 mr-2 text-indigo-500" /> Resumen de Análisis
                                        </h3>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                                            <div className="bg-white dark:bg-gray-800 p-3 rounded shadow-sm text-center border-t-4 border-blue-400">
                                                <p className="text-xs text-gray-500 uppercase font-bold">TOTAL FILAS</p>
                                                <p className="text-2xl font-bold">{previewStats.totalRows}</p>
                                            </div>
                                            <div className="bg-white dark:bg-gray-800 p-3 rounded shadow-sm text-center border-t-4 border-green-500">
                                                <p className="text-xs text-gray-500 uppercase font-bold">VÁLIDAS LSTAS</p>
                                                <p className="text-2xl font-bold text-green-600">{previewStats.validRows}</p>
                                            </div>
                                            <div className="bg-white dark:bg-gray-800 p-3 rounded shadow-sm text-center border-t-4 border-red-400">
                                                <p className="text-xs text-gray-500 uppercase font-bold">CON ERROR</p>
                                                <p className="text-2xl font-bold text-red-500">{previewStats.invalidRows}</p>
                                            </div>
                                            <div className="bg-white dark:bg-gray-800 p-3 rounded shadow-sm text-center border-t-4 border-amber-400">
                                                <p className="text-xs text-gray-500 uppercase font-bold">ADVERTENCIAS</p>
                                                <p className="text-2xl font-bold text-amber-500">{previewStats.warningRows}</p>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center mt-6">
                                            <button
                                                onClick={() => { setCsvFile(null); setPreviewData([]); setPreviewErrors([]); }}
                                                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                                disabled={isUploading}
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={handleUpload}
                                                disabled={previewData.length === 0 || isUploading}
                                                className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-md"
                                            >
                                                {isUploading ? (
                                                    <>
                                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                        Importando de forma segura...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Upload size={18} />
                                                        Confirmar Carga ({previewData.length})
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            /* RESULTADO FORMAL */
                            <div className="border border-green-200 dark:border-green-800 rounded-xl overflow-hidden shadow-sm">
                                <div className="bg-green-50 dark:bg-green-900/30 p-6 flex flex-col items-center border-b border-green-200 dark:border-green-800">
                                    <div className="w-16 h-16 bg-green-100 dark:bg-green-800 text-green-600 dark:text-green-300 rounded-full flex items-center justify-center mb-4">
                                        <CheckCircle size={32} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-green-800 dark:text-green-200">Importación Finalizada</h3>
                                    <p className="text-green-600 dark:text-green-400 font-medium">{uploadResult.created} usuarios ingresados con éxito</p>
                                </div>
                                <div className="p-6 bg-white dark:bg-gray-800">
                                    <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                                        <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Filas Procesadas:</span> <span className="font-bold">{uploadResult.totalRows}</span></div>
                                        <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Creados:</span> <span className="font-bold text-green-600">{uploadResult.created}</span></div>
                                        <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Duplicados Omitidos:</span> <span className="font-bold">{uploadResult.duplicates}</span></div>
                                        <div className="flex justify-between border-b pb-2"><span className="text-gray-500">Errores Inesperados:</span> <span className="font-bold text-red-500">{uploadResult.errors.length - uploadResult.invalid - uploadResult.warnings}</span></div>
                                    </div>

                                    {uploadResult.errors.length > 0 && (
                                        <div className="mb-6">
                                            <p className="font-bold text-amber-700 dark:text-amber-500 mb-2 text-sm">Se detectaron {uploadResult.errors.length} incidencias en el lote:</p>
                                            <div className="bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 max-h-40 overflow-y-auto p-3 text-xs">
                                                {uploadResult.errors.map((e: any, i: number) => (
                                                    <div key={i} className="mb-1 text-gray-700 dark:text-gray-300">
                                                        <span className="font-mono text-gray-400">Fila {e.row}</span> | <span className="font-bold">{e.email}</span> | {e.reason}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-between gap-4">
                                        <button onClick={() => { setUploadResult(null); setCsvFile(null); }} className="px-5 py-2 grow justify-center text-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 font-medium rounded-lg transition-colors flex items-center">
                                            <Plus size={18} className="mr-2" /> Nueva Importación
                                        </button>
                                        
                                        {uploadResult.errors.length > 0 && (
                                            <button onClick={downloadErrorReport} className="px-5 py-2 grow justify-center text-white bg-amber-500 hover:bg-amber-600 font-bold rounded-lg transition-colors flex items-center shadow-sm">
                                                <Download size={18} className="mr-2" /> Bajar Log Errores
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* --- MODALS --- */}

            {/* SCHOOL MODAL */}
            {isSchoolModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md p-6 shadow-xl animate-in zoom-in duration-200">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold">{isRenamingSchool ? 'Editar Nombre del Colegio' : 'Registrar Nuevo Colegio'}</h3>
                            <button onClick={() => setIsSchoolModalOpen(false)}><X size={24} className="text-gray-400" /></button>
                        </div>
                        <input
                            type="text"
                            value={schoolNameInput}
                            onChange={(e) => setSchoolNameInput(e.target.value)}
                            placeholder="Nombre oficial del Colegio"
                            className="w-full p-3 border border-gray-300 rounded-lg mb-6 dark:bg-gray-700 dark:border-gray-600"
                            autoFocus
                        />
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setIsSchoolModalOpen(false)} className="px-4 py-2 text-gray-600 font-medium">Cancelar</button>
                            <button onClick={handleSaveSchool} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700">Guardar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* USER MODAL */}
            {isUserModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg p-6 shadow-xl animate-in zoom-in duration-200 overflow-y-auto max-h-[90vh]">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold">{editingUser?.id ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
                            <button onClick={() => setIsUserModalOpen(false)}><X size={24} className="text-gray-400" /></button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Nombre Completo</label>
                                <input
                                    type="text"
                                    value={editingUser?.nombre_completo || ''}
                                    onChange={e => setEditingUser(prev => ({ ...prev!, nombre_completo: e.target.value }))}
                                    className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Email</label>
                                <input
                                    type="email"
                                    value={editingUser?.email || ''}
                                    onChange={e => setEditingUser(prev => ({ ...prev!, email: e.target.value }))}
                                    className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600"
                                />
                            </div>

                            {!editingUser?.id && (
                                <div>
                                    <label className="block text-sm font-medium mb-1">Contraseña Inicial</label>
                                    <input
                                        type="text"
                                        value={editingUser?.password || ''}
                                        onChange={e => setEditingUser(prev => ({ ...prev!, password: e.target.value }))}
                                        className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 font-mono text-sm"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Por defecto es 'chibalete123'</p>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium mb-2">Rol del Usuario</label>
                                <div className="flex flex-wrap gap-2">
                                    {(['lector', 'mediador', 'administrador'] as const).map(role => (
                                        <button
                                            key={role}
                                            onClick={() => {
                                                const roles = editingUser?.roles || [];
                                                if (roles.includes(role)) {
                                                    setEditingUser(prev => ({ ...prev!, roles: roles.filter(r => r !== role) }));
                                                } else {
                                                    setEditingUser(prev => ({ ...prev!, roles: [...roles, role] }));
                                                }
                                            }}
                                            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${editingUser?.roles?.includes(role)
                                                ? 'bg-indigo-100 border-indigo-500 text-indigo-700'
                                                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                                                }`}
                                        >
                                            {role === 'lector' ? 'Estudiante' : role === 'mediador' ? 'Mediador' : 'Admin'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {/* CHP-ID-CANON-01A — `curso` es una etiqueta descriptiva del
                                perfil, NO la autoridad de membresía. Quien decide el grupo
                                es el selector de abajo (groupId). */}
                            <div>
                                <label className="block text-sm font-medium mb-1">Curso / Grado (Opcional - Texto)</label>
                                <input
                                    type="text"
                                    value={editingUser?.curso || ''}
                                    onChange={e => setEditingUser(prev => ({ ...prev!, curso: e.target.value }))}
                                    placeholder="Ej. 10B"
                                    className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 mb-1"
                                />
                                <p className="text-xs text-gray-500">
                                    Etiqueta informativa del perfil. La pertenencia real se define en el selector de grupo.
                                </p>
                            </div>

                            {/* GROUP SELECTOR — obligatorio para estudiantes (CHP-ID-CANON-01A),
                                opcional para mediadores/administradores (contrato sin cambios). */}
                            {(userNeedsGroup || isMediator(editingUser) || isAdmin(editingUser)) && (
                                <div className={`p-4 rounded-lg border ${
                                    userNeedsGroup && !userHasGroup
                                        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700'
                                        : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600'
                                }`}>
                                    <label className="block text-sm font-bold mb-2 flex items-center">
                                        <Users size={16} className="mr-2 text-indigo-500" />
                                        {userNeedsGroup ? 'Curso o Club del Estudiante (obligatorio)' : 'Asignar Grupos (Mediador)'}
                                    </label>
                                    <div className="max-h-40 overflow-y-auto space-y-2">
                                        {schoolGroups.length === 0 && (
                                            <p className="text-xs text-gray-500 italic">
                                                {userNeedsGroup
                                                    ? 'Este colegio todavía no tiene grupos. Crea primero el curso o club en la pestaña de grupos.'
                                                    : 'No hay grupos creados en este colegio.'}
                                            </p>
                                        )}
                                        {schoolGroups.map(group => (
                                            <div key={group.id} className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    id={`group-${group.id}`}
                                                    checked={selectedGroupIds.includes(group.id)}
                                                    onChange={(e) => {
                                                        const currentGroups = editingUser?.groupIds || [];
                                                        let newGroups;
                                                        if (e.target.checked) {
                                                            newGroups = [...currentGroups, group.id];
                                                        } else {
                                                            newGroups = currentGroups.filter(id => id !== group.id);
                                                        }
                                                        setEditingUser(prev => ({ ...prev!, groupIds: newGroups }));
                                                    }}
                                                    className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                />
                                                <label htmlFor={`group-${group.id}`} className="ml-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                                                    {group.name} <span className="text-xs text-gray-500">({group.grade})</span>
                                                </label>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        {userNeedsGroup
                                            ? 'Elige el grupo al que pertenece. Sin esta selección no se puede crear el estudiante: el sistema no adivina el grupo a partir del texto de curso.'
                                            : 'Selecciona los grupos que este mediador podrá gestionar.'}
                                    </p>
                                </div>
                            )}

                            {/* --- FASE E6: MOTOR DE ACCESO POR SCOPES (SHADOW MODE) --- */}
                            {editingUser?.id && (
                                <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
                                    <h4 className="font-bold text-gray-800 dark:text-gray-200 mb-2 flex items-center">
                                        <Shield size={16} className="mr-2 text-indigo-500" /> Reglas de Acceso (Scope Engine E6)
                                    </h4>
                                    <p className="text-xs text-gray-500 mb-3">
                                        Módulo de control de alcance granular en desarrollo. El motor ya resuelve accesos en backend mediante el endpoint de `resolveUserContentAccess`, pero el panel comercial de reglas estará disponible en la próxima fase.
                                    </p>
                                    <button 
                                        type="button"
                                        onClick={async () => {
                                            const res = await dataService.fetchUserContentAccess(editingUser.id);
                                            alert(`El motor resolvió el acceso de E6 para este usuario:\n\nReglas aplicadas: ${res?.appliedRules?.length || 0}\nTítulos permitidos: ${res?.titleIds?.length || 0}\nColecciones permitidas: ${res?.collectionIds?.length || 0}\nBroad Access: ${res?.hasBroadAccess ? 'Sí' : 'No'}`);
                                        }}
                                        className="text-sm px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-200 transition-colors"
                                    >
                                        🛠 Probar Resolución de Accesos E6
                                    </button>
                                </div>
                            )}

                            {userSaveMsg && (
                                <div
                                    role="alert"
                                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 ${
                                        userSaveMsg.type === 'success'
                                            ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                                            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
                                    }`}
                                >
                                    {userSaveMsg.type === 'success'
                                        ? <Check size={16} className="flex-shrink-0" />
                                        : <AlertCircle size={16} className="flex-shrink-0" />}
                                    {userSaveMsg.text}
                                </div>
                            )}

                            <div className="pt-4 flex justify-end gap-3 mt-4">
                                <button onClick={() => { setIsUserModalOpen(false); setUserSaveMsg(null); }} className="px-4 py-2 text-gray-600 font-medium">Cancelar</button>
                                <button
                                    onClick={handleSaveUser}
                                    disabled={isSavingUser || (userNeedsGroup && !userHasGroup)}
                                    title={userNeedsGroup && !userHasGroup ? 'Selecciona el curso o club del estudiante' : undefined}
                                    className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSavingUser ? 'Guardando…' : (editingUser?.id ? 'Actualizar Usuario' : 'Crear Usuario')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* GROUP MODAL */}
            {isGroupModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md p-6 shadow-xl animate-in zoom-in duration-200">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold">{editingGroup?.id ? 'Editar Grupo' : 'Nuevo Grupo'}</h3>
                            <button onClick={() => setIsGroupModalOpen(false)}><X size={24} className="text-gray-400" /></button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Nombre</label>
                                <input
                                    type="text"
                                    value={editingGroup?.name || ''}
                                    onChange={e => setEditingGroup(prev => ({ ...prev!, name: e.target.value }))}
                                    className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Grado</label>
                                <input
                                    type="text"
                                    value={editingGroup?.grade || ''}
                                    onChange={e => setEditingGroup(prev => ({ ...prev!, grade: e.target.value }))}
                                    className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 flex items-center justify-between">
                                    Tipo de Agrupación
                                </label>
                                <select
                                    value={editingGroup?.type || 'course'}
                                    onChange={e => setEditingGroup(prev => ({ ...prev!, type: e.target.value as 'course' | 'club' }))}
                                    className="w-full p-2 border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-gray-800"
                                >
                                    <option value="course">🏫 Curso Escolar Ordinario</option>
                                    <option value="club">🎪 Club de Lectura (Extracurricular)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Mediadores Asignados</label>
                                <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-lg p-3 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 space-y-2">
                                    {managers.length === 0 && <p className="text-xs text-gray-400 italic">No hay mediadores o administradores registrados en el colegio.</p>}
                                    {managers.map(t => {
                                        const isSelected = editingGroup?.mediatorIds?.includes(t.id) || editingGroup?.teacherId === t.id;
                                        return (
                                            <div key={t.id} className="flex items-center hover:bg-white dark:hover:bg-gray-700 p-1 rounded transition-colors">
                                                <input
                                                    type="checkbox"
                                                    id={`med-${t.id}`}
                                                    checked={!!isSelected}
                                                    onChange={(e) => {
                                                        const current = editingGroup?.mediatorIds || (editingGroup?.teacherId ? [editingGroup.teacherId] : []);
                                                        let newMediators;
                                                        if (e.target.checked) {
                                                            newMediators = [...current, t.id];
                                                        } else {
                                                            newMediators = current.filter(id => id !== t.id);
                                                        }
                                                        setEditingGroup(prev => ({ 
                                                            ...prev!, 
                                                            mediatorIds: newMediators,
                                                            teacherId: newMediators.length > 0 ? newMediators[0] : ''
                                                        }));
                                                    }}
                                                    className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                />
                                                <label htmlFor={`med-${t.id}`} className="ml-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer flex-grow">
                                                    {t.nombre_completo} <span className="text-xs text-gray-400 ml-1">({t.email})</span>
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            </div>

                            {/* --- SECCIÓN COMERCIAL (FASE 6C) --- */}
                            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                                <h4 className="font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center">
                                    <Shield size={16} className="mr-2 text-indigo-500" /> Control de Permisos y Vigencia
                                </h4>
                                
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-500 mb-1">Modo de Acceso al Catálogo</label>
                                        <select 
                                            value={
                                                editingGroup?.availableContentIds === undefined ? 'inherit' :
                                                editingGroup?.availableContentIds === 'all' ? 'all' :
                                                (Array.isArray(editingGroup?.availableContentIds) && editingGroup.availableContentIds.length === 0) ? 'none' : 'custom'
                                            }
                                            onChange={e => {
                                                const val = e.target.value;
                                                let newAvailable: string[] | 'all' | undefined = undefined;
                                                if (val === 'inherit') newAvailable = undefined;
                                                else if (val === 'all') newAvailable = 'all';
                                                else if (val === 'none') newAvailable = [];
                                                else if (val === 'custom') newAvailable = []; // Inicia vacío para seleccionar
                                                
                                                setEditingGroup(prev => ({ ...prev!, availableContentIds: newAvailable }));
                                            }}
                                            className="w-full p-2 text-sm border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 bg-white dark:bg-gray-800 font-medium"
                                        >
                                            <option value="inherit">Heredar Abierto / Sin Restricción</option>
                                            <option value="all">Fuerza Acceso Total (Ignora Colegio)</option>
                                            <option value="none">Bloqueo Total (Catálogo Vacío)</option>
                                            <option value="custom">Catálogo Restringido (Selección manual)</option>
                                        </select>
                                    </div>

                                    {Array.isArray(editingGroup?.availableContentIds) && (
                                        <div className="p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <label className="block text-xs font-semibold text-gray-500 mb-2">Contenidos Individuales Autorizados</label>
                                            <div className="max-h-32 overflow-y-auto space-y-1">
                                                {allBookContent.filter(c => !c.isCollection).map(c => {
                                                    const isChecked = editingGroup.availableContentIds?.includes(c.id);
                                                    return (
                                                        <label key={c.id} className="flex items-center text-sm cursor-pointer hover:bg-white dark:hover:bg-gray-700 p-1 rounded">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={!!isChecked}
                                                                onChange={e => {
                                                                    const current = (editingGroup.availableContentIds as string[]) || [];
                                                                    const next = e.target.checked ? [...current, c.id] : current.filter(id => id !== c.id);
                                                                    setEditingGroup(prev => ({ ...prev!, availableContentIds: next }));
                                                                }}
                                                                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                            />
                                                            <span className="ml-2 truncate max-w-[200px] font-medium text-gray-700 dark:text-gray-300">{c.titulo}</span>
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {Array.isArray(editingGroup?.availableContentIds) && allBookContent.filter(c => c.isCollection).length > 0 && (
                                        <div className="p-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <label className="block text-xs font-semibold text-gray-500 mb-2">O Incluir Colecciones Enteras</label>
                                            <div className="max-h-24 overflow-y-auto space-y-1">
                                                {allBookContent.filter(c => c.isCollection).map(c => {
                                                    const isChecked = editingGroup.collectionIds?.includes(c.id);
                                                    return (
                                                        <label key={c.id} className="flex items-center text-sm cursor-pointer hover:bg-white dark:hover:bg-gray-700 p-1 rounded">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={!!isChecked}
                                                                onChange={e => {
                                                                    const current = editingGroup.collectionIds || [];
                                                                    const next = e.target.checked ? [...current, c.id] : current.filter(id => id !== c.id);
                                                                    setEditingGroup(prev => ({ ...prev!, collectionIds: next }));
                                                                }}
                                                                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                            />
                                                            <span className="ml-2 truncate font-bold text-purple-600 dark:text-purple-400">{c.titulo}</span>
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* --- Warning: vigencia sin restricción de contenido (Fase 6C Sprint) --- */}
                                    {(editingGroup?.accessStartsAt || editingGroup?.accessEndsAt) &&
                                        editingGroup?.availableContentIds === undefined && (
                                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400">
                                            <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                                            <p className="text-xs leading-snug">
                                                Has configurado una vigencia, pero el acceso sigue en <strong>modo abierto (heredado)</strong>.
                                                Este grupo no tendrá restricciones de contenido aunque las fechas expiren.
                                            </p>
                                        </div>
                                    )}

                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <label className="block text-xs font-semibold text-gray-500 mb-1">Vigencia Inicia</label>
                                            <input 
                                                type="date" 
                                                value={editingGroup?.accessStartsAt ? new Date(editingGroup.accessStartsAt).toISOString().split('T')[0] : ''}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setEditingGroup(prev => ({ ...prev!, accessStartsAt: val ? new Date(val).toISOString() : undefined }));
                                                }}
                                                className="w-full p-2 text-sm border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 bg-white dark:bg-gray-800" 
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-xs font-semibold text-gray-500 mb-1">Vigencia Termina</label>
                                            <input 
                                                type="date" 
                                                value={editingGroup?.accessEndsAt ? new Date(editingGroup.accessEndsAt).toISOString().split('T')[0] : ''}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setEditingGroup(prev => ({ ...prev!, accessEndsAt: val ? new Date(val).toISOString() : undefined }));
                                                }}
                                                className="w-full p-2 text-sm border border-gray-300 rounded-lg dark:bg-gray-700 dark:border-gray-600 bg-white dark:bg-gray-800" 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-6 space-y-3">
                                {/* Mensaje de estado: éxito o error */}
                                {groupSaveMsg && (
                                    <div className={`px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 ${
                                        groupSaveMsg.type === 'success'
                                            ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                                            : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
                                    }`}>
                                        {groupSaveMsg.type === 'success' ? (
                                            <Check size={16} className="flex-shrink-0" />
                                        ) : (
                                            <AlertCircle size={16} className="flex-shrink-0" />
                                        )}
                                        {groupSaveMsg.text}
                                    </div>
                                )}

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => { setIsGroupModalOpen(false); setGroupSaveMsg(null); }}
                                        disabled={isSaving}
                                        className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleSaveGroup}
                                        disabled={isSaving}
                                        className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 shadow-md disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2 min-w-[110px] justify-center"
                                    >
                                        {isSaving ? (
                                            <>
                                                {/* Spinner CSS puro */}
                                                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                Guardando…
                                            </>
                                        ) : 'Guardar'}
                                    </button>
                                </div>
                            </div>
                    </div>
                </div>
            )}
            {/* CATALOG MODAL */}
            {isCatalogModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in duration-200">
                        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800 rounded-t-xl">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800 dark:text-white flex items-center">
                                    <BookOpen className="mr-2 text-indigo-600" />
                                    Catálogo: {selectedSchool}
                                </h3>
                                <p className="text-sm text-gray-500">
                                    Marca los contenidos que NO quieres mostrar a los estudiantes de este colegio.
                                </p>
                            </div>
                            <button onClick={() => setIsCatalogModalOpen(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
                                <X size={24} className="text-gray-500" />
                            </button>
                        </div>

                        <div className="flex-grow overflow-y-auto p-6 bg-gray-50/50 dark:bg-gray-900/50">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {allBookContent.map(content => {
                                    const isHidden = schoolConfig.hiddenContentIds?.includes(content.id);
                                    return (
                                        <div
                                            key={content.id}
                                            className={`
                                                relative p-4 rounded-xl border-2 cursor-pointer transition-all flex items-start gap-3
                                                ${isHidden
                                                    ? 'border-red-500 bg-red-50 dark:bg-red-900/10'
                                                    : 'border-white dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-200'
                                                }
                                                shadow-sm
                                            `}
                                            onClick={() => handleToggleHidden(content.id)}
                                        >
                                            <div className="w-16 h-24 flex-shrink-0 bg-gray-200 rounded overflow-hidden">
                                                {content.portada_url ? (
                                                    <img src={content.portada_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">Sin img</div>
                                                )}
                                            </div>
                                            <div className="flex-grow min-w-0">
                                                <h4 className={`font-bold text-sm leading-tight mb-1 truncate ${isHidden ? 'text-red-700 dark:text-red-400' : 'text-gray-800 dark:text-gray-200'}`}>
                                                    {content.titulo}
                                                </h4>
                                                <p className="text-xs text-gray-500 truncate">{content.autor}</p>
                                                <div className="mt-2 flex items-center gap-2">
                                                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${isHidden ? 'bg-red-500 border-red-500 text-white' : 'border-gray-300 bg-white'}`}>
                                                        {isHidden && <Check size={14} />}
                                                    </div>
                                                    <span className={`text-xs font-semibold ${isHidden ? 'text-red-600' : 'text-gray-400'}`}>
                                                        {isHidden ? 'No Catalogado (Oculto)' : 'Visible'}
                                                    </span>
                                                </div>
                                            </div>
                                            {isHidden && (
                                                <div className="absolute top-2 right-2 text-red-500">
                                                    <EyeOff size={16} />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="p-4 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-b-xl flex justify-end">
                            <button
                                onClick={() => setIsCatalogModalOpen(false)}
                                className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 shadow-lg"
                            >
                                Guardar y Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* QUICK CLUB MODAL */}
            {isQuickClubModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-amber-50 dark:bg-amber-900/10 rounded-t-xl">
                            <h3 className="text-xl font-bold text-amber-600 flex items-center">
                                <Zap className="mr-2" size={20} /> Creación Rápida: Club de Lectura
                            </h3>
                            <button onClick={() => setIsQuickClubModalOpen(false)} className="p-2 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-full transition-colors">
                                <X size={24} className="text-amber-600" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Nombre del Club</label>
                                <input 
                                    type="text"
                                    value={quickClubForm.name}
                                    onChange={e => setQuickClubForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Ej: Club de Verano 2024"
                                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none dark:bg-gray-700"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Mediador Responsable</label>
                                    <select 
                                        value={quickClubForm.mediatorId}
                                        onChange={e => setQuickClubForm(prev => ({ ...prev, mediatorId: e.target.value }))}
                                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700"
                                    >
                                        {managers.map(t => (
                                            <option key={t.id} value={t.id}>{t.nombre_completo}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Vigencia (Meses)</label>
                                    <select 
                                        value={quickClubForm.durationMonths}
                                        onChange={e => setQuickClubForm(prev => ({ ...prev, durationMonths: e.target.value }))}
                                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700"
                                    >
                                        <option value="1">1 Mes</option>
                                        <option value="3">3 Meses</option>
                                        <option value="6">6 Meses</option>
                                        <option value="12">12 Meses</option>
                                        <option value="48">Ilimitado (4 años)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="p-4 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-gray-100 dark:border-gray-800">
                                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Contenido de la Suscripción</label>
                                <div className="space-y-3">
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => setQuickClubForm(prev => ({ ...prev, contentType: 'all', selectedContentId: '' }))}
                                            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${quickClubForm.contentType === 'all' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700'}`}
                                        >
                                            TODO EL CATÁLOGO
                                        </button>
                                        <button 
                                            onClick={() => setQuickClubForm(prev => ({ ...prev, contentType: 'collection', selectedContentId: (allBookContent.find(c => c.isCollection)?.id || '') }))}
                                            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${quickClubForm.contentType === 'collection' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700'}`}
                                        >
                                            UNA COLECCIÓN
                                        </button>
                                        <button 
                                            onClick={() => setQuickClubForm(prev => ({ ...prev, contentType: 'book', selectedContentId: (allBookContent.find(c => !c.isCollection)?.id || '') }))}
                                            className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${quickClubForm.contentType === 'book' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700'}`}
                                        >
                                            UN LIBRO
                                        </button>
                                    </div>

                                    {/* COLLECTION CARD PICKER */}
                                    {quickClubForm.contentType === 'collection' && (() => {
                                        const collections = allBookContent.filter(c => c.isCollection);
                                        const withCounts = collections.map(col => ({
                                            col,
                                            count: allBookContent.filter(c => c.parentId === col.id).length
                                        })).sort((a, b) => b.count - a.count);
                                        const topIds = new Set(withCounts.slice(0, 2).map(x => x.col.id));
                                        return (
                                            <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto pr-1">
                                                {withCounts.map(({ col, count }) => {
                                                    const isSelected = quickClubForm.selectedContentId === col.id;
                                                    const isTop = topIds.has(col.id);
                                                    return (
                                                        <button
                                                            key={col.id}
                                                            type="button"
                                                            onClick={() => setQuickClubForm(prev => ({ ...prev, selectedContentId: col.id }))}
                                                            className={`w-full text-left px-3 py-2.5 rounded-lg border-2 transition-all flex items-center justify-between gap-2 ${isSelected ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-amber-300'}`}
                                                        >
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="text-lg">📦</span>
                                                                <div className="min-w-0">
                                                                    <span className={`text-sm font-bold block truncate ${isSelected ? 'text-amber-700 dark:text-amber-300' : 'text-gray-700 dark:text-gray-200'}`}>{col.titulo}</span>
                                                                    <span className="text-xs text-gray-400">{count} título{count !== 1 ? 's' : ''} incluidos</span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                                {isTop && <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-bold px-1.5 py-0.5 rounded-full border border-amber-200">★ Recomendado</span>}
                                                                {isSelected && <Check size={16} className="text-amber-500 flex-shrink-0" />}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                                {collections.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No hay colecciones disponibles en el catálogo.</p>}
                                            </div>
                                        );
                                    })()}

                                    {/* BOOK PICKER */}
                                    {quickClubForm.contentType === 'book' && (
                                        <select 
                                            value={quickClubForm.selectedContentId}
                                            onChange={e => setQuickClubForm(prev => ({ ...prev, selectedContentId: e.target.value }))}
                                            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 outline-none focus:ring-1 focus:ring-amber-500"
                                        >
                                            {allBookContent.filter(c => !c.isCollection && (c.tipo === 'libro' || c.tipo === 'libro_album')).map(c => (
                                                <option key={c.id} value={c.id}>{c.titulo} — {c.autor}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl flex justify-end gap-3">
                            <button 
                                onClick={() => setIsQuickClubModalOpen(false)}
                                className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={handleSaveQuickClub}
                                disabled={isSaving || !quickClubForm.name}
                                className="px-6 py-2 bg-amber-500 text-white font-bold rounded-lg shadow-lg hover:bg-amber-600 transition-all transform active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
                            >
                                {isSaving ? <Clock size={18} className="animate-spin" /> : <Zap size={18} />}
                                GENERAR CLUB VENDIBLE
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminUsuarios;
