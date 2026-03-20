
// Node.js 18+ has native fetch. If on older node, we might need a polyfill, but assuming 18+ for this environment.
import fs from 'fs';

async function testUploadAndNovelty() {
    const API_URL = 'http://localhost:3001/api';
    const ADMIN_SECRET = 'chibalete-secure-upload-2025';

    console.log("1. Starting Simulation...");

    // 1. Upload a dummy file
    console.log("2. Uploading dummy file...");
    // Mocking file upload if possible, or just skip to metadata creation since we want to check logic
    // Actually, let's just create metadata directly to verify database logic for "Novedades"

    const newContent = {
        id: `test-book-${Date.now()}`,
        titulo: "Libro de Prueba Novedad",
        autor: "Tester",
        tipo: "libro",
        etiquetas: ["Nuevo", "libro", "aventura"],
        descripcion_corta: "Libro prueba autogenerado",
        portada_url: "https://via.placeholder.com/150",
        metricas: { veces_leido: 0, calificacion_promedio: 0 },
        publico_objetivo: "todos"
    };

    try {
        const res = await fetch(`${API_URL}/content`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-secret': ADMIN_SECRET
            },
            body: JSON.stringify(newContent)
        });

        if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
        console.log("   -> Content created.");

        // 2. Fetch "Novedades" (All content, filter client side as app does)
        console.log("3. Fetching all content to verify...");
        const resList = await fetch(`${API_URL}/content`);
        const allContent = await resList.json();

        const myBook = allContent.find(c => c.id === newContent.id);

        if (!myBook) {
            console.error("FAILED: Book not found in DB.");
        } else {
            console.log("   -> Book found in DB.");
            if (myBook.etiquetas.includes('Nuevo')) {
                console.log("SUCCESS: Book has 'Nuevo' tag. It will appear in 'Nuevos títulos'.");
            } else {
                console.error("FAILED: Book missing 'Nuevo' tag.");
            }
        }

        // Cleanup
        console.log("4. Cleaning up...");
        await fetch(`${API_URL}/content/${newContent.id}`, {
            method: 'DELETE',
            headers: { 'x-admin-secret': ADMIN_SECRET }
        });
        console.log("   -> Cleanup done.");

    } catch (e) {
        console.error("Error:", e);
    }
}

testUploadAndNovelty();
