

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { fileTypeFromFile } from 'file-type';

// Configure dotenv to load from parent directory .env
// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });


const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV?.trim() === 'production';

// Configurar trust proxy para express-rate-limit detrás de Nginx Docker -> Host
app.set('trust proxy', 1);

import { generateAudioForContent } from './ttsService.js';

// --- LOGGING HELPER ---
const log = (msg, type = 'INFO') => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${msg}`);
};

log(`Starting server in ${IS_PROD ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);

// --- SECURITY MIDDLEWARE ---
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000
});
app.use('/api/', limiter);

// --- AUTH MIDDLEWARE ---
const requireAuth = (req, res, next) => {
    if (req.method === 'GET') return next();
    const authHeader = req.headers['x-admin-secret'];
    const SECRET = process.env.ADMIN_SECRET || 'chibalete-secure-upload-2025';

    if (authHeader === SECRET) {
        next();
    } else {
        log(`Unauthorized access attempt from ${req.ip}. Received Secret length: ${authHeader?.length || 0}. Expected: ${SECRET.length}`, 'WARN');
        res.status(401).json({ error: 'Unauthorized: Invalid Admin Secret' });
    }
};

app.use('/api/upload', requireAuth);
app.use('/api/content', requireAuth);

// --- CONFIGURATION ---
// Ensure we use absolute paths relative to execution or this file
const UPLOAD_DIR = path.resolve(__dirname, '../public/uploads');
const TEMP_DIR = path.join(UPLOAD_DIR, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// --- DATABASE FILES ---
const USERS_DB = path.resolve(__dirname, '../data/users_db.json');
const GROUPS_DB = path.resolve(__dirname, '../data/groups_db.json');
const PROGRESS_DB = path.resolve(__dirname, '../data/progress_db.json');
const DB_FILE = path.resolve(__dirname, '../data/content.json');
const SECTIONS_DB = path.resolve(__dirname, '../data/sections.json'); // Added likely missing definition based on context
const SCHOOL_CONFIGS_DB = path.resolve(__dirname, '../data/school_configs.json');

log(`Users DB: ${USERS_DB}`);
log(`Groups DB: ${GROUPS_DB}`);
log(`Progress DB: ${PROGRESS_DB}`);

// Ensure DB files exist
[USERS_DB, GROUPS_DB, PROGRESS_DB, DB_FILE].forEach(file => {
    if (!fs.existsSync(path.dirname(file))) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
    }
});

// --- HELPER WRAPPERS ---
const readJSON = (file) => {
    try {
        if (!fs.existsSync(file)) return [];
        const data = fs.readFileSync(file, 'utf8');
        if (!data.trim()) return [];
        return JSON.parse(data);
    } catch (e) {
        log(`Error reading ${file}: ${e.message}`, 'ERROR');
        // Backup corrupted file
        if (fs.existsSync(file)) {
            const backupPath = `${file}.corrupt.${Date.now()}`;
            fs.copyFileSync(file, backupPath);
            log(`Corrupted DB backed up to ${backupPath}`, 'WARN');
        }
        return [];
    }
};

const writeJSON = (file, data) => {
    try {
        const tempFile = `${file}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.renameSync(tempFile, file); // Atomic move
    } catch (e) {
        log(`Error writing ${file}: ${e.message}`, 'ERROR');
        throw e; // Relanza error para permitir rollback transaccional
    }
};

// --- ROBUST UPLOAD HELPERS ---
const isTextFileSafe = (filePath) => {
    try {
        const buffer = Buffer.alloc(4096);
        const fd = fs.openSync(filePath, 'r');
        const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
        fs.closeSync(fd);
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0x00) return false;
        }
        return true;
    } catch (e) {
        log(`Error leyendo validación TXT: ${e.message}`, 'ERROR');
        return false;
    }
};

const safeUnlink = (filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (e) { log(`Error unlink: ${e.message}`, 'WARN'); }
    }
};

const getExpectedCategoryFromExtension = (ext) => {
    const e = ext.toLowerCase();
    if (e === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(e)) return 'image';
    if (['mp3', 'wav'].includes(e)) return 'audio';
    if (['mp4', 'webm'].includes(e)) return 'video';
    if (e === 'txt') return 'text';
    return 'unknown';
};

const matchesExpectedCategory = (category, fileTypeInfo) => {
    if (!fileTypeInfo) return false;
    const { mime } = fileTypeInfo;
    
    switch (category) {
        case 'pdf': return mime === 'application/pdf';
        case 'image': return mime.startsWith('image/');
        case 'audio': return mime.startsWith('audio/');
        case 'video': return mime.startsWith('video/');
        default: return false; // Text expects fileTypeInfo to be undefined typically
    }
};

const rollbackMetadataFiles = (newContent) => {
    const urlFields = [
        'portada_url', 
        'url_recurso', 
        'texto_plano_url', 
        'texto_ingles_url', 
        'ilustraciones_url'
    ];
    
    urlFields.forEach(field => {
        const value = newContent[field];
        if (!value) return;

        if (Array.isArray(value)) {
            value.forEach(url => {
                const filePath = path.join(UPLOAD_DIR, url.replace('/uploads/', ''));
                safeUnlink(filePath);
            });
        } else if (typeof value === 'string') {
            const filePath = path.join(UPLOAD_DIR, value.replace('/uploads/', ''));
            safeUnlink(filePath);
        }
    });
};

// --- ROUTES ---

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// --- CONTENT ROUTES ---
app.get('/api/content', (req, res) => {
    try {
        res.json(readJSON(DB_FILE));
    } catch (error) {
        res.status(500).json({ error: 'Failed to read database' });
    }
});

// DELETE CONTENT
app.delete('/api/content/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    log(`Request to delete content: ${id}`, 'INFO');

    try {
        const contentList = readJSON(DB_FILE);
        const itemIndex = contentList.findIndex(c => c.id === id);

        if (itemIndex === -1) {
            log(`Content not found in DB: ${id}`, 'WARN');
            return res.status(404).json({ error: 'Content not found' });
        }

        const item = contentList[itemIndex];

        // 1. Clean up file if simple upload
        if (item.url && !item.url.includes('/uploads/content-')) {
            const filename = path.basename(item.url);
            const filePath = path.join(UPLOAD_DIR, filename);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    log(`Deleted file: ${filePath}`, 'DEBUG');
                } catch (e) {
                    log(`Failed to delete file ${filePath}: ${e.message}`, 'ERROR');
                }
            }
        }

        // 2. Clean up folder if structured
        const contentDir = path.join(UPLOAD_DIR, id);
        if (fs.existsSync(contentDir)) {
            try {
                fs.rmSync(contentDir, { recursive: true, force: true });
                log(`Deleted directory: ${contentDir}`, 'DEBUG');
            } catch (e) {
                log(`Failed to delete directory ${contentDir}: ${e.message}`, 'ERROR');
            }
        } else {
            log(`Directory already missing: ${contentDir}`, 'DEBUG');
        }

        contentList.splice(itemIndex, 1);
        writeJSON(DB_FILE, contentList);
        log(`Content removed from DB: ${id}`, 'SUCCESS');

        res.json({ success: true, message: 'Content deleted successfully' });

    } catch (error) {
        log(`CRITICAL DELETE ERROR: ${error.message}`, 'ERROR');
        res.status(500).json({ error: error.message });
    }
});

// UPLOAD CONFIG - Guardado Inicial a TEMP
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_').toLowerCase();
        cb(null, name + '-' + uniqueSuffix + ext);
    }
});

// Filtro Nominal (Capa 1)
const fileFilter = (req, file, cb) => {
    const allowedExtensions = /pdf|txt|jpeg|jpg|png|webp|gif|mp3|wav|mp4|webm/;
    const allowedMimeTypes = /application\/pdf|text\/plain|image\/.*|audio\/.*|video\/.*/;

    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error(`Tipo nominal no permitido: ${file.originalname}`));
    }
};

const upload = multer({ storage, fileFilter });


// UPLOAD CON VALIDACIÓN BINARIA (Capa 2)
app.post('/api/upload', (req, res) => {
    log('Upload started...', 'INFO');
    upload.single('file')(req, res, async (err) => {
        if (err) {
            log(`Upload Middleware Error: ${err.message}`, 'ERROR');
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const tempPath = req.file.path;
        
        try {
            // Verificar Magic Numbers reales
            const fileTypeInfo = await fileTypeFromFile(tempPath);
            const rawExt = path.extname(req.file.originalname).toLowerCase().replace('.', '');
            const expectedCategory = getExpectedCategoryFromExtension(rawExt);
            
            let isValid = false;

            if (expectedCategory === 'text') {
                // TXT validation: Usually file-type returns undefined for pure txt
                // But we must check for null bytes to prevent binary spoofing
                isValid = isTextFileSafe(tempPath);
            } else if (expectedCategory !== 'unknown') {
                // For PDF, Video, Audio, Image we MUST match strictly the mime category
                isValid = matchesExpectedCategory(expectedCategory, fileTypeInfo);
            }
            
            if (!isValid) {
                safeUnlink(tempPath);
                log(`Spoofing o binario malicioso detectado y purgado: ${req.file.originalname} (Expected: ${expectedCategory}, Real Mime: ${fileTypeInfo ? fileTypeInfo.mime : 'none'})`, 'SECURITY');
                return res.status(415).json({ error: 'El contenido real del archivo no coincide con su extensión o contiene código binario no seguro.' });
            }

            // Mover a destino definitivo si pasó las mallas
            let finalDestDir = UPLOAD_DIR;
            if (req.query.parentId) {
                finalDestDir = path.join(UPLOAD_DIR, req.query.parentId);
                if (!fs.existsSync(finalDestDir)) fs.mkdirSync(finalDestDir, { recursive: true });
            }

            const finalPath = path.join(finalDestDir, req.file.filename);
            fs.renameSync(tempPath, finalPath);

            const relativePath = path.relative(UPLOAD_DIR, finalPath);
            const fileUrl = `/uploads/${relativePath.split(path.sep).join('/')}`;

            log(`File validated and stored: ${req.file.filename}`, 'SUCCESS');
            res.status(200).json({
                success: true,
                url: fileUrl,
                filename: req.file.filename,
                mimetype: fileTypeInfo ? fileTypeInfo.mime : (expectedCategory === 'text' ? 'text/plain' : req.file.mimetype),
                size: req.file.size
            });

        } catch (validationErr) {
            log(`Validation crash: ${validationErr.message}`, 'ERROR');
            safeUnlink(tempPath);
            res.status(500).json({ error: 'Error procesando la validación del archivo' });
        }
    });
});

// SAVE CONTENT METADATA
app.post('/api/content', (req, res) => {
    try {
        const newContent = req.body;
        
        // 1. Validar metadata base para evitar registros basura
        if (!newContent.id || !newContent.titulo) {
             return res.status(400).json({ error: 'Faltan campos obligatorios de Metadata (id, titulo)' });
        }

        log(`Saving content metadata: ${newContent.id}`, 'INFO');

        const contentList = readJSON(DB_FILE);

        // Check for text changes to trigger TTS
        const index = contentList.findIndex((c) => c.id === newContent.id);
        let shouldGenerateTTS = false;

        const oldContent = index >= 0 ? contentList[index] : null;

        if (oldContent) {
            // Update existing
            if (newContent.texto_plano_url && newContent.texto_plano_url !== oldContent.texto_plano_url) {
                shouldGenerateTTS = true;
            } else if (newContent.texto_plano_url && (!fs.existsSync(path.join(UPLOAD_DIR, 'audio', newContent.id, 'manifest.json')))) {
                // Trigger if text exists but manifest is missing (Reprocess/Retry)
                shouldGenerateTTS = true;
            }
        } else {
            // New content
            if (newContent.texto_plano_url) {
                shouldGenerateTTS = true;
            }
        }

        // Apply Status
        if (shouldGenerateTTS) {
            newContent.status = 'procesando';
        } else if (!newContent.status && oldContent && oldContent.status) {
            // Keep existing status if not generating
            newContent.status = oldContent.status;
        } else if (!newContent.status) {
            // Default
            newContent.status = 'disponible';
        }

        // Save to List
        if (index >= 0) {
            contentList[index] = newContent;
        } else {
            contentList.push(newContent);
        }

        // 2. Transaccionalidad / Rollback Crítico
        try {
            writeJSON(DB_FILE, contentList);
        } catch (dbWriteErr) {
            // Si la base de datos local falla, orfandad evitada iterando explícitamente sobre el modelo de Chibalete
            if (index === -1) {
                rollbackMetadataFiles(newContent);
                log('Rollback orfandad aplicado.', 'WARN');
            }
            throw new Error('Fallo al escribir en la base JSON de Content');
        }

        res.json({ success: true, content: newContent });

        // --- ASYNC TTS TRIGGER ---
        if (shouldGenerateTTS) {
            log(`Triggering TTS background generation for ${newContent.id}...`, 'TTS');
            const relativePath = newContent.texto_plano_url.replace(/^\/uploads\//, '');
            const textFullPath = path.join(UPLOAD_DIR, relativePath);

            // Progress Handler
            const onProgress = (status) => {
                try {
                    const currentList = readJSON(DB_FILE);
                    const idx = currentList.findIndex(c => c.id === newContent.id);
                    if (idx !== -1) {
                        // Only update if changed significantly or status changed to avoid thrashing? 
                        // For now, always update to show smooth progress bar.
                        currentList[idx].processingStatus = status;
                        // Determine main status
                        if (status.status === 'processing') currentList[idx].status = 'procesando';
                        if (status.status === 'failed') currentList[idx].status = 'error';
                        if (status.status === 'completed') currentList[idx].status = 'disponible';

                        writeJSON(DB_FILE, currentList);
                    }
                } catch (e) { /* ignore DB locks/rates */ }
            };

            generateAudioForContent(newContent.id, textFullPath, UPLOAD_DIR, onProgress)
                .then(result => {
                    if (result.success) {
                        log(`TTS finished for ${newContent.id}`, 'SUCCESS');
                        const finalStatus = {
                            percentage: 100,
                            currentSentence: 0, // irrelevant
                            totalSentences: 0,
                            status: 'completed',
                            lastUpdated: new Date().toISOString()
                        };
                        onProgress(finalStatus);
                        log(`Content ${newContent.id} marked as AVAILABLE`, 'INFO');

                    } else {
                        log(`TTS failed for ${newContent.id}: ${result.error}`, 'ERROR');
                        // Callback already called with 'failed' inside ttsService if catastrophic
                    }
                })
                .catch(err => {
                    log(`TTS Crash: ${err.message}`, 'ERROR');
                    onProgress({
                        percentage: 0, currentSentence: 0, totalSentences: 0, status: 'failed', error: err.message, lastUpdated: new Date().toISOString()
                    });
                });
        }
    } catch (error) {
        log(`Save Error: ${error.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to save content' });
    }
});

// --- USER HELPERS ---
const sanitizeUserForClient = (user) => {
    const { password, ...safeUser } = user;
    return safeUser;
};

const sanitizeUsersForClient = (users) => {
    return users.map(sanitizeUserForClient);
};

const normalizeEmail = (email) => {
    return email ? String(email).trim().toLowerCase() : '';
};

const normalizeRoles = (roles) => {
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
        return ['lector'];
    }
    const mappedRoles = roles.map(r => r === 'admin' ? 'administrador' : r);
    const validRoles = ['administrador', 'profesor', 'lector'];
    const filteredRoles = mappedRoles.filter(r => validRoles.includes(r));
    return filteredRoles.length > 0 ? filteredRoles : ['lector'];
};

const hashPasswordIfNeeded = (password) => {
    if (!password) return undefined;
    if (password.startsWith('$2')) return password; // Already hashed by bcrypt
    const salt = bcrypt.genSaltSync(10);
    return bcrypt.hashSync(password, salt);
};

// --- USER MANAGEMENT ROUTES ---

// GET USERS
app.get('/api/users', requireAuth, (req, res) => {
    try {
        const users = readJSON(USERS_DB);
        res.json(sanitizeUsersForClient(users));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// LOGIN
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    
    const users = readJSON(USERS_DB);
    const userIndex = users.findIndex(u => normalizeEmail(u.email) === normalizedEmail);

    if (userIndex !== -1) {
        const user = users[userIndex];
        let isValid = false;

        if (user.password && user.password.startsWith('$2')) {
            isValid = bcrypt.compareSync(password, user.password);
        } else {
            // Legacy plain text comparison
            if (user.password === password) {
                isValid = true;
                // Auto-upgrade security: Hash it and save immediately
                user.password = hashPasswordIfNeeded(password);
                users[userIndex] = user;
                writeJSON(USERS_DB, users);
                log(`Auto-upgraded password hash for legacy user: ${normalizedEmail}`, 'ACCESS');
            }
        }

        if (isValid) {
            return res.json({ success: true, user: sanitizeUserForClient(user) });
        }
    }
    
    res.status(401).json({ error: 'Credenciales inválidas' });
});

// CREATE USER
app.post('/api/users', requireAuth, (req, res) => {
    const newUser = req.body;
    if (!newUser.email || !newUser.nombre_completo || !newUser.password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const normalizedEmail = normalizeEmail(newUser.email);
    const users = readJSON(USERS_DB);

    if (users.some(u => normalizeEmail(u.email) === normalizedEmail)) {
        return res.status(409).json({ error: 'El email ya está registrado' });
    }

    if (newUser.id && users.some(u => u.id === newUser.id)) {
        return res.status(409).json({ error: 'El ID de usuario ya existe' });
    }

    if (!newUser.id) {
        newUser.id = `user-${Date.now()}`;
    }

    newUser.password = hashPasswordIfNeeded(newUser.password);
    newUser.roles = normalizeRoles(newUser.roles);
    newUser.email = normalizedEmail;

    users.push(newUser);
    writeJSON(USERS_DB, users);
    log(`User created: ${newUser.email} (${newUser.id})`, 'ACCESS');
    
    res.json(sanitizeUserForClient(newUser));
});

// UPDATE USER
app.put('/api/users/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const users = readJSON(USERS_DB);
    const index = users.findIndex(u => u.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (updates.id && updates.id !== id) {
        return res.status(400).json({ error: 'No se puede cambiar el ID del usuario' });
    }

    if (updates.email) {
        const newEmail = normalizeEmail(updates.email);
        // Validar duplicado si intenta cambiar su propio correo a otro existente
        if (newEmail !== normalizeEmail(users[index].email)) {
            if (users.some(u => normalizeEmail(u.email) === newEmail)) {
                return res.status(409).json({ error: 'El nuevo email ya está en uso' });
            }
        }
        updates.email = newEmail;
    }
    
    if (updates.roles) updates.roles = normalizeRoles(updates.roles);
    if (updates.password) updates.password = hashPasswordIfNeeded(updates.password);

    users[index] = { ...users[index], ...updates };
    writeJSON(USERS_DB, users);
    log(`User updated: ${id}`, 'ACCESS');
    
    res.json(sanitizeUserForClient(users[index]));
});

// DELETE USER
app.delete('/api/users/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const users = readJSON(USERS_DB);
    const index = users.findIndex(u => u.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    users.splice(index, 1);
    writeJSON(USERS_DB, users);
    log(`User deleted: ${id}`, 'ACCESS');
    res.json({ success: true });
});

// --- GROUP MANAGEMENT ROUTES ---

app.get('/api/groups', requireAuth, (req, res) => {
    try {
        res.json(readJSON(GROUPS_DB));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/groups', requireAuth, (req, res) => {
    const newGroup = req.body;
    if (!newGroup.id) {
        newGroup.id = `group-${Date.now()}`;
    }

    const groups = readJSON(GROUPS_DB);

    if (groups.some(g => g.id === newGroup.id)) {
        return res.status(409).json({ error: 'El ID del grupo ya existe' });
    }

    groups.push(newGroup);
    writeJSON(GROUPS_DB, groups);
    log(`Group created: ${newGroup.id}`, 'ACCESS');
    res.json(newGroup);
});

app.put('/api/groups/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const groups = readJSON(GROUPS_DB);
    const index = groups.findIndex(g => g.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    groups[index] = { ...groups[index], ...updates };
    writeJSON(GROUPS_DB, groups);
    log(`Group updated: ${id}`, 'ACCESS');
    res.json(groups[index]);
});

app.delete('/api/groups/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const groups = readJSON(GROUPS_DB);
    const index = groups.findIndex(g => g.id === id);

    if (index === -1) {
        return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    groups.splice(index, 1);
    writeJSON(GROUPS_DB, groups);
    log(`Group deleted: ${id}`, 'ACCESS');
    res.json({ success: true });
});

// --- SECTIONS ROUTES ---


// Ensure DBs exist
[SECTIONS_DB, SCHOOL_CONFIGS_DB].forEach(file => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify([], null, 2));
    }
});

app.get('/api/sections', (req, res) => {
    try {
        res.json(readJSON(SECTIONS_DB));
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/sections', requireAuth, (req, res) => {
    const newSection = req.body;
    if (!newSection.id) newSection.id = `section-${Date.now()}`;

    const sections = readJSON(SECTIONS_DB);
    sections.push(newSection);
    writeJSON(SECTIONS_DB, sections);
    res.json(newSection);
});

app.put('/api/sections/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const sections = readJSON(SECTIONS_DB);
    const index = sections.findIndex(s => s.id === id);

    if (index === -1) return res.status(404).json({ error: 'Section not found' });

    sections[index] = { ...sections[index], ...updates };
    writeJSON(SECTIONS_DB, sections);
    res.json(sections[index]);
});

app.delete('/api/sections/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const sections = readJSON(SECTIONS_DB);
    const index = sections.findIndex(s => s.id === id);
    if (index === -1) return res.status(404).json({ error: 'Section not found' });

    sections.splice(index, 1);
    writeJSON(SECTIONS_DB, sections);
    res.json({ success: true });
});

// --- SCHOOL CONFIG ROUTES (Filtering) ---
app.get('/api/schools/:name/config', requireAuth, (req, res) => {
    const { name } = req.params;
    try {
        const configs = readJSON(SCHOOL_CONFIGS_DB);
        const config = configs.find(c => c.schoolName === name) || { schoolName: name, hiddenContentIds: [] };
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/schools/:name/config', requireAuth, (req, res) => {
    const { name } = req.params;
    const newConfig = req.body; // Expect { hiddenContentIds: [...] }

    const configs = readJSON(SCHOOL_CONFIGS_DB);
    const index = configs.findIndex(c => c.schoolName === name);

    const updatedConfig = {
        schoolName: name,
        hiddenContentIds: newConfig.hiddenContentIds || []
    };

    if (index >= 0) {
        configs[index] = updatedConfig;
    } else {
        configs.push(updatedConfig);
    }

    writeJSON(SCHOOL_CONFIGS_DB, configs);
    res.json(updatedConfig);
});

// RETRY/REPAIR ROUTE (Must be before static catch-all)
app.post('/api/content/:id/retry', requireAuth, (req, res) => {
    const { id } = req.params;
    log(`Manual Retry requested for ${id}`, 'INFO');

    try {
        const contentList = readJSON(DB_FILE);
        const index = contentList.findIndex(c => c.id === id);

        if (index === -1) return res.status(404).json({ error: 'Content not found' });

        const content = contentList[index];
        if (!content.texto_plano_url) return res.status(400).json({ error: 'No text file linked' });

        // Reset Status
        content.status = 'procesando';
        content.processingStatus = {
            percentage: 0,
            currentSentence: 0,
            totalSentences: 0,
            status: 'processing',
            lastUpdated: new Date().toISOString()
        };
        writeJSON(DB_FILE, contentList);

        // Async Trigger
        const relativePath = content.texto_plano_url.replace(/^\/uploads\//, '');
        const textFullPath = path.join(UPLOAD_DIR, relativePath);

        generateAudioForContent(content.id, textFullPath, UPLOAD_DIR, (progress) => {
            // Re-read fresh to update
            const currentList = readJSON(DB_FILE);
            const idx = currentList.findIndex(c => c.id === id);
            if (idx !== -1) {
                // Merge status
                currentList[idx].processingStatus = progress;
                // If complete/failed
                if (progress.status === 'completed') currentList[idx].status = 'disponible';
                if (progress.status === 'failed') currentList[idx].status = 'error';
                writeJSON(DB_FILE, currentList);
            }
        })
            .then(r => log(`Retry result for ${id}: ${r.success}`, 'INFO'))
            .catch(e => log(`Retry crash for ${id}: ${e}`, 'ERROR'));

        res.json(content);

    } catch (e) {
        log(`Retry error: ${e}`, 'ERROR');
        res.status(500).json({ error: e.message });
    }
});

// --- STATIC FILES ---
app.use('/uploads', express.static(UPLOAD_DIR));

if (IS_PROD) {
    const DIST_DIR = path.join(__dirname, '../dist');
    app.use(express.static(DIST_DIR));
    app.use((req, res) => {
        if (req.accepts('html')) {
            res.sendFile(path.join(DIST_DIR, 'index.html'));
        } else {
            res.status(404).json({ error: 'Not Found' });
        }
    });
}


// --- BACKGROUND JOBS ---
const checkMissingTTS = async () => {
    log('Running startup check for missing TTS audio...', 'TTS');
    try {
        const contentList = readJSON(DB_FILE);
        let jobsTriggered = 0;
        let dbModified = false;

        for (const content of contentList) {
            if (!content.texto_plano_url) continue;

            const relativePath = content.texto_plano_url.replace(/^\/uploads\//, '');
            const textFullPath = path.join(UPLOAD_DIR, relativePath);
            const manifestPath = path.join(UPLOAD_DIR, 'audio', content.id, 'manifest.json');

            if (content.status === 'procesando') {
                content.status = 'error';
                content.processingStatus = { ...content.processingStatus, status: 'failed', error: 'Server Restarted - Job Interrupted' };
                log(`[Startup] Detected stuck job for ${content.id}. Marking as failed.`, 'WARN');
                dbModified = true;
            }

            if (fs.existsSync(textFullPath)) {
                let needsGen = false;
                if (!fs.existsSync(manifestPath)) {
                    needsGen = true;
                } else {
                    try {
                        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                        if (Object.keys(m).length === 0) needsGen = true;
                    } catch (e) {
                        needsGen = true;
                    }
                }

                if (needsGen) {
                    log(`[Startup] Missing audio for ${content.id}. Queueing generation.`, 'TTS');
                    
                    const onProgress = (status) => {
                        try {
                            const currentList = readJSON(DB_FILE);
                            const idx = currentList.findIndex(c => c.id === content.id);
                            if (idx !== -1) {
                                currentList[idx].processingStatus = status;
                                if (status.status === 'processing') currentList[idx].status = 'procesando';
                                if (status.status === 'failed') currentList[idx].status = 'error';
                                if (status.status === 'completed') currentList[idx].status = 'disponible';
                                writeJSON(DB_FILE, currentList);
                            }
                        } catch (e) { /* ignore locks */ }
                    };

                    generateAudioForContent(content.id, textFullPath, UPLOAD_DIR, onProgress)
                        .then(res => {
                            if (res.success) {
                                log(`[Startup] Generated audio for ${content.id}`, 'SUCCESS');
                                onProgress({ percentage: 100, currentSentence: 0, totalSentences: 0, status: 'completed', lastUpdated: new Date().toISOString() });
                            }
                            else {
                                log(`[Startup] Failed gen for ${content.id}: ${res.error}`, 'ERROR');
                            }
                        })
                        .catch(e => {
                            log(`[Startup] Crash gen ${content.id}: ${e.message}`, 'ERROR');
                            onProgress({ percentage: 0, currentSentence: 0, totalSentences: 0, status: 'failed', error: e.message, lastUpdated: new Date().toISOString() });
                        });

                    jobsTriggered++;
                }
            } else {
                log(`[Startup] Text file missing for ${content.id}: ${textFullPath}`, 'WARN');
            }
        }

        if (dbModified) {
            writeJSON(DB_FILE, contentList);
            log('[Startup] DB updated with failed stuck job states.', 'INFO');
        }

        if (jobsTriggered === 0) {
            log('Startup TTS check complete. All content has audio.', 'SUCCESS');
        } else {
            log(`Startup TTS check triggered ${jobsTriggered} jobs.`, 'INFO');
        }

    } catch (e) {
        log(`Error in startup TTS check: ${e.message}`, 'ERROR');
    }
};





// --- PROGRESS ROUTES (Sync) ---
app.get('/api/progress/user/:userId', requireAuth, (req, res) => {
    const { userId } = req.params;
    try {
        const allProgress = readJSON(PROGRESS_DB);
        const userProgress = allProgress.filter(p => p.usuario_id === userId);
        res.json(userProgress);
    } catch (e) {
        log(`Error fetching progress for ${userId}: ${e.message}`, 'ERROR');
        res.status(500).json({ error: 'Failed to fetch progress' });
    }
});

app.post('/api/progress', requireAuth, (req, res) => {
    const { userId, contentId, progressData } = req.body;
    // progressData expected: { percentage, position, timestamp }

    if (!userId || !contentId) return res.status(400).json({ error: 'Missing fields' });

    const allProgress = readJSON(PROGRESS_DB);
    const index = allProgress.findIndex(p => p.usuario_id === userId && p.contenido_id === contentId);

    const now = new Date().toISOString();
    let updatedEntry;

    if (index >= 0) {
        // Update existing
        // IMPORTANT: Conflict resolution - Server timestamp vs Client timestamp could be checked here.
        // For now, Last Write Wins (Server receives newest).
        updatedEntry = {
            ...allProgress[index],
            ultima_posicion: progressData.position.toString(),
            porcentaje: progressData.percentage,
            fecha_actualizacion: now
        };
        allProgress[index] = updatedEntry;
    } else {
        // Create new
        updatedEntry = {
            id: `prog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            usuario_id: userId,
            contenido_id: contentId,
            ultima_posicion: progressData.position.toString(),
            porcentaje: progressData.percentage,
            fecha_actualizacion: now
        };
        allProgress.push(updatedEntry);
    }

    writeJSON(PROGRESS_DB, allProgress);
    res.json({ success: true, progress: updatedEntry });
});


app.listen(PORT, '0.0.0.0', () => {
    log(`Server running on port ${PORT}`);
    // Run background check after distinct delay to allow server to settle
    setTimeout(checkMissingTTS, 2000);
});
