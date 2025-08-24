// config.js - Configuración de Firebase y constantes del juego

// Configuración de Firebase
export const firebaseConfig = {
  apiKey: "AIzaSyAObprEB5YMokjY_t7rq15Pfp-6uZO_m5Q",
  authDomain: "cardgame-193cc.firebaseapp.com",
  projectId: "cardgame-193cc",
  storageBucket: "cardgame-193cc.firebasestorage.app",
  messagingSenderId: "641544792494",
  appId: "1:641544792494:web:4a95331677d2cb1731c03f",
  measurementId: "G-PDD6M6QDXB"
};

// Biblioteca de cartas del juego
export const CARD_LIBRARY = {
  ATK1: { 
    name: 'Ataque +1', 
    desc: 'Hace 1 de daño a un rival.',
    type: 'attack',
    damage: 1
  },
  ATK2: { 
    name: 'Ataque +2', 
    desc: 'Hace 2 de daño a un rival.',
    type: 'attack',
    damage: 2
  },
  HEAL1: { 
    name: 'Curar +1', 
    desc: 'Cura 1 a un aliado.',
    type: 'heal',
    healing: 1
  },
  SHLD1: { 
    name: 'Escudo', 
    desc: 'Evita 1 daño en el próximo golpe.',
    type: 'defense',
    shield: 1
  },
  FIREBALL: {
    name: 'Bola de Fuego',
    desc: 'Hace 3 de daño a un rival.',
    type: 'attack',
    damage: 3
  },
  MASS_HEAL: {
    name: 'Curación Masiva',
    desc: 'Cura 2 a tu equipo.',
    type: 'heal',
    healing: 2
  }
};

// Configuración del juego
export const GAME_CONFIG = {
  MAX_PLAYERS: 4,
  MAX_PLAYERS_PER_TEAM: 2,
  STARTING_HP: 20,
  INITIAL_HAND_SIZE: 3,
  MAX_HP: 30,
  TURN_TIME_LIMIT: 60000, // 60 segundos por turno
  HEARTBEAT_INTERVAL: 5000, // 5 segundos
  
  // Estados del juego
  GAME_STATES: {
    LOBBY: 'lobby',
    ACTIVE: 'active',
    FINISHED: 'finished'
  },

  // Tipos de equipo
  TEAMS: {
    A: 'A',
    B: 'B'
  },

  // Tipos de cartas
  CARD_TYPES: {
    ATTACK: 'attack',
    HEAL: 'heal',
    DEFENSE: 'defense',
    SPECIAL: 'special'
  }
};

// Utilidad para generar UUID
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Utilidad para crear baraja
export function createDeck(seed = 42) {
  const baseCards = [
    'ATK1', 'ATK1', 'ATK1', 'ATK1',  // 4x Ataque básico
    'ATK2', 'ATK2', 'ATK2',          // 3x Ataque medio
    'HEAL1', 'HEAL1', 'HEAL1',       // 3x Curación básica
    'SHLD1', 'SHLD1',                // 2x Escudo
    'FIREBALL',                      // 1x Bola de fuego
    'MASS_HEAL'                      // 1x Curación masiva
  ];
  
  // Fisher-Yates shuffle con seed para reproducibilidad
  let randomSeed = seed;
  const deck = baseCards.slice();
  
  for (let i = deck.length - 1; i > 0; i--) {
    randomSeed = (randomSeed * 48271) % 0x7fffffff;
    const j = randomSeed % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  return deck;
}

// Utilidad para generar código de sala
export function generateRoomCode() {
  return Math.floor(Math.random() * 899999 + 100000).toString();
}

// Utilidad para acortar IDs para mostrar
export function shortId(id) {
  return id?.slice(0, 6) + '…';
}

// Validaciones
export const VALIDATION = {
  isValidRoomCode: (code) => /^\d{6}$/.test(code),
  isValidPlayerName: (name) => name && name.trim().length >= 2 && name.trim().length <= 20,
  isValidTeam: (team) => team === GAME_CONFIG.TEAMS.A || team === GAME_CONFIG.TEAMS.B
};

// Mensajes de error
export const ERROR_MESSAGES = {
  INVALID_ROOM_CODE: 'El código de sala debe tener 6 dígitos',
  ROOM_NOT_FOUND: 'Sala no encontrada',
  ROOM_FULL: 'La sala está llena',
  TEAM_FULL: 'El equipo está lleno',
  INVALID_PLAYER_NAME: 'El nombre debe tener entre 2 y 20 caracteres',
  NOT_YOUR_TURN: 'No es tu turno',
  INVALID_CARD: 'Carta no válida',
  GAME_ALREADY_STARTED: 'La partida ya ha comenzado',
  INSUFFICIENT_PLAYERS: 'Se requieren 4 jugadores para comenzar',
  NOT_ROOM_OWNER: 'Solo el anfitrión puede realizar esta acción',
  CONNECTION_ERROR: 'Error de conexión. Inténtalo de nuevo.',
  ALREADY_IN_ROOM: 'Ya estás en una sala. Sal de la sala actual antes de crear o unirte a otra.'
};