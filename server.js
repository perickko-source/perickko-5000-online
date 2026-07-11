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

const CARAS = [
    { id: 0, valTrio: 100 },
    { id: 1, valTrio: 200 },
    { id: 2, valTrio: 300 },
    { id: 3, valTrio: 400 },
    { id: 4, valTrio: 500, valInd: 50 },
    { id: 5, valTrio: 1000, valInd: 100 }
];

function generarCodigoSala() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 6; i++) codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    return codigo;
}

function calcularPuntosTirada(dados) {
    let conteo = [0, 0, 0, 0, 0, 0];
    dados.forEach(idx => conteo[idx]++);
    
    let puntos = 0;
    let dadosQuePuntuan = [];
    
    for (let i = 0; i < 6; i++) {
        if (conteo[i] >= 3) {
            puntos += CARAS[i].valTrio;
            if (i === 4) puntos += (conteo[i] - 3) * 50;
            if (i === 5) puntos += (conteo[i] - 3) * 100;
            dadosQuePuntuan.push(...Array(conteo[i]).fill(i));
        } else {
            if (i === 4) { puntos += conteo[i] * 50; dadosQuePuntuan.push(...Array(conteo[i]).fill(i)); }
            if (i === 5) { puntos += conteo[i] * 100; dadosQuePuntuan.push(...Array(conteo[i]).fill(i)); }
        }
    }
    return { puntos, dadosQuePuntuan };
}

io.on('connection', (socket) => {
    console.log('⚡ Jugador conectado:', socket.id);

    socket.on('crear-sala', (nombreJugador) => {
        let codigo;
        do { codigo = generarCodigoSala(); } while (salas[codigo]);
        
        salas[codigo] = {
            jugadores: [{ id: socket.id, nombre: nombreJugador, puntos: 0 }],
            turno: 0, puntosTurno: 0, dadosActivos: 5,
            estado: 'esperando', ganador: null
        };
        
        socket.join(codigo);
        socket.emit('sala-creada', { codigo, nombre: nombreJugador });
    });

    socket.on('unirse-sala', ({ codigo, nombre }) => {
        const sala = salas[codigo];
        if (!sala) return socket.emit('error-sala', 'Sala no encontrada');
        if (sala.jugadores.length >= 6) return socket.emit('error-sala', 'Sala llena');
        if (sala.estado !== 'esperando') return socket.emit('error-sala', 'La partida ya comenzó');
        
        sala.jugadores.push({ id: socket.id, nombre: nombre, puntos: 0 });
        socket.join(codigo);
        
        io.to(codigo).emit('jugador-unido', { jugadores: sala.jugadores });
        socket.emit('unido-a-sala', { codigo: codigo, jugadores: sala.jugadores });
    });

    socket.on('iniciar-partida', (codigo) => {
        const sala = salas[codigo];
        if (!sala || sala.jugadores.length < 2) return socket.emit('error-sala', 'Se necesitan al menos 2 jugadores');
        
        sala.estado = 'jugando';
        io.to(codigo).emit('partida-iniciada', { jugadores: sala.jugadores, turno: 0 });
    });

    socket.on('tirar-dados', (codigo) => {
        const sala = salas[codigo];
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        const dados = [];
        for (let i = 0; i < sala.dadosActivos; i++) dados.push(Math.floor(Math.random() * 6));
        
        const resultado = calcularPuntosTirada(dados);
        
        if (dados.length === 5 && dados.every(d => d === 5)) {
            sala.estado = 'terminado';
            io.to(codigo).emit('victoria-instantanea', { ganador: sala.jugadores[sala.turno].nombre });
            return;
        }
        
        // Si saca 0 puntos, enviamos los dados primero para que se vean, y luego cambiamos el turno
        if (resultado.puntos === 0) {
            io.to(codigo).emit('resultado-tirada', {
                dados,
                puntos: 0,
                dadosQuePuntuan: [],
                puntosTurno: sala.puntosTurno,
                dadosActivos: sala.dadosActivos,
                mesaLimpia: false
            });
            
            // Esperamos 5 segundos (5000 ms) para que se vean los dados antes de cambiar turno
            setTimeout(() => {
                io.to(codigo).emit('tirada-cero', { jugador: sala.jugadores[sala.turno].nombre });
                cambiarTurno(sala, codigo);
            }, 5000); 
            return;
        }

        sala.puntosTurno += resultado.puntos;
        sala.dadosActivos -= resultado.dadosQuePuntuan.length;
        
        let mesaLimpia = false;
        if (sala.dadosActivos <= 0) {
            sala.dadosActivos = 5;
            mesaLimpia = true;
        }

        io.to(codigo).emit('resultado-tirada', {
            dados,
            puntos: resultado.puntos,
            dadosQuePuntuan: resultado.dadosQuePuntuan,
            puntosTurno: sala.puntosTurno,
            dadosActivos: sala.dadosActivos,
            mesaLimpia
        });
    });

    socket.on('plantarse', (codigo) => {
        const sala = salas[codigo];
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        const jugador = sala.jugadores[sala.turno];
        const puntosMinimos = jugador.puntos >= 4000 ? 100 : 300;
        
        if (sala.puntosTurno < puntosMinimos || sala.puntosTurno % 100 !== 0 || jugador.puntos + sala.puntosTurno > 5000) {
            return socket.emit('error-plantarse', 'No puedes plantarte ahora');
        }
        
        jugador.puntos += sala.puntosTurno;
        
        if (jugador.puntos === 5000) {
            sala.estado = 'terminado';
            io.to(codigo).emit('partida-terminada', { ganador: jugador.nombre });
            return;
        }
        
        io.to(codigo).emit('jugador-se-planta', { jugador: jugador.nombre, puntos: sala.puntosTurno, total: jugador.puntos });
        cambiarTurno(sala, codigo);
    });

    function cambiarTurno(sala, codigo) {
        sala.puntosTurno = 0;
        sala.dadosActivos = 5;
        sala.turno = (sala.turno + 1) % sala.jugadores.length;
        
        io.to(codigo).emit('cambiar-turno', {
            turno: sala.turno,
            jugador: sala.jugadores[sala.turno].nombre,
            jugadores: sala.jugadores
        });
    }

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