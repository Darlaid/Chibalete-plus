
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV?.trim() === 'production';

// --- SECURITY MIDDLEWARE ---
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for now to avoid React conflicts in simple setups
    crossOriginEmbedderPolicy: false,
}));

app.use(cors()); // Configure specifically for your domain in real prod
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Authentication Middleware (Simple Secret)
const requireAuth = (req, res, next) => {
    // Skip auth for GET requests if you want public read access
    if (req.method === 'GET') return next();

    const authHeader = req.headers['x-admin-secret'];
    // In a real app, use a secure env var. For this demo/MVP, we'll check against a hardcoded value or env.
    const SECRET = process.env.ADMIN_SECRET || 'chibalete-secure-upload-2025';

    if (authHeader === SECRET) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized: Invalid Admin Secret' });
    }
};

// Apply auth to API mutations
app.use('/api/upload', requireAuth);
app.use('/api/content', requireAuth);


// --- CONFIGURATION ---
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const DB_FILE = path.join(__dirname, '../data/content_db.json');

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(path.dirname(DB_FILE))) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

// Initialize DB if empty
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

// --- MULTER STORAGE & VALIDATION ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Check for parentId in query or body (Query is more reliable for diskStorage)
        const parentId = req.query.parentId || req.body.parentId;
        let dest = UPLOAD_DIR;

        if (parentId) {
            // Sanitize parentId to prevent directory traversal
            const safeParentId = parentId.replace(/[^a-zA-Z0-9\-_]/g, '');
            if (safeParentId) {
                dest = path.join(UPLOAD_DIR, safeParentId);
            }
        }

        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        cb(null, dest);
    },
    filename: function (req, file, cb) {
        // Sanitize filename: timestamp + original name (replace spaces with underscores)
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // Aggressive sanitization
        const sanitizeName = file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9.\-_]/g, '');
        cb(null, uniqueSuffix + '-' + sanitizeName);
    }
});

const fileFilter = (req, file, cb) => {
    // Allowed types
    const allowedTypes = [
        'application/pdf',
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'audio/mpeg', 'audio/wav', 'audio/mp3',
        'video/mp4', 'video/webm',
        'text/plain', 'text/markdown'
    ];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF, Images, Audio, and Video are allowed.'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 300 * 1024 * 1024 // 300MB limit
    }
});

// --- API ROUTES ---

// 1. Get All Content (Public)
app.get('/api/content', (req, res) => {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        const content = JSON.parse(data);
        res.json(content);
    } catch (error) {
        console.error('Error reading DB:', error);
        res.status(500).json({ error: 'Failed to read database' });
    }
});

// 4. Delete Content (Protected)
app.delete('/api/content/:id', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const data = fs.readFileSync(DB_FILE, 'utf8');
        let contentList = JSON.parse(data);

        const itemIndex = contentList.findIndex(c => c.id === id);

        if (itemIndex === -1) {
            return res.status(404).json({ error: 'Content not found' });
        }

        const item = contentList[itemIndex];

        // 1. Try to delete specific file if it's a legacy flat path
        if (item.url && !item.url.includes('/uploads/content-')) {
            const filename = path.basename(item.url);
            const filePath = path.join(UPLOAD_DIR, filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // 2. Try to delete the entire folder if it is a structured content
        // This assumes the folder name matches the content ID
        const contentDir = path.join(UPLOAD_DIR, id);
        if (fs.existsSync(contentDir)) {
            // Remove directory and all contents
            fs.rmSync(contentDir, { recursive: true, force: true });
        }

        // Remove from DB
        contentList.splice(itemIndex, 1);
        fs.writeFileSync(DB_FILE, JSON.stringify(contentList, null, 2));

        res.json({ success: true, message: 'Content deleted successfully' });

    } catch (error) {
        console.error('Error deleting content:', error);
        res.status(500).json({ error: 'Failed to delete content' });
    }
});

// 2. Upload File (Protected by middleware)
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            // A Multer error occurred when uploading.
            return res.status(400).json({ error: `Upload Error: ${err.message}` });
        } else if (err) {
            // An unknown error occurred when uploading.
            return res.status(400).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Calculate public URL
    });
});

// 3. Save/Update Content Metadata (Protected by middleware)
app.post('/api/content', (req, res) => {
    try {
        const newContent = req.body;

        if (!newContent.id || !newContent.titulo) {
            return res.status(400).json({ error: 'Invalid content data' });
        }

        const data = fs.readFileSync(DB_FILE, 'utf8');
        let contentList = JSON.parse(data);

        // Check if exists (update) or new (push)
        const index = contentList.findIndex((c) => c.id === newContent.id);
        if (index >= 0) {
            contentList[index] = newContent;
        } else {
            contentList.push(newContent);
        }

        fs.writeFileSync(DB_FILE, JSON.stringify(contentList, null, 2));
        res.json({ success: true, message: 'Content saved successfully', content: newContent });

    } catch (error) {
        console.error('Error saving content:', error);
        res.status(500).json({ error: 'Failed to save content' });
    }
});

// --- STATIC FILES (PRODUCTION) ---
// In production, serve the React build
// And ensure /uploads is also served
app.use('/uploads', express.static(UPLOAD_DIR));

if (IS_PROD) {
    // Logging middleware for debugging
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.url}`);
        next();
    });

    const DIST_DIR = path.join(__dirname, '../dist');
    app.use(express.static(DIST_DIR));

    // SPA Fallback - Capture everything not handled above
    app.use((req, res) => {
        if (req.accepts('html')) {
            res.sendFile(path.join(DIST_DIR, 'index.html'));
        } else {
            res.status(404).json({ error: 'Not Found' });
        }
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Uploads directory: ${UPLOAD_DIR}`);
});
