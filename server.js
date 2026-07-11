const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuración de Socket.io
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// ===== BASE DE DATOS DE SALAS =====
const salas = {}; // { "ABC123": { jugadores: [], turno: 0, estado: {} } }

// ===== CONFIGURACIÓN DEL JUEGO =====
const CARAS = [
    { id: 0, valTrio: 100 },
    { id: 1, valTrio: 200 },
    { id: 2, valTrio: 300 },
    { id: 3, valTrio: 400 },
    { id: 4, valTrio: 500, valInd: 50 },
    { id: 5, valTrio: 1000, valInd: 100 }
];

// ===== GENERAR CÓDIGO DE SALA =====
function generarCodigoSala() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 6; i++) {
        codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return codigo;
}

// ===== CALCULAR PUNTOS DE UNA TIRADA =====
function calcularPuntosTirada(dados) {
    let conteo = [0, 0, 0, 0, 0, 0];
    dados.forEach(idx => conteo[idx]++);
    
    let puntos = 0;
    let dadosQuePuntuan = [];
    
    // Contar tríos y dados individuales
    for (let i = 0; i < 6; i++) {
        if (conteo[i] >= 3) {
            puntos += CARAS[i].valTrio;
            if (i === 4) puntos += (conteo[i] - 3) * 50; // K adicionales
            if (i === 5) puntos += (conteo[i] - 3) * 100; // Ases adicionales
            dadosQuePuntuan.push(...Array(conteo[i]).fill(i));
        } else {
            if (i === 4) { // K
                puntos += conteo[i] * 50;
                dadosQuePuntuan.push(...Array(conteo[i]).fill(i));
            }
            if (i === 5) { // As
                puntos += conteo[i] * 100;
                dadosQuePuntuan.push(...Array(conteo[i]).fill(i));
            }
        }
    }
    
    return { puntos, dadosQuePuntuan };
}

// ===== CONEXIÓN DE SOCKET =====
io.on('connection', (socket) => {
    console.log('⚡ Jugador conectado:', socket.id);

    // ===== CREAR SALA =====
    socket.on('crear-sala', (nombreJugador) => {
        let codigo;
        do {
            codigo = generarCodigoSala();
        } while (salas[codigo]);
        
        salas[codigo] = {
            jugadores: [{ id: socket.id, nombre: nombreJugador, puntos: 0 }],
            turno: 0,
            puntosTurno: 0,
            dadosActivos: 5,
            dadosReservados: [],
            estado: 'esperando', // esperando, jugando, terminado
            ganador: null
        };
        
        socket.join(codigo);
        socket.emit('sala-creada', { codigo, nombre: nombreJugador });
        console.log(`🎮 Sala ${codigo} creada por ${nombreJugador}`);
    });

    // ===== UNIRSE A SALA =====
    socket.on('unirse-sala', ({ codigo, nombre }) => {
        const sala = salas[codigo];
        
        if (!sala) {
            socket.emit('error-sala', 'Sala no encontrada');
            return;
        }
        
        if (sala.jugadores.length >= 6) {
            socket.emit('error-sala', 'Sala llena');
            return;
        }
        
        if (sala.estado !== 'esperando') {
            socket.emit('error-sala', 'La partida ya comenzó');
            return;
        }
        
        sala.jugadores.push({ id: socket.id, nombre: nombre, puntos: 0 });
        socket.join(codigo);
        
        // Notificar a todos los jugadores de la sala
        io.to(codigo).emit('jugador-unido', { 
            jugadores: sala.jugadores 
        });
        
        console.log(` ${nombre} se unió a la sala ${codigo}`);
    });

    // ===== INICIAR PARTIDA =====
    socket.on('iniciar-partida', (codigo) => {
        const sala = salas[codigo];
        
        if (!sala || sala.jugadores.length < 2) {
            socket.emit('error-sala', 'Se necesitan al menos 2 jugadores');
            return;
        }
        
        sala.estado = 'jugando';
        
        io.to(codigo).emit('partida-iniciada', {
            jugadores: sala.jugadores,
            turno: 0
        });
        
        console.log(`🎲 Partida iniciada en sala ${codigo}`);
    });

    // ===== TIRAR DADOS =====
    socket.on('tirar-dados', (codigo) => {
        const sala = salas[codigo];
        
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        // Generar dados aleatorios en el servidor (anti-trampas)
        const dados = [];
        for (let i = 0; i < sala.dadosActivos; i++) {
            dados.push(Math.floor(Math.random() * 6));
        }
        
        const resultado = calcularPuntosTirada(dados);
        
        // Verificar victoria instantánea (5 Ases)
        if (dados.length === 5 && dados.every(d => d === 5)) {
            const ganador = sala.jugadores[sala.turno];
            sala.estado = 'terminado';
            sala.ganador = ganador.nombre;
            
            io.to(codigo).emit('victoria-instantanea', {
                dados,
                ganador: ganador.nombre
            });
            
            console.log(`🏆 ¡Victoria instantánea de ${ganador.nombre} en sala ${codigo}!`);
            return;
        }
        
        // Enviar resultado al cliente
        socket.emit('resultado-tirada', {
            dados,
            puntos: resultado.puntos,
            dadosQuePuntuan: resultado.dadosQuePuntuan
        });
        
        console.log(` ${sala.jugadores[sala.turno].nombre} tiró: ${dados.join(',')} = ${resultado.puntos} pts`);
    });

    // ===== RESERVAR DADOS =====
    socket.on('reservar-dados', ({ codigo, dadosReservados, puntos }) => {
        const sala = salas[codigo];
        
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        sala.puntosTurno += puntos;
        sala.dadosReservados.push(...dadosReservados);
        sala.dadosActivos -= dadosReservados.length;
        
        // Si todos los dados puntúan, mesa limpia
        if (sala.dadosActivos === 0) {
            sala.dadosActivos = 5;
            sala.dadosReservados = [];
            
            io.to(codigo).emit('mesa-limpia', {
                puntosTurno: sala.puntosTurno,
                mensaje: '¡Mesa limpia! Tiras de nuevo'
            });
            
            console.log(`🧹 Mesa limpia en sala ${codigo}`);
            return;
        }
        
        // Si no hay más dados que puntúen, notificar
        io.to(codigo).emit('dados-reservados', {
            puntosTurno: sala.puntosTurno,
            dadosActivos: sala.dadosActivos
        });
    });

    // ===== PLANTARSE =====
    socket.on('plantarse', (codigo) => {
        const sala = salas[codigo];
        
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        const jugador = sala.jugadores[sala.turno];
        const puntosMinimos = jugador.puntos >= 4000 ? 100 : 300;
        
        // Validar que puede plantarse
        if (sala.puntosTurno < puntosMinimos) {
            socket.emit('error-plantarse', `Mínimo ${puntosMinimos} puntos`);
            return;
        }
        
        if (sala.puntosTurno % 100 !== 0) {
            socket.emit('error-plantarse', 'Debe ser múltiplo de 100');
            return;
        }
        
        if (jugador.puntos + sala.puntosTurno > 5000) {
            socket.emit('error-plantarse', 'Te pasas de 5000');
            return;
        }
        
        // Sumar puntos
        jugador.puntos += sala.puntosTurno;
        
        // Verificar victoria
        if (jugador.puntos === 5000) {
            sala.estado = 'terminado';
            sala.ganador = jugador.nombre;
            
            io.to(codigo).emit('partida-terminada', {
                ganador: jugador.nombre,
                puntosFinales: jugador.puntos
            });
            
            console.log(` ${jugador.nombre} gana la partida en sala ${codigo}!`);
            return;
        }
        
        // Cambiar turno
        io.to(codigo).emit('jugador-se-planta', {
            jugador: jugador.nombre,
            puntos: sala.puntosTurno,
            total: jugador.puntos
        });
        
        cambiarTurno(sala, codigo);
    });

    // ===== PERDER TURNO (CERO PUNTOS) =====
    socket.on('perder-turno', (codigo) => {
        const sala = salas[codigo];
        
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        io.to(codigo).emit('turno-perdido', {
            jugador: sala.jugadores[sala.turno].nombre
        });
        
        cambiarTurno(sala, codigo);
    });

    // ===== CAMBIAR TURNO =====
    function cambiarTurno(sala, codigo) {
        // Resetear estado del turno
        sala.puntosTurno = 0;
        sala.dadosActivos = 5;
        sala.dadosReservados = [];
        
        // Siguiente jugador
        sala.turno = (sala.turno + 1) % sala.jugadores.length;
        
        io.to(codigo).emit('cambiar-turno', {
            turno: sala.turno,
            jugador: sala.jugadores[sala.turno].nombre,
            jugadores: sala.jugadores
        });
        
        console.log(`🔄 Turno de ${sala.jugadores[sala.turno].nombre} en sala ${codigo}`);
    }

    // ===== DESCONECTAR =====
    socket.on('disconnect', () => {
        console.log('❌ Jugador desconectado:', socket.id);
        
        // Buscar y eliminar de todas las salas
        for (const codigo in salas) {
            const sala = salas[codigo];
            const index = sala.jugadores.findIndex(j => j.id === socket.id);
            
            if (index !== -1) {
                sala.jugadores.splice(index, 1);
                
                // Si la sala queda vacía, eliminarla
                if (sala.jugadores.length === 0) {
                    delete salas[codigo];
                    console.log(`🗑️ Sala ${codigo} eliminada`);
                } else {
                    // Notificar a los demás
                    io.to(codigo).emit('jugador-desconectado', {
                        jugadores: sala.jugadores
                    });
                }
            }
        }
    });
});

// ===== PUERTO =====
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Servidor 5.000 corriendo en puerto ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
});