/**
 * GameEngine - Capa de abstracción para juegos multijugador
 * Oculta toda la complejidad de Firebase, networking y manejo de estado
 * Proporciona una API simple para desarrollar juegos
 */

import {
  firebaseConfig,
  generateRoomCode,
  generateUUID,
  shortId,
  VALIDATION,
  ERROR_MESSAGES
} from './config.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  getDocs,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/**
 * Eventos que el GameEngine puede emitir
 */
const GAME_EVENTS = {
  // Eventos de conexión
  PLAYER_AUTHENTICATED: 'player_authenticated',
  CONNECTION_ERROR: 'connection_error',
  
  // Eventos de sala
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  ROOM_LEFT: 'room_left',
  ROOM_CLOSED: 'room_closed',
  
  // Eventos de jugadores
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_KICKED: 'player_kicked',
  
  // Eventos de juego
  GAME_STARTED: 'game_started',
  GAME_ENDED: 'game_ended',
  TURN_CHANGED: 'turn_changed',
  
  // Eventos personalizados
  CUSTOM_ACTION: 'custom_action',
  GAME_STATE_UPDATED: 'game_state_updated'
};

/**
 * Clase principal del GameEngine
 */
class GameEngine {
  constructor() {
    this.player = {
      uid: null,
      authUid: null,
      name: null,
      team: null,
      isOwner: false
    };
    
    this.room = {
      id: null,
      code: null,
      status: 'lobby', // lobby, playing, ended
      players: [],
      teams: { A: [], B: [] },
      owner: null,
      gameData: {}
    };
    
    this.eventListeners = new Map();
    this.unsubscribers = [];
    this.heartbeatInterval = null;
    this.isInitialized = false;
  }

  // ==================== INICIALIZACIÓN ====================
  
  /**
   * Inicializar el GameEngine
   * @param {Object} config - Configuración opcional
   * @returns {Promise<void>}
   */
  async initialize(config = {}) {
    if (this.isInitialized) return;
    
    try {
      await this.authenticatePlayer();
      this.isInitialized = true;
      this.emit(GAME_EVENTS.PLAYER_AUTHENTICATED, this.player);
    } catch (error) {
      this.emit(GAME_EVENTS.CONNECTION_ERROR, error);
      throw error;
    }
  }

  /**
   * Autenticar jugador anónimamente
   * @private
   */
  async authenticatePlayer() {
    return new Promise((resolve, reject) => {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.player.authUid = user.uid;
          this.player.uid = crypto.randomUUID ? crypto.randomUUID() : generateUUID();
      
          resolve();
        } else {
          try {
      
            await signInAnonymously(auth);
          } catch (error) {
            console.error('🔍 DEBUG authenticatePlayer - Error:', error);
            reject(error);
          }
        }
      });
    });
  }

  // ==================== API PÚBLICA SIMPLE ====================
  
  /**
   * Crear una nueva sala de juego
   * @param {string} playerName - Nombre del jugador
   * @param {string} team - Equipo preferido ('A' o 'B')
   * @param {Object} gameConfig - Configuración específica del juego
   * @returns {Promise<string>} - Código de la sala
   */
  async createGame(playerName, team = 'A', gameConfig = {}) {
    if (!this.isInitialized) throw new Error('GameEngine no inicializado');
    if (!playerName?.trim()) throw new Error('Nombre de jugador requerido');
    if (this.room.id) throw new Error('Ya estás en una sala');
    
    try {
      this.player.name = playerName.trim();
      this.player.team = team;
      this.player.isOwner = true;
      
      const roomCode = generateRoomCode();
      const roomId = generateUUID();
      
      // Crear sala en Firebase
      const roomData = {
        code: roomCode,
        owner: this.player.uid,
        status: 'lobby',
        teams: { A: [], B: [] },
        createdAt: serverTimestamp(),
        gameConfig: gameConfig
      };
      
      // Agregar jugador al equipo
      roomData.teams[team] = [{
        id: this.player.uid,
        name: this.player.name,
        joinedAt: new Date()
      }];
      
      await setDoc(doc(db, 'rooms', roomId), roomData);
      await setDoc(doc(db, 'codes', roomCode), { roomId });
      
      this.room.id = roomId;
      this.room.code = roomCode;
      this.room.owner = this.player.uid;
      this.joinTimestamp = Date.now(); // Marcar tiempo de creación
      
      this.subscribeToRoom();
      this.startHeartbeat();
      
      this.emit(GAME_EVENTS.ROOM_CREATED, {
        code: roomCode,
        roomId: roomId,
        player: this.player
      });
      
      return roomCode;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }
  
  /**
   * Unirse a una sala existente
   * @param {string} roomCode - Código de la sala
   * @param {string} playerName - Nombre del jugador
   * @param {string} team - Equipo preferido ('A' o 'B')
   * @returns {Promise<void>}
   */
  async joinGame(roomCode, playerName, team = 'A') {
    if (!this.isInitialized) throw new Error('GameEngine no inicializado');
    if (!roomCode?.trim()) throw new Error('Código de sala requerido');
    if (!playerName?.trim()) throw new Error('Nombre de jugador requerido');
    if (this.room.id) throw new Error('Ya estás en una sala');
    

    if (!this.player.uid) {
      throw new Error('Player UID no inicializado. Verifica la autenticación.');
    }
    
    try {
      this.player.name = playerName.trim();
      this.player.team = team;
      
      // Buscar sala por código
      const codeDoc = await getDoc(doc(db, 'codes', roomCode.toUpperCase()));
      if (!codeDoc.exists()) {
        throw new Error('Sala no encontrada');
      }
      
      const roomId = codeDoc.data().roomId;
      
      if (!roomId) {
        throw new Error('ID de sala no válido');
      }
      
      const roomDoc = await getDoc(doc(db, 'rooms', roomId));
      
      if (!roomDoc.exists()) {
        throw new Error('La sala no existe');
      }
      
      const roomData = roomDoc.data();
      
      // Agregar jugador al equipo
      const newPlayer = {
        id: this.player.uid,
        name: this.player.name,
        joinedAt: new Date()
      };
      
      await runTransaction(db, async (transaction) => {
        const roomRef = doc(db, 'rooms', roomId);
        const currentRoom = await transaction.get(roomRef);
        
        if (!currentRoom.exists()) {
          throw new Error('La sala no existe');
        }
        
        const currentData = currentRoom.data();
        const updatedTeams = { ...currentData.teams };
        
        if (updatedTeams[team].length >= 2) {
          const teamACount = updatedTeams.A.length;
          const teamBCount = updatedTeams.B.length;
          
          if (teamACount >= 2 && teamBCount >= 2) {
            throw new Error('Ambos equipos están llenos. No puedes unirte a esta sala.');
          } else if (team === 'A') {
            throw new Error(`El Equipo A está lleno (${teamACount}/2). Prueba unirte al Equipo B (${teamBCount}/2).`);
          } else {
            throw new Error(`El Equipo B está lleno (${teamBCount}/2). Prueba unirte al Equipo A (${teamACount}/2).`);
          }
        }
        
        // Verificar si el jugador ya está en algún equipo
        const playerInA = updatedTeams.A.some(p => p.id === this.player.uid);
        const playerInB = updatedTeams.B.some(p => p.id === this.player.uid);
        
        if (playerInA || playerInB) {
          return; // Ya está en un equipo, no hacer nada
        }
        
        updatedTeams[team].push(newPlayer);

        transaction.update(roomRef, { teams: updatedTeams });
      });
      
      
      
      this.room.id = roomId;
      this.room.code = roomCode.toUpperCase();
      this.room.owner = roomData.owner;
      this.joinTimestamp = Date.now(); // Marcar tiempo de unión
      
      this.subscribeToRoom();
      this.startHeartbeat();
      
      this.emit(GAME_EVENTS.ROOM_JOINED, {
        code: roomCode,
        roomId: roomId,
        player: this.player
      });
      
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }
  
  /**
   * Salir de la sala actual
   * @returns {Promise<void>}
   */
  async leaveGame() {
    if (!this.room.id) return;
    
    try {
      this.stopHeartbeat();
      
      if (this.player.isOwner) {
        // Si es owner, eliminar toda la sala
        await this.deleteRoom();
        this.emit(GAME_EVENTS.ROOM_CLOSED, { reason: 'owner_left' });
      } else {
        // Solo remover al jugador
        await this.removePlayerFromRoom();
      }
      
      this.emit(GAME_EVENTS.ROOM_LEFT, { player: this.player });
    } catch (error) {
      console.error('Error al salir de la sala:', error);
    } finally {
      this.cleanup();
    }
  }
  
  /**
   * Expulsar jugador de la sala (solo owner)
   * @param {string} playerId - ID del jugador a expulsar
   * @returns {Promise<void>}
   */
  async kickPlayer(playerId) {
    if (!this.room.id) {
      throw new Error('No estás en una sala');
    }
    
    if (!this.player.isOwner) {
      throw new Error('Solo el creador de la sala puede expulsar jugadores');
    }
    
    try {
      const roomRef = doc(db, 'rooms', this.room.id);
      const roomSnap = await getDoc(roomRef);
      
      if (!roomSnap.exists()) {
        throw new Error('La sala no existe');
      }
      
      const roomData = roomSnap.data();
      const teams = { ...roomData.teams };
      let playerRemoved = false;
      
      // Remover jugador de ambos equipos
      ['A', 'B'].forEach(team => {
        teams[team] = teams[team].filter(player => {
          if (player.id === playerId) {
            playerRemoved = true;
            return false;
          }
          return true;
        });
      });
      
      if (!playerRemoved) {
        throw new Error('El jugador no está en la sala');
      }
      
      // Actualizar equipos en la sala
      await updateDoc(roomRef, { teams });
      
      // Marcar jugador como expulsado
      try {
        await updateDoc(doc(db, 'rooms', this.room.id, 'players', playerId), {
          connected: false,
          kicked: true,
          kickedAt: serverTimestamp()
        });
      } catch (playerDocError) {
        // Ignorar si no existe el documento del jugador
        console.log('Documento del jugador no encontrado al expulsar (normal en algunos casos):', playerDocError.message);
      }
      
      this.emit(GAME_EVENTS.PLAYER_KICKED, { playerId });
      
    } catch (error) {
      console.error('Error expulsando jugador:', error);
      throw error;
    }
  }
  
  /**
   * Iniciar el juego (solo owner)
   * @param {Object} gameData - Datos iniciales del juego
   * @returns {Promise<void>}
   */
  async startGame(gameData = {}) {
    if (!this.player.isOwner) {
      throw new Error('Solo el owner puede iniciar el juego');
    }
    
    if (!this.room.id) {
      throw new Error('No estás en una sala');
    }
    
    try {

      
      const updateData = {
        status: 'playing',
        gameData: gameData,
        startedAt: serverTimestamp()
      };
      

      
      await updateDoc(doc(db, 'rooms', this.room.id), updateData);
      
      this.emit(GAME_EVENTS.GAME_STARTED, gameData);
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Enviar acción personalizada del juego
   * @param {string} action - Tipo de acción
   * @param {Object} data - Datos de la acción
   * @returns {Promise<void>}
   */
  async sendGameAction(action, data = {}) {
    if (!this.room.id) {
      throw new Error('No estás en una sala');
    }
    
    try {
      const actionData = {
        action,
        data,
        playerId: this.player.uid,
        timestamp: serverTimestamp()
      };
      
      await updateDoc(doc(db, 'rooms', this.room.id), {
        [`gameData.lastAction`]: actionData
      });
      
      this.emit(GAME_EVENTS.CUSTOM_ACTION, actionData);
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Actualizar datos del juego
   * @param {Object} gameData - Nuevos datos del juego
   * @returns {Promise<void>}
   */
  async updateGameData(gameData) {
    if (!this.room.id) {
      throw new Error('No estás en una sala');
    }
    
    try {
      await updateDoc(doc(db, 'rooms', this.room.id), {
        gameData: { ...this.room.gameData, ...gameData }
      });
    } catch (error) {
      throw error;
    }
  }

  // ==================== SISTEMA DE EVENTOS ====================
  
  /**
   * Suscribirse a un evento
   * @param {string} event - Nombre del evento
   * @param {Function} callback - Función callback
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }
  
  /**
   * Desuscribirse de un evento
   * @param {string} event - Nombre del evento
   * @param {Function} callback - Función callback
   */
  off(event, callback) {
    if (!this.eventListeners.has(event)) return;
    
    const listeners = this.eventListeners.get(event);
    const index = listeners.indexOf(callback);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }
  
  /**
   * Emitir un evento
   * @param {string} event - Nombre del evento
   * @param {*} data - Datos del evento
   * @private
   */
  emit(event, data) {
    if (!this.eventListeners.has(event)) return;
    
    this.eventListeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error en listener de evento ${event}:`, error);
      }
    });
  }

  // ==================== MÉTODOS PRIVADOS ====================
  
  /**
   * Suscribirse a cambios de la sala
   * @private
   */
  subscribeToRoom() {
    if (!this.room.id) return;
    

    
    const unsubscribe = onSnapshot(
      doc(db, 'rooms', this.room.id),
      (snap) => {
  
        
        if (!snap.exists()) {
          this.emit(GAME_EVENTS.ROOM_CLOSED, { reason: 'deleted' });
          this.cleanup();
          return;
        }
        
        const roomData = snap.data();
  
        this.room = { ...this.room, ...roomData };
        
        // Verificar si el jugador fue expulsado
        const allPlayers = [...roomData.teams.A, ...roomData.teams.B];
  
        const playerExists = allPlayers.some(p => p.id === this.player.uid);
  
        
        // Solo expulsar si el jugador definitivamente no existe Y no es el owner
        // Esto evita expulsiones por condiciones de carrera durante el join
        if (!playerExists && this.room.id && this.player.uid !== roomData.owner) {
          // Dar una oportunidad adicional - podría ser una condición de carrera
  
          
          // Si acabamos de unirse (menos de 5 segundos), no expulsar aún
          const now = Date.now();
          const joinTime = this.joinTimestamp || 0;
          const timeSinceJoin = now - joinTime;
          
          if (timeSinceJoin < 5000) {
  
            return;
          }
          

          this.emit(GAME_EVENTS.PLAYER_KICKED, { player: this.player });
          this.cleanup();
          return;
        }
        
  
        this.emit(GAME_EVENTS.GAME_STATE_UPDATED, roomData);
      },
      (error) => {
        console.error('Error en listener de sala:', error);
        this.emit(GAME_EVENTS.CONNECTION_ERROR, error);
      }
    );
    
    this.unsubscribers.push(unsubscribe);
  }
  
  /**
   * Iniciar heartbeat
   * @private
   */
  startHeartbeat() {
    if (this.heartbeatInterval) return;
    
    this.heartbeatInterval = setInterval(async () => {
      if (!this.room.id || !this.player.uid) return;
      
      try {
        await setDoc(
          doc(db, 'rooms', this.room.id, 'players', this.player.uid),
          {
            name: this.player.name,
            lastSeen: serverTimestamp(),
            connected: true
          },
          { merge: true }
        );
      } catch (error) {
        console.error('Error en heartbeat:', error);
      }
    }, 30000); // 30 segundos
  }
  
  /**
   * Detener heartbeat
   * @private
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  /**
   * Eliminar sala completa
   * @private
   */
  async deleteRoom() {
    if (!this.room.id) return;
    
    try {
      // Eliminar código
      if (this.room.code) {
        await deleteDoc(doc(db, 'codes', this.room.code));
      }
      
      // Eliminar jugadores
      const playersRef = collection(db, 'rooms', this.room.id, 'players');
      const playersSnapshot = await getDocs(playersRef);
      const deletePromises = playersSnapshot.docs.map(playerDoc => 
        deleteDoc(playerDoc.ref)
      );
      await Promise.all(deletePromises);
      
      // Eliminar sala
      await deleteDoc(doc(db, 'rooms', this.room.id));
    } catch (error) {
      console.error('Error eliminando sala:', error);
    }
  }
  
  /**
   * Remover jugador de la sala
   * @private
   */
  async removePlayerFromRoom() {
    if (!this.room.id) return;
    
    try {
      const roomRef = doc(db, 'rooms', this.room.id);
      const roomSnap = await getDoc(roomRef);
      
      if (roomSnap.exists()) {
        const roomData = roomSnap.data();
        const teams = { ...roomData.teams };
        
        // Remover de ambos equipos
        ['A', 'B'].forEach(team => {
          teams[team] = teams[team].filter(player => player.id !== this.player.uid);
        });
        
        await updateDoc(roomRef, { teams });
      }
      
      // Intentar marcar como desconectado (puede fallar si el documento no existe)
      try {
        await updateDoc(
          doc(db, 'rooms', this.room.id, 'players', this.player.uid),
          {
            connected: false,
            leftAt: serverTimestamp()
          }
        );
      } catch (playerDocError) {
        // Ignorar error si el documento del jugador no existe
        // Esto es normal cuando el jugador nunca se registró completamente
        console.log('Documento del jugador no encontrado (normal en algunos casos):', playerDocError.message);
      }
    } catch (error) {
      console.error('Error removiendo jugador:', error);
    }
  }
  
  /**
   * Limpiar estado
   * @private
   */
  cleanup() {
    // Detener heartbeat
    this.stopHeartbeat();
    
    // Cancelar suscripciones
    this.unsubscribers.forEach(unsubscribe => {
      try {
        unsubscribe();
      } catch (error) {
        console.error('Error cancelando suscripción:', error);
      }
    });
    this.unsubscribers = [];
    
    // Limpiar estado
    this.room = {
      id: null,
      code: null,
      status: 'lobby',
      players: [],
      teams: { A: [], B: [] },
      owner: null,
      gameData: {}
    };
    
    this.player.team = null;
    this.player.isOwner = false;
  }
  
  // ==================== GETTERS ====================
  
  /**
   * Obtener información del jugador actual
   */
  get currentPlayer() {
    return { ...this.player };
  }
  
  /**
   * Obtener información de la sala actual
   */
  get currentRoom() {
    return { ...this.room };
  }
  
  /**
   * Verificar si está en una sala
   */
  get isInRoom() {
    return !!this.room.id;
  }
  
  /**
   * Verificar si es el owner
   */
  get isOwner() {
    return this.player.isOwner;
  }
}

// Exportar la clase y los eventos
export { GameEngine, GAME_EVENTS };
export default GameEngine;