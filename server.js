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

// Valores de los dados según reglas originales
const VALORES = {
    0: { nombre: '1', trio: 100, individual: 100 },  // 1 negro = 100
    1: { nombre: '2', trio: 200, individual: 0 },    // 2 rojo = 0 individual
    2: { nombre: 'J', trio: 300, individual: 0 },
    3: { nombre: 'Q', trio: 400, individual: 0 },
    4: { nombre: 'K', trio: 500, individual: 50 },   // K = 50 individual
    5: { nombre: 'As', trio: 1000, individual: 100 } // As = 100 individual
};

function generarCodigoSala() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 6; i++) codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    return codigo;
}

// Calcula puntos según reglas originales
function calcularTirada(dados) {
    const conteo = [0, 0, 0, 0, 0, 0];
    dados.forEach(v => conteo[v]++);
    
    let puntos = 0;
    const dadosPuntuados = new Array(dados.length).fill(false);
    
    // Primero: tríos
    for (let valor = 0; valor < 6; valor++) {
        if (conteo[valor] >= 3) {
            puntos += VALORES[valor].trio;
            let marcados = 0;
            for (let i = 0; i < dados.length && marcados < 3; i++) {
                if (dados[i] === valor && !dadosPuntuados[i]) {
                    dadosPuntuados[i] = true;
                    marcados++;
                }
            }
            // Dados adicionales del mismo valor (K o As)
            if (valor === 4 || valor === 5) {
                for (let i = 0; i < dados.length; i++) {
                    if (dados[i] === valor && !dadosPuntuados[i]) {
                        dadosPuntuados[i] = true;
                        puntos += VALORES[valor].individual;
                    }
                }
            }
        }
    }
    
    // Segundo: dados individuales (1, K y As) que no estén en trío
    for (let i = 0; i < dados.length; i++) {
        if (!dadosPuntuados[i] && (dados[i] === 0 || dados[i] === 4 || dados[i] === 5)) {
            dadosPuntuados[i] = true;
            puntos += VALORES[dados[i]].individual;
        }
    }
    
    return { puntos, dadosPuntuados };
}

io.on('connection', (socket) => {
    console.log('⚡ Jugador conectado:', socket.id);

    socket.on('crear-sala', (nombreJugador) => {
        let codigo;
        do { codigo = generarCodigoSala(); } while (salas[codigo]);
        
        salas[codigo] = {
            jugadores: [{ id: socket.id, nombre: nombreJugador, puntos: 0 }],
            turno: 0,
            puntosTurno: 0,
            dadosActivos: 5,
            estado: 'esperando'
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
        socket.emit('unido-a-sala', { codigo, jugadores: sala.jugadores });
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
        for (let i = 0; i < sala.dadosActivos; i++) {
            dados.push(Math.floor(Math.random() * 6));
        }
        
        const resultado = calcularTirada(dados);
        
        // Victoria instantánea: 5 Ases
        if (dados.length === 5 && dados.every(d => d === 5)) {
            sala.estado = 'terminado';
            io.to(codigo).emit('victoria-instantanea', { ganador: sala.jugadores[sala.turno].nombre });
            return;
        }
        
        // Si no puntúa nada → pierde turno
        if (resultado.puntos === 0) {
            io.to(codigo).emit('resultado-tirada', {
                dados: dados.map((v, i) => ({ valor: v, puntua: false })),
                puntosGanados: 0,
                puntosTurno: sala.puntosTurno,
                mesaLimpia: false
            });
            
            setTimeout(() => {
                io.to(codigo).emit('tirada-cero', { jugador: sala.jugadores[sala.turno].nombre });
                cambiarTurno(sala, codigo);
            }, 5000);
            return;
        }

        // Sumar puntos
        sala.puntosTurno += resultado.puntos;
        
        // Calcular dados restantes
        const dadosQueQuedan = dados.filter((v, i) => !resultado.dadosPuntuados[i]);
        sala.dadosActivos = dadosQueQuedan.length;
        
        let mesaLimpia = false;
        // Todos puntúan → tira de nuevo con 5
        if (sala.dadosActivos === 0) {
            sala.dadosActivos = 5;
            mesaLimpia = true;
        }

        const dadosConEstado = dados.map((v, i) => ({
            valor: v,
            puntua: resultado.dadosPuntuados[i]
        }));
        
        io.to(codigo).emit('resultado-tirada', {
            dados: dadosConEstado,
            puntosGanados: resultado.puntos,
            puntosTurno: sala.puntosTurno,
            mesaLimpia
        });
    });

    socket.on('plantarse', (codigo) => {
        const sala = salas[codigo];
        if (!sala || sala.estado !== 'jugando') return;
        if (sala.jugadores[sala.turno].id !== socket.id) return;
        
        const jugador = sala.jugadores[sala.turno];
        // Regla: mínimo 300, o 100 si tiene >= 4000
        const puntosMinimos = jugador.puntos >= 4000 ? 100 : 300;
        
        // Validaciones según reglas:
        // 1. Mínimo de puntos
        // 2. Debe ser número redondo (múltiplo de 100)
        // 3. No puede pasarse de 5000
        if (sala.puntosTurno < puntosMinimos) {
            return socket.emit('error-plantarse', `Mínimo ${puntosMinimos} puntos`);
        }
        if (sala.puntosTurno % 100 !== 0) {
            return socket.emit('error-plantarse', 'Debe ser número redondo (múltiplo de 100)');
        }
        if (jugador.puntos + sala.puntosTurno > 5000) {
            return socket.emit('error-plantarse', '¡Te pasas de 5000!');
        }
        if (jugador.puntos + sala.puntosTurno < 5000 && jugador.puntos >= 4000) {
            // Si tiene >= 4000, DEBE llegar a 5000 exactos
            return socket.emit('error-plantarse', 'Desde 4000 debes llegar a 5000 exactos');
        }
        
        jugador.puntos += sala.puntosTurno;
        
        // Victoria: llegar a 5000 exactos
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