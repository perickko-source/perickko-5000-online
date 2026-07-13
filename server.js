const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

const salas = {};

function generarCodigoSala() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 6; i++) codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    return codigo;
}

io.on('connection', (socket) => {
    console.log('⚡ Jugador conectado:', socket.id);

    // CREAR SALA
    socket.on('crear-sala', (nombreJugador) => {
        let codigo;
        do { codigo = generarCodigoSala(); } while (salas[codigo]);
        
        salas[codigo] = {
            jugadores: [{ id: socket.id, nombre: nombreJugador, puntos: 0 }],
            turno: 0,
            estado: 'esperando'
        };
        
        socket.join(codigo);
        socket.emit('sala-creada', { codigo, nombre: nombreJugador });
    });

    // UNIRSE A SALA
    socket.on('unirse-sala', ({ codigo, nombre }) => {
        const sala = salas[codigo];
        if (!sala) return socket.emit('error-sala', 'Sala no encontrada');
        if (sala.jugadores.length >= 6) return socket.emit('error-sala', 'Sala llena');
        if (sala.estado !== 'esperando') return socket.emit('error-sala', 'La partida ya comenzó');
        
        sala.jugadores.push({ id: socket.id, nombre: nombre, puntos: 0 });
        socket.join(codigo);
        
        io.to(codigo).emit('jugador-unido', { jugadores: sala.jugadores });
        socket.emit('unido-a-sala', { codigo, jugadores: sala.jugadores });
    });

    // INICIAR PARTIDA
    socket.on('iniciar-partida', (codigo) => {
        const sala = salas[codigo];
        if (!sala || sala.jugadores.length < 2) return socket.emit('error-sala', 'Se necesitan al menos 2 jugadores');
        
        sala.estado = 'jugando';
        io.to(codigo).emit('partida-iniciada', { jugadores: sala.jugadores, turno: 0 });
    });

    // TIRAR DADOS - El servidor genera los dados
    socket.on('tirar-dados', ({ codigo, dadosActivos }) => {
        const sala = salas[codigo];
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        // Generar dados en el servidor (anti-trampas)
        const dados = [];
        for (let i = 0; i < dadosActivos; i++) {
            dados.push(Math.floor(Math.random() * 6));
        }
        
        // Enviar a TODA la sala
        io.to(codigo).emit('dados-tirados', {
            dados,
            jugador: sala.jugadores[sala.turno].nombre
        });
    });

    // PLANTARSE - El servidor valida y suma puntos
    socket.on('plantarse', ({ codigo, puntosTurno }) => {
        const sala = salas[codigo];
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        const jugador = sala.jugadores[sala.turno];
        const puntosMinimos = jugador.puntos >= 4000 ? 100 : 300;
        
        // Validaciones
        if (puntosTurno < puntosMinimos) {
            return socket.emit('error-plantarse', `Mínimo ${puntosMinimos} puntos`);
        }
        if (puntosTurno % 100 !== 0) {
            return socket.emit('error-plantarse', 'Debe ser número redondo');
        }
        if (jugador.puntos + puntosTurno > 5000) {
            return socket.emit('error-plantarse', '¡Te pasas de 5000!');
        }
        
        // Sumar puntos
        jugador.puntos += puntosTurno;
        
        // Victoria
        if (jugador.puntos === 5000) {
            sala.estado = 'terminado';
            io.to(codigo).emit('partida-terminada', { ganador: jugador.nombre });
            return;
        }
        
        // Cambiar turno
        io.to(codigo).emit('jugador-se-planta', { 
            jugador: jugador.nombre, 
            puntos: puntosTurno, 
            total: jugador.puntos 
        });
        
        cambiarTurno(sala, codigo);
    });

    // PERDER TURNO (cero puntos)
    socket.on('perder-turno', (codigo) => {
        const sala = salas[codigo];
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        io.to(codigo).emit('turno-perdido', { jugador: sala.jugadores[sala.turno].nombre });
        cambiarTurno(sala, codigo);
    });

    // CAMBIAR TURNO
    function cambiarTurno(sala, codigo) {
        sala.turno = (sala.turno + 1) % sala.jugadores.length;
        
        io.to(codigo).emit('cambiar-turno', {
            turno: sala.turno,
            jugador: sala.jugadores[sala.turno].nombre,
            jugadores: sala.jugadores
        });
    }

    // DESCONECTAR
    socket.on('disconnect', () => {
        for (const codigo in salas) {
            const index = salas[codigo].jugadores.findIndex(j => j.id === socket.id);
            if (index !== -1) {
                salas[codigo].jugadores.splice(index, 1);
                if (salas[codigo].jugadores.length === 0) delete salas[codigo];
                else io.to(codigo).emit('jugador-desconectado', { jugadores: salas[codigo].jugadores });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor 5.000 corriendo en puerto ${PORT}`));