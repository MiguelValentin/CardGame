/**
 * Card Game Adapter - Conecta el GameEngine con la lógica específica del juego de cartas
 * Actúa como puente entre la capa de networking y la lógica de juego
 */

import { GameEngine, GAME_EVENTS } from './game-engine.js';
import { CardGameLogic, CARD_GAME_EVENTS } from './card-game-logic.js';
import { GAME_CONFIG } from './config.js';

/**
 * Adaptador que integra GameEngine con CardGameLogic
 */
class CardGameAdapter {
  constructor() {
    this.gameEngine = new GameEngine();
    this.cardGame = new CardGameLogic();
    this.isInitialized = false;
    this.players = new Map(); // uid -> player info
    this.eventListeners = new Map(); // event -> Set of callbacks
    
    this.setupEventBridge();
  }

  // ==================== INICIALIZACIÓN ====================
  
  /**
   * Inicializar el adaptador
   * @param {Object} config - Configuración opcional
   */
  async initialize(config = {}) {
    if (this.isInitialized) return;
    
    try {
      await this.gameEngine.initialize(config);
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Error inicializando adaptador: ${error.message}`);
    }
  }

  // ==================== API PÚBLICA SIMPLIFICADA ====================
  
  /**
   * Crear una nueva partida
   * @param {string} playerName - Nombre del jugador
   * @param {string} team - Equipo preferido ('A' o 'B')
   * @returns {Promise<string>} - Código de la sala
   */
  async createGame(playerName, team = 'A') {
    if (!this.isInitialized) {
      throw new Error('Adaptador no inicializado');
    }
    
    try {
      const roomCode = await this.gameEngine.createGame(playerName, team, {
        gameType: 'card_game',
        maxPlayers: GAME_CONFIG.MAX_PLAYERS,
        maxPlayersPerTeam: GAME_CONFIG.MAX_PLAYERS_PER_TEAM
      });
      
      // Registrar jugador
      this.players.set(this.gameEngine.currentPlayer.uid, {
        uid: this.gameEngine.currentPlayer.uid,
        name: playerName,
        team: team,
        isOwner: true
      });
      
      return roomCode;
    } catch (error) {
      throw new Error(`Error creando partida: ${error.message}`);
    }
  }
  
  /**
   * Unirse a una partida existente
   * @param {string} roomCode - Código de la sala
   * @param {string} playerName - Nombre del jugador
   * @param {string} team - Equipo preferido ('A' o 'B')
   */
  async joinGame(roomCode, playerName, team = 'A') {
    if (!this.isInitialized) {
      throw new Error('Adaptador no inicializado');
    }
    
    try {
      await this.gameEngine.joinGame(roomCode, playerName, team);
      
      // El jugador se registrará automáticamente cuando se reciba el evento ROOM_JOINED
      // o cuando se actualice la sala con GAME_STATE_UPDATED
    } catch (error) {
      throw new Error(`Error uniéndose a partida: ${error.message}`);
    }
  }
  
  /**
   * Salir de la partida actual
   */
  async leaveGame() {
    try {
      await this.gameEngine.leaveGame();
      
      // Limpiar estado local
      this.players.clear();
      this.cardGame = new CardGameLogic();
      this.setupCardGameEvents();
    } catch (error) {
      console.error('Error saliendo de partida:', error);
    }
  }
  
  /**
   * Expulsar jugador (solo owner)
   * @param {string} playerId - ID del jugador a expulsar
   */
  async kickPlayer(playerId) {
    if (!this.isOwner()) {
      throw new Error('Solo el creador de la sala puede expulsar jugadores');
    }
    
    try {
      await this.gameEngine.kickPlayer(playerId);
      
      // Remover del estado local
      this.players.delete(playerId);
      
    } catch (error) {
      throw new Error(`Error expulsando jugador: ${error.message}`);
    }
  }
  
  /**
   * Iniciar la partida (solo owner)
   */
  async startGame() {
    if (!this.gameEngine.isOwner) {
      throw new Error('Solo el creador puede iniciar la partida');
    }
    
    try {
      // Obtener lista de jugadores de los equipos
      const room = this.gameEngine.currentRoom;
      const allPlayers = [];
      
      // Agregar jugadores del equipo A
      room.teams.A.forEach(player => {
        allPlayers.push({
          uid: player.id,
          name: player.name,
          team: 'A'
        });
      });
      
      // Agregar jugadores del equipo B
      room.teams.B.forEach(player => {
        allPlayers.push({
          uid: player.id,
          name: player.name,
          team: 'B'
        });
      });
      
      // Verificar que hay suficientes jugadores
      if (allPlayers.length < 2) {
        throw new Error('Se necesitan al menos 2 jugadores para iniciar');
      }
      
      // Inicializar lógica del juego de cartas
      const gameState = this.cardGame.initializeGame(allPlayers);
      
      // Enviar estado inicial al GameEngine
      await this.gameEngine.startGame(gameState);
      
    } catch (error) {
      throw new Error(`Error iniciando partida: ${error.message}`);
    }
  }
  
  /**
   * Jugar una carta
   * @param {number} cardIndex - Índice de la carta en la mano
   * @param {Object} target - Objetivo de la carta (opcional)
   */
  async playCard(cardIndex, target = null) {
    try {
      const playerId = this.gameEngine.currentPlayer.uid;
      
      // Ejecutar jugada en la lógica del juego
      const result = this.cardGame.playCard(playerId, cardIndex, target);
      
      // Sincronizar con el servidor
      await this.gameEngine.sendGameAction('play_card', {
        cardIndex,
        target,
        result,
        gameState: this.cardGame.getGameState(),
        playerHand: this.cardGame.getPlayerHand(playerId)
      });
      
      return result;
    } catch (error) {
      throw new Error(`Error jugando carta: ${error.message}`);
    }
  }
  
  /**
   * Terminar turno
   */
  async endTurn() {
    try {
      const playerId = this.gameEngine.currentPlayer.uid;
      
      // Terminar turno en la lógica del juego
      const nextPlayer = this.cardGame.endTurn(playerId);
      
      // Sincronizar con el servidor
      await this.gameEngine.sendGameAction('end_turn', {
        previousPlayer: playerId,
        nextPlayer,
        gameState: this.cardGame.getGameState(),
        playerHand: this.cardGame.getPlayerHand(playerId)
      });
      
      return nextPlayer;
    } catch (error) {
      throw new Error(`Error terminando turno: ${error.message}`);
    }
  }

  // ==================== SISTEMA DE EVENTOS ====================
  
  /**
   * Configurar puente de eventos entre GameEngine y CardGameLogic
   */
  setupEventBridge() {
    // Eventos del GameEngine
    this.gameEngine.on(GAME_EVENTS.ROOM_JOINED, (data) => {
      // Registrar jugador cuando se una exitosamente
      this.players.set(this.gameEngine.currentPlayer.uid, {
        uid: this.gameEngine.currentPlayer.uid,
        name: this.gameEngine.currentPlayer.name,
        team: this.gameEngine.currentPlayer.team,
        isOwner: this.gameEngine.isOwner
      });
      
      this.emit('room_joined', data);
    });
    
    this.gameEngine.on(GAME_EVENTS.ROOM_LEFT, (data) => {
      this.emit('room_left', data);
    });
    
    this.gameEngine.on(GAME_EVENTS.ROOM_CLOSED, (data) => {
      this.emit('room_closed', data);
    });
    
    this.gameEngine.on(GAME_EVENTS.GAME_STARTED, (data) => {
      this.emit('game_started', data);
    });
    
    this.gameEngine.on(GAME_EVENTS.CUSTOM_ACTION, (data) => {
      this.handleGameAction(data);
    });
    
    this.gameEngine.on(GAME_EVENTS.GAME_STATE_UPDATED, (data) => {
      this.handleRoomUpdate(data);
    });
    
    this.gameEngine.on(GAME_EVENTS.PLAYER_JOINED, (data) => {
      this.emit('player_joined', data);
    });
    
    this.gameEngine.on(GAME_EVENTS.PLAYER_LEFT, (data) => {
      this.emit('player_left', data);
    });
    
    this.gameEngine.on(GAME_EVENTS.PLAYER_KICKED, (data) => {
      // Si el jugador expulsado soy yo, limpiar estado local
      const kickedPlayerId = data.playerId || data.player?.uid;
      const currentPlayerId = this.gameEngine.currentPlayer?.uid;
      
      if (kickedPlayerId === currentPlayerId) {
        // Limpiar estado local como en leaveGame
        this.players.clear();
        this.cardGame = new CardGameLogic();
        this.setupCardGameEvents();
      }
      
      this.emit(ADAPTER_EVENTS.PLAYER_KICKED, data);
    });
    
    // Configurar eventos del juego de cartas
    this.setupCardGameEvents();
  }
  
  /**
   * Configurar eventos específicos del juego de cartas
   */
  setupCardGameEvents() {
    this.cardGame.on(CARD_GAME_EVENTS.CARD_PLAYED, (data) => {
      this.emit('card_played', data);
    });
    
    this.cardGame.on(CARD_GAME_EVENTS.TURN_ENDED, (data) => {
      this.emit('turn_changed', data);
    });
    
    this.cardGame.on(CARD_GAME_EVENTS.GAME_ENDED, (data) => {
      this.emit('game_ended', data);
    });
    
    this.cardGame.on(CARD_GAME_EVENTS.DECK_RESHUFFLED, (data) => {
      this.emit('deck_reshuffled', data);
    });
  }
  
  /**
   * Manejar acciones de juego recibidas del servidor
   * @param {Object} actionData - Datos de la acción
   */
  handleGameAction(actionData) {
    const { action, data } = actionData;
    
    try {
      switch (action) {
        case 'play_card':
          // Sincronizar jugada de carta
          this.syncCardPlay(data);
          break;
          
        case 'end_turn':
          // Sincronizar cambio de turno
          this.syncTurnChange(data);
          break;
          
        case 'game_state_sync':
          // Sincronizar estado completo del juego
          this.syncGameState(data);
          break;
          
        default:
          console.warn('Acción de juego no reconocida:', action);
      }
    } catch (error) {
      console.error('Error manejando acción de juego:', error);
    }
  }
  
  /**
   * Sincronizar jugada de carta desde el servidor
   * @param {Object} data - Datos de la jugada
   */
  syncCardPlay(data) {
    // Actualizar estado local del juego
    if (data.gameState) {
      this.cardGame.gameState = { ...this.cardGame.gameState, ...data.gameState };
    }
    
    this.emit('card_played_remote', {
      playerId: data.playerId,
      result: data.result,
      gameState: this.cardGame.getGameState()
    });
  }
  
  /**
   * Sincronizar cambio de turno desde el servidor
   * @param {Object} data - Datos del cambio de turno
   */
  syncTurnChange(data) {
    if (data.gameState) {
      this.cardGame.gameState = { ...this.cardGame.gameState, ...data.gameState };
    }
    
    this.emit('turn_changed_remote', {
      previousPlayer: data.previousPlayer,
      currentPlayer: data.nextPlayer,
      gameState: this.cardGame.getGameState()
    });
  }
  
  /**
   * Sincronizar estado completo del juego
   * @param {Object} data - Estado del juego
   */
  syncGameState(data) {
    if (data.gameState) {
      this.cardGame.gameState = { ...data.gameState };
    }
    
    if (data.playerHands) {
      // Actualizar manos de jugadores (solo la propia)
      const currentPlayerId = this.gameEngine.currentPlayer.uid;
      if (data.playerHands[currentPlayerId]) {
        this.cardGame.playerHands.set(currentPlayerId, data.playerHands[currentPlayerId]);
      }
    }
    
    this.emit('game_state_synced', {
      gameState: this.cardGame.getGameState()
    });
  }
  
  /**
   * Manejar actualizaciones de la sala
   * @param {Object} roomData - Datos de la sala
   */
  handleRoomUpdate(roomData) {
    // Verificar si el juego acaba de comenzar
    if (roomData.status === 'playing' && roomData.gameData) {
      // Emitir evento GAME_STARTED para todos los jugadores
      this.emit('game_started', roomData.gameData);
    }
    
    // Actualizar información de jugadores
    this.updatePlayersFromRoom(roomData);
    
    this.emit('room_updated', roomData);
  }
  
  /**
   * Actualizar información de jugadores desde datos de la sala
   * @param {Object} roomData - Datos de la sala
   */
  updatePlayersFromRoom(roomData) {
    this.players.clear();
    
    // Agregar jugadores del equipo A
    roomData.teams.A.forEach(player => {
      this.players.set(player.id, {
        uid: player.id,
        name: player.name,
        team: 'A',
        isOwner: player.id === roomData.owner
      });
    });
    
    // Agregar jugadores del equipo B
    roomData.teams.B.forEach(player => {
      this.players.set(player.id, {
        uid: player.id,
        name: player.name,
        team: 'B',
        isOwner: player.id === roomData.owner
      });
    });
  }

  // ==================== GETTERS Y UTILIDADES ====================
  
  /**
   * Obtener mano del jugador actual
   * @returns {Array} - Cartas en la mano
   */
  getMyHand() {
    const playerId = this.gameEngine.currentPlayer.uid;
    return this.cardGame.getPlayerHand(playerId);
  }
  
  /**
   * Obtener estado actual del juego
   * @returns {Object} - Estado del juego
   */
  getGameState() {
    return this.cardGame.getGameState();
  }
  
  /**
   * Verificar si es mi turno
   * @returns {boolean}
   */
  isMyTurn() {
    const playerId = this.gameEngine.currentPlayer.uid;
    return this.cardGame.isPlayerTurn(playerId);
  }
  
  /**
   * Obtener información del jugador actual
   * @returns {Object}
   */
  getCurrentPlayer() {
    return this.gameEngine.currentPlayer;
  }
  
  /**
   * Obtener información de la sala actual
   * @returns {Object}
   */
  getCurrentRoom() {
    return this.gameEngine.currentRoom;
  }
  
  /**
   * Verificar si está en una sala
   * @returns {boolean}
   */
  isInRoom() {
    return this.gameEngine.isInRoom;
  }
  
  /**
   * Verificar si es el owner
   * @returns {boolean}
   */
  isOwner() {
    return this.gameEngine.isOwner;
  }
  
  /**
   * Obtener lista de todos los jugadores
   * @returns {Array}
   */
  getAllPlayers() {
    return Array.from(this.players.values());
  }

  // ==================== SISTEMA DE EVENTOS PROPIO ====================
  
  /**
   * Suscribirse a eventos
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
   * Desuscribirse de eventos
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
   * Emitir evento
   * @param {string} event - Nombre del evento
   * @param {*} data - Datos del evento
   */
  emit(event, data) {
    if (!this.eventListeners.has(event)) return;
    
    this.eventListeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error en callback de evento ${event}:`, error);
      }
    });
  }
  
  /**
   * Limpiar todos los eventos
   */
  clearEvents() {
    this.eventListeners.clear();
    this.cardGame.clearEvents();
  }
}

// Eventos disponibles del adaptador
const ADAPTER_EVENTS = {
  // Eventos de sala
  ROOM_JOINED: 'room_joined',
  ROOM_LEFT: 'room_left',
  ROOM_CLOSED: 'room_closed',
  ROOM_UPDATED: 'room_updated',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_KICKED: 'player_kicked',
  
  // Eventos de juego
  GAME_STARTED: 'game_started',
  GAME_ENDED: 'game_ended',
  CARD_PLAYED: 'card_played',
  CARD_PLAYED_REMOTE: 'card_played_remote',
  TURN_CHANGED: 'turn_changed',
  TURN_CHANGED_REMOTE: 'turn_changed_remote',
  DECK_RESHUFFLED: 'deck_reshuffled',
  GAME_STATE_SYNCED: 'game_state_synced'
};

export { CardGameAdapter, ADAPTER_EVENTS };
export default CardGameAdapter;