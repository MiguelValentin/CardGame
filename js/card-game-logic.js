/**
 * Card Game Logic - Lógica específica del juego de cartas
 * Separada de la lógica de networking y Firebase
 */

import { CARD_LIBRARY, GAME_CONFIG, createDeck } from './config.js';

/**
 * Clase que maneja toda la lógica específica del juego de cartas
 */
class CardGameLogic {
  constructor() {
    try {

      
      // Verificar que los valores no sean undefined
      if (!GAME_CONFIG || !GAME_CONFIG.GAME_STATES) {
        throw new Error('GAME_CONFIG o GAME_STATES no están definidos');
      }
      
      const lobbyStatus = GAME_CONFIG.GAME_STATES.LOBBY;
      
      this.gameState = {
        status: lobbyStatus,
      currentTurn: null,
      currentTurnIndex: 0,
      turnOrder: [],
      hp: {
        [GAME_CONFIG.TEAMS.A]: GAME_CONFIG.STARTING_HP,
        [GAME_CONFIG.TEAMS.B]: GAME_CONFIG.STARTING_HP
      },
      deck: [],
      discard: [],
      lastMove: null,
      rngSeed: Math.floor(Math.random() * 1000000)
    };
    
    this.playerHands = new Map(); // uid -> [cards]
    this.eventCallbacks = new Map();
    

    } catch (error) {
      console.error('Error en constructor CardGameLogic:', error);
      throw error;
    }
  }

  // ==================== INICIALIZACIÓN DEL JUEGO ====================
  
  /**
   * Inicializar un nuevo juego
   * @param {Array} players - Lista de jugadores con {uid, name, team}
   * @param {number} seed - Semilla para RNG (opcional)
   */
  initializeGame(players, seed = null) {

    
    if (players.length < 2) {
      throw new Error('Se necesitan al menos 2 jugadores para iniciar');
    }
    
    // Configurar semilla RNG
    this.gameState.rngSeed = seed || Math.floor(Math.random() * 1000000);
    
    // Crear y barajar mazo
    this.gameState.deck = createDeck(this.gameState.rngSeed);
    this.gameState.discard = [];
    
    // Configurar orden de turnos (alternar equipos)
    this.gameState.turnOrder = this.createTurnOrder(players);
    this.gameState.currentTurnIndex = 0;
    this.gameState.currentTurn = this.gameState.turnOrder[0];
    
    // Repartir cartas iniciales
    this.dealInitialCards(players);
    
    // Cambiar estado a jugando
    this.gameState.status = GAME_CONFIG.GAME_STATES.ACTIVE;
    
    const finalGameState = this.getGameState();
    
    this.emit('game_initialized', {
      gameState: finalGameState,
      currentPlayer: this.gameState.currentTurn
    });
    
    return finalGameState;
  }
  
  /**
   * Crear orden de turnos alternando equipos
   * @param {Array} players - Lista de jugadores
   * @returns {Array} - Orden de turnos
   */
  createTurnOrder(players) {
    const teamA = players.filter(p => p.team === GAME_CONFIG.TEAMS.A);
    const teamB = players.filter(p => p.team === GAME_CONFIG.TEAMS.B);
    
    const turnOrder = [];
    const maxLength = Math.max(teamA.length, teamB.length);
    
    for (let i = 0; i < maxLength; i++) {
      if (i < teamA.length) turnOrder.push(teamA[i].uid);
      if (i < teamB.length) turnOrder.push(teamB[i].uid);
    }
    
    return turnOrder;
  }
  
  /**
   * Repartir cartas iniciales a todos los jugadores
   * @param {Array} players - Lista de jugadores
   */
  dealInitialCards(players) {
    players.forEach(player => {
      const hand = [];
      for (let i = 0; i < GAME_CONFIG.STARTING_HAND_SIZE; i++) {
        const card = this.drawCard();
        if (card) hand.push(card);
      }
      this.playerHands.set(player.uid, hand);
    });
  }

  // ==================== MECÁNICAS DE CARTAS ====================
  
  /**
   * Robar una carta del mazo
   * @returns {Object|null} - Carta robada o null si no hay cartas
   */
  drawCard() {
    if (this.gameState.deck.length === 0) {
      this.reshuffleDeck();
    }
    
    if (this.gameState.deck.length === 0) {
      return null; // No hay más cartas
    }
    
    return this.gameState.deck.pop();
  }
  
  /**
   * Rebarajar el descarte como nuevo mazo
   */
  reshuffleDeck() {
    if (this.gameState.discard.length === 0) return;
    
    this.gameState.deck = [...this.gameState.discard];
    this.gameState.discard = [];
    
    // Barajar usando la semilla
    this.shuffleArray(this.gameState.deck);
    
    this.emit('deck_reshuffled', {
      deckSize: this.gameState.deck.length
    });
  }
  
  /**
   * Barajar array usando semilla
   * @param {Array} array - Array a barajar
   */
  shuffleArray(array) {
    // Implementación simple de Fisher-Yates con semilla
    let seed = this.gameState.rngSeed;
    
    for (let i = array.length - 1; i > 0; i--) {
      seed = (seed * 9301 + 49297) % 233280;
      const j = Math.floor((seed / 233280) * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    
    this.gameState.rngSeed = seed;
  }

  // ==================== ACCIONES DE JUEGO ====================
  
  /**
   * Jugar una carta
   * @param {string} playerId - ID del jugador
   * @param {number} cardIndex - Índice de la carta en la mano
   * @param {Object} target - Objetivo de la carta (opcional)
   * @returns {Object} - Resultado de la acción
   */
  playCard(playerId, cardIndex, target = null) {
    // Verificar que es el turno del jugador
    if (this.gameState.currentTurn !== playerId) {
      throw new Error('No es tu turno');
    }
    
    // Verificar que el juego está en curso
    if (this.gameState.status !== GAME_CONFIG.GAME_STATES.PLAYING) {
      throw new Error('El juego no está en curso');
    }
    
    // Obtener mano del jugador
    const hand = this.playerHands.get(playerId);
    if (!hand || cardIndex < 0 || cardIndex >= hand.length) {
      throw new Error('Carta inválida');
    }
    
    const card = hand[cardIndex];
    const cardData = CARD_LIBRARY[card.id];
    
    if (!cardData) {
      throw new Error('Datos de carta no encontrados');
    }
    
    // Ejecutar efecto de la carta
    const result = this.executeCardEffect(playerId, card, cardData, target);
    
    // Remover carta de la mano
    hand.splice(cardIndex, 1);
    
    // Agregar carta al descarte
    this.gameState.discard.push(card);
    
    // Registrar movimiento
    this.gameState.lastMove = {
      playerId,
      card: card,
      target,
      result,
      timestamp: Date.now()
    };
    
    this.emit('card_played', {
      playerId,
      card,
      result,
      gameState: this.getGameState()
    });
    
    // Verificar condiciones de victoria
    this.checkWinConditions();
    
    return result;
  }
  
  /**
   * Ejecutar el efecto de una carta
   * @param {string} playerId - ID del jugador
   * @param {Object} card - Carta jugada
   * @param {Object} cardData - Datos de la carta
   * @param {Object} target - Objetivo
   * @returns {Object} - Resultado del efecto
   */
  executeCardEffect(playerId, card, cardData, target) {
    const result = {
      damage: 0,
      healing: 0,
      cardsDrawn: 0,
      specialEffects: []
    };
    
    // Determinar equipo del jugador y equipo enemigo
    const playerTeam = this.getPlayerTeam(playerId);
    const enemyTeam = playerTeam === GAME_CONFIG.TEAMS.A ? GAME_CONFIG.TEAMS.B : GAME_CONFIG.TEAMS.A;
    
    // Ejecutar efectos según el tipo de carta
    switch (cardData.type) {
      case 'attack':
        const damage = cardData.damage || 0;
        this.gameState.hp[enemyTeam] = Math.max(0, this.gameState.hp[enemyTeam] - damage);
        result.damage = damage;
        break;
        
      case 'heal':
        const healing = cardData.healing || 0;
        this.gameState.hp[playerTeam] = Math.min(
          GAME_CONFIG.STARTING_HP,
          this.gameState.hp[playerTeam] + healing
        );
        result.healing = healing;
        break;
        
      case 'draw':
        const cardsToDraw = cardData.draw || 1;
        const hand = this.playerHands.get(playerId);
        for (let i = 0; i < cardsToDraw; i++) {
          const drawnCard = this.drawCard();
          if (drawnCard) {
            hand.push(drawnCard);
            result.cardsDrawn++;
          }
        }
        break;
        
      case 'special':
        // Efectos especiales personalizados
        if (cardData.effect) {
          const specialResult = this.executeSpecialEffect(playerId, cardData.effect, target);
          result.specialEffects.push(specialResult);
        }
        break;
    }
    
    return result;
  }
  
  /**
   * Ejecutar efectos especiales de cartas
   * @param {string} playerId - ID del jugador
   * @param {string} effectType - Tipo de efecto
   * @param {Object} target - Objetivo
   * @returns {Object} - Resultado del efecto especial
   */
  executeSpecialEffect(playerId, effectType, target) {
    // Aquí se pueden implementar efectos especiales específicos
    // Por ahora, implementación básica
    
    switch (effectType) {
      case 'steal_card':
        // Robar carta del oponente (si tiene)
        // Implementación simplificada
        return { type: 'steal_card', success: false };
        
      case 'extra_turn':
        // Turno extra
        return { type: 'extra_turn', granted: true };
        
      default:
        return { type: effectType, executed: true };
    }
  }

  // ==================== GESTIÓN DE TURNOS ====================
  
  /**
   * Terminar el turno actual
   * @param {string} playerId - ID del jugador que termina el turno
   * @returns {string} - ID del siguiente jugador
   */
  endTurn(playerId) {
    if (this.gameState.currentTurn !== playerId) {
      throw new Error('No es tu turno');
    }
    
    if (this.gameState.status !== GAME_CONFIG.GAME_STATES.PLAYING) {
      throw new Error('El juego no está en curso');
    }
    
    // Robar carta al final del turno
    const hand = this.playerHands.get(playerId);
    if (hand && hand.length < GAME_CONFIG.MAX_HAND_SIZE) {
      const drawnCard = this.drawCard();
      if (drawnCard) {
        hand.push(drawnCard);
      }
    }
    
    // Avanzar al siguiente turno
    this.gameState.currentTurnIndex = (this.gameState.currentTurnIndex + 1) % this.gameState.turnOrder.length;
    this.gameState.currentTurn = this.gameState.turnOrder[this.gameState.currentTurnIndex];
    
    this.emit('turn_ended', {
      previousPlayer: playerId,
      currentPlayer: this.gameState.currentTurn,
      gameState: this.getGameState()
    });
    
    return this.gameState.currentTurn;
  }

  // ==================== CONDICIONES DE VICTORIA ====================
  
  /**
   * Verificar condiciones de victoria
   * @returns {Object|null} - Resultado de victoria o null
   */
  checkWinConditions() {
    const hpA = this.gameState.hp[GAME_CONFIG.TEAMS.A];
    const hpB = this.gameState.hp[GAME_CONFIG.TEAMS.B];
    
    let winner = null;
    let reason = null;
    
    if (hpA <= 0 && hpB <= 0) {
      winner = 'tie';
      reason = 'Ambos equipos llegaron a 0 HP';
    } else if (hpA <= 0) {
      winner = GAME_CONFIG.TEAMS.B;
      reason = 'Equipo A llegó a 0 HP';
    } else if (hpB <= 0) {
      winner = GAME_CONFIG.TEAMS.A;
      reason = 'Equipo B llegó a 0 HP';
    }
    
    if (winner) {
      this.gameState.status = GAME_CONFIG.GAME_STATES.ENDED;
      
      const result = {
        winner,
        reason,
        finalHP: { ...this.gameState.hp },
        gameState: this.getGameState()
      };
      
      this.emit('game_ended', result);
      
      return result;
    }
    
    return null;
  }

  // ==================== UTILIDADES ====================
  
  /**
   * Obtener equipo de un jugador
   * @param {string} playerId - ID del jugador
   * @returns {string} - Equipo del jugador
   */
  getPlayerTeam(playerId) {
    // Esta función necesitaría acceso a la información de jugadores
    // Por ahora, implementación simplificada
    return GAME_CONFIG.TEAMS.A; // Placeholder
  }
  
  /**
   * Obtener mano de un jugador
   * @param {string} playerId - ID del jugador
   * @returns {Array} - Cartas en la mano
   */
  getPlayerHand(playerId) {
    return this.playerHands.get(playerId) || [];
  }
  
  /**
   * Obtener estado actual del juego
   * @returns {Object} - Estado del juego
   */
  getGameState() {
    return {
      ...this.gameState,
      deckSize: this.gameState.deck.length,
      discardSize: this.gameState.discard.length
    };
  }
  
  /**
   * Verificar si es el turno de un jugador
   * @param {string} playerId - ID del jugador
   * @returns {boolean}
   */
  isPlayerTurn(playerId) {
    return this.gameState.currentTurn === playerId;
  }
  
  /**
   * Obtener información de la última jugada
   * @returns {Object|null}
   */
  getLastMove() {
    return this.gameState.lastMove;
  }

  // ==================== SISTEMA DE EVENTOS ====================
  
  /**
   * Suscribirse a eventos del juego
   * @param {string} event - Nombre del evento
   * @param {Function} callback - Función callback
   */
  on(event, callback) {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event).push(callback);
  }
  
  /**
   * Desuscribirse de eventos
   * @param {string} event - Nombre del evento
   * @param {Function} callback - Función callback
   */
  off(event, callback) {
    if (!this.eventCallbacks.has(event)) return;
    
    const callbacks = this.eventCallbacks.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }
  
  /**
   * Emitir evento
   * @param {string} event - Nombre del evento
   * @param {*} data - Datos del evento
   */
  emit(event, data) {
    if (!this.eventCallbacks.has(event)) return;
    
    this.eventCallbacks.get(event).forEach(callback => {
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
    this.eventCallbacks.clear();
  }
}

// Eventos disponibles
const CARD_GAME_EVENTS = {
  GAME_INITIALIZED: 'game_initialized',
  CARD_PLAYED: 'card_played',
  TURN_ENDED: 'turn_ended',
  GAME_ENDED: 'game_ended',
  DECK_RESHUFFLED: 'deck_reshuffled',
  PLAYER_DREW_CARD: 'player_drew_card'
};

export { CardGameLogic, CARD_GAME_EVENTS };
export default CardGameLogic;