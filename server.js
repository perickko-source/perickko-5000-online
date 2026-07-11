const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuración de Socket.io para aceptar conexiones desde cualquier sitio
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Carpeta para los archivos estáticos (aquí pondremos el HTML luego)
app.use(express.static(path.join(__dirname, 'public')));

// Cuando alguien se conecta al servidor
io.on('connection', (socket) => {
    console.log('⚡ Un jugador se ha conectado:', socket.id);

    // Cuando se desconecta
    socket.on('disconnect', () => {
        console.log('❌ Un jugador se ha desconectado:', socket.id);
    });
});

// El puerto lo asigna Render automáticamente, si no, usamos el 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
