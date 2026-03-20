module.exports = {
    apps: [{
        name: "chibalete-app",
        script: "./server/server.js",
        env: {
            NODE_ENV: "production",
            PORT: 3000, // Or whatever port you want to use
            // ADMIN_SECRET: "your-secret-here" // Better to set this in the VPS env, not here
        }
    }]
}
