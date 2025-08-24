/**
 * UI Renderer - Renderizado de interfaz usando la nueva arquitectura
 * Utiliza CardGameAdapter en lugar del código legacy
 */

import { CardGameAdapter, ADAPTER_EVENTS } from './card-game-adapter.js';
import { CARD_LIBRARY, GAME_CONFIG } from './config.js';

/**
 * Clase para manejar todo el renderizado de la interfaz de usuario
 */
class UIRenderer {
  constructor() {
    this.adapter = new CardGameAdapter();
    this.elements = this.initializeElements();
    this.isInitialized = false;
    this.selectedPlayerId = null; // Para el sistema de kick
    
    this.setupEventListeners();
    this.setupAdapterEvents();
  }

  // ==================== INICIALIZACIÓN ====================
  
  /**
   * Inicializar elementos del DOM
   */
  initializeElements() {
    this.elements = {
      // Lobby elements
      displayName: document.getElementById('displayName'),
      teamPick: document.getElementById('teamPick'),
      btnCreate: document.getElementById('btnCreate'),
      btnJoin: document.getElementById('btnJoin'),
      roomCodeInput: document.getElementById('roomCode'),
      codeOut: document.getElementById('codeOut'),
      playersGrid: document.getElementById('playersGrid'),
      btnStart: document.getElementById('btnStart'),
      ownerControls: document.getElementById('ownerControls'),
      btnKickPlayer: document.getElementById('btnKickPlayer'),
      btnLeaveRoom: document.getElementById('btnLeaveRoom'),
      startRequirement: document.getElementById('startRequirement'),

      // Game elements
      gamePanel: document.getElementById('game'),
      lobbyPanel: document.getElementById('lobby'),
      turnPlayer: document.getElementById('turnPlayer'),
      playersInGame: document.getElementById('playersInGame'),
      handZone: document.getElementById('hand'),
      hpA: document.getElementById('hpA'),
      hpB: document.getElementById('hpB'),
      btnEndTurn: document.getElementById('btnEndTurn'),
      log: document.getElementById('log'),

      // UI elements
      loading: document.getElementById('loading'),
      error: document.getElementById('error'),
      errorMessage: document.getElementById('errorMessage')
    };
    
    // Cargar nombre guardado del localStorage
    this.loadSavedPlayerName();
  }
  
  /**
   * Inicializar el renderer
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      // Inicializar elementos del DOM primero
      this.initializeElements();
      
      // Renderizar lobby inicial inmediatamente
      this.resetLobbyUI();
      
      // Inicializar adapter en segundo plano
      await this.adapter.initialize();
      
      this.isInitialized = true;
      this.log('Sistema inicializado correctamente');
    } catch (error) {
      this.showError(`Error inicializando: ${error.message}`);
    }
  }

  // ==================== EVENT LISTENERS ====================
  
  /**
   * Configurar event listeners de la UI
   * NOTA: Los event listeners específicos del lobby y juego ahora se manejan
   * en bindLobbyEvents() y bindGameEvents() respectivamente, que se llaman
   * automáticamente cuando se regenera el HTML declarativamente.
   */
  setupEventListeners() {
    // Solo eventos globales que no se regeneran

  }
  
  /**
   * Configurar eventos del adaptador
   */
  setupAdapterEvents() {
    // Eventos de sala
    this.adapter.on(ADAPTER_EVENTS.ROOM_JOINED, (data) => {
      this.log(`Te uniste a la sala ${data.code}`);
      this.hideError();
      this.showLoading(false);
    });
    
    this.adapter.on(ADAPTER_EVENTS.ROOM_LEFT, () => {
      this.log('Saliste de la sala');
      this.switchToLobby();
      this.resetLobbyUI();
    });
    
    this.adapter.on(ADAPTER_EVENTS.ROOM_CLOSED, (data) => {
      if (data.reason === 'owner_left') {
        this.showError('La sala fue cerrada por el creador');
        this.log('El creador de la sala se desconectó');
      } else if (data.reason === 'deleted') {
        this.showError('La sala fue eliminada');
        this.log('La sala ya no existe');
      }
      this.switchToLobby();
      this.resetLobbyUI();
    });
    
    this.adapter.on('room_updated', (roomData) => {

      this.renderLobby(roomData);
    });
    
    this.adapter.on(ADAPTER_EVENTS.PLAYER_JOINED, (data) => {
      this.log(`${data.player.name} se unió al equipo ${data.player.team}`);
    });
    
    this.adapter.on(ADAPTER_EVENTS.PLAYER_LEFT, (data) => {
      this.log(`${data.player.name} salió de la sala`);
    });
    
    this.adapter.on(ADAPTER_EVENTS.PLAYER_KICKED, (data) => {
      // Handle both data formats: {playerId} and {player: {uid}}
      const kickedPlayerId = data.playerId || data.player?.uid;
      
      if (kickedPlayerId === this.adapter.getCurrentPlayer()?.uid) {
        this.showError('Has sido expulsado de la sala');
        this.log('Fuiste expulsado de la sala');
        
        // Forzar regreso al lobby con estado inicial
        this.switchToLobby();
        this.resetLobbyUI();
        
        // Forzar renderizado del lobby en estado inicial (sin sala)
        const defaultRoomData = { code: '—', teams: { A: [], B: [] }, owner: null };
        this.renderLobbyDeclarativeForced(defaultRoomData, false);
      } else {
        // Si expulsaron a otro jugador, solo mostrar log
        const playerName = this.getPlayerName(kickedPlayerId) || 'Un jugador';
        this.log(`${playerName} fue expulsado de la sala`);
      }
    });
    
    // Eventos de juego
    this.adapter.on(ADAPTER_EVENTS.GAME_STARTED, (gameData) => {
      this.log('¡El juego ha comenzado!');
      this.switchToGame();
      this.renderGameState(gameData);
    });
    
    this.adapter.on(ADAPTER_EVENTS.CARD_PLAYED, (data) => {
      this.handleCardPlayed(data);
    });
    
    this.adapter.on(ADAPTER_EVENTS.CARD_PLAYED_REMOTE, (data) => {
      this.handleRemoteCardPlayed(data);
    });
    
    this.adapter.on(ADAPTER_EVENTS.TURN_CHANGED, (data) => {
      this.handleTurnChanged(data);
    });
    
    this.adapter.on(ADAPTER_EVENTS.TURN_CHANGED_REMOTE, (data) => {
      this.handleRemoteTurnChanged(data);
    });
    
    this.adapter.on(ADAPTER_EVENTS.GAME_ENDED, (data) => {
      this.handleGameEnded(data);
    });
    
    this.adapter.on(ADAPTER_EVENTS.GAME_STATE_SYNCED, (data) => {
      this.renderGameState(data.gameState);
    });
  }

  // ==================== HANDLERS DE ACCIONES ====================
  
  /**
   * Manejar creación de partida
   */
  async handleCreateGame() {
    try {
      this.hideError();
      
      const playerName = this.elements.displayName.value.trim();
      const team = this.elements.teamPick.value;
      
      if (!playerName) {
        this.showError('Ingresa tu nombre');
        return;
      }
      
      this.showLoading(true);
      
      const roomCode = await this.adapter.createGame(playerName, team);
      
      this.log(`Sala creada con código: ${roomCode}`);
      this.showLoading(false);
      
    } catch (error) {
      this.showError(error.message);
      this.showLoading(false);
    }
  }
  
  /**
   * Manejar unirse a partida
   */
  async handleJoinGame() {
    try {
      this.hideError();
      
      const roomCode = this.elements.roomCodeInput.value.trim().toUpperCase();
      const playerName = this.elements.displayName.value.trim();
      const team = this.elements.teamPick.value;
      
      if (!roomCode) {
        this.showError('Ingresa el código de la sala');
        return;
      }
      
      if (!playerName) {
        this.showError('Ingresa tu nombre');
        return;
      }
      
      this.showLoading(true);
      
      await this.adapter.joinGame(roomCode, playerName, team);
      
      this.showLoading(false);
      
    } catch (error) {
      this.showError(error.message);
      this.showLoading(false);
    }
  }
  
  /**
   * Manejar inicio de partida
   */
  async handleStartGame() {
    try {
      this.hideError();
      this.showLoading(true);
      
      await this.adapter.startGame();
      
      this.showLoading(false);
      
    } catch (error) {
      this.showError(error.message);
      this.showLoading(false);
    }
  }
  
  /**
   * Manejar salir de partida
   */
  async handleLeaveGame() {
    try {
      await this.adapter.leaveGame();
    } catch (error) {
      console.error('Error saliendo de partida:', error);
    }
  }
  
  /**
   * Manejar expulsión de jugador
   */
  async handleKickPlayer() {
    if (!this.selectedPlayerId) return;
    
    try {
      await this.adapter.kickPlayer(this.selectedPlayerId);
      
      // Ocultar botón de kick
      if (this.elements.btnKickPlayer) {
        this.elements.btnKickPlayer.style.display = 'none';
      }
      
      this.selectedPlayerId = null;
      this.log('Jugador expulsado');
      
    } catch (error) {
      this.showError(error.message);
    }
  }
  
  /**
   * Manejar jugar carta
   * @param {number} cardIndex - Índice de la carta
   */
  async handlePlayCard(cardIndex) {
    try {
      if (!this.adapter.isMyTurn()) {
        this.showError('No es tu turno');
        return;
      }
      
      const result = await this.adapter.playCard(cardIndex);
      this.log(`Jugaste una carta. Daño: ${result.damage}, Curación: ${result.healing}`);
      
      // Actualizar UI usando sistema declarativo
      this.renderGameState(this.adapter.getGameState());
      
    } catch (error) {
      this.showError(error.message);
    }
  }
  
  /**
   * Manejar terminar turno
   */
  async handleEndTurn() {
    try {
      if (!this.adapter.isMyTurn()) {
        this.showError('No es tu turno');
        return;
      }
      
      const nextPlayer = await this.adapter.endTurn();
      this.log('Terminaste tu turno');
      
      // Actualizar UI usando sistema declarativo
      this.renderGameState(this.adapter.getGameState());
      
    } catch (error) {
      this.showError(error.message);
    }
  }

  // ==================== HANDLERS DE EVENTOS ====================
  
  /**
   * Manejar carta jugada localmente
   * @param {Object} data - Datos de la carta jugada
   */
  handleCardPlayed(data) {
    this.renderGameState(data.gameState);
    
    const playerName = this.getPlayerName(data.playerId);
    this.log(`${playerName} jugó una carta`);
  }
  
  /**
   * Manejar carta jugada remotamente
   * @param {Object} data - Datos de la carta jugada
   */
  handleRemoteCardPlayed(data) {
    this.renderGameState(data.gameState);
    
    const playerName = this.getPlayerName(data.playerId);
    this.log(`${playerName} jugó una carta`);
  }
  
  /**
   * Manejar cambio de turno local
   * @param {Object} data - Datos del cambio de turno
   */
  handleTurnChanged(data) {
    this.renderGameState(data.gameState);
    this.renderTurnIndicator(data.currentPlayer);
    
    const currentPlayerName = this.getPlayerName(data.currentPlayer);
    this.log(`Turno de ${currentPlayerName}`);
  }
  
  /**
   * Manejar cambio de turno remoto
   * @param {Object} data - Datos del cambio de turno
   */
  handleRemoteTurnChanged(data) {
    this.renderGameState(data.gameState);
    this.renderTurnIndicator(data.currentPlayer);
    
    const currentPlayerName = this.getPlayerName(data.currentPlayer);
    this.log(`Turno de ${currentPlayerName}`);
  }
  
  /**
   * Manejar fin de juego
   * @param {Object} data - Datos del fin de juego
   */
  handleGameEnded(data) {
    let message;
    
    if (data.winner === 'tie') {
      message = '¡Empate! Ambos equipos llegaron a 0 HP';
    } else {
      message = `¡El Equipo ${data.winner} ganó! ${data.reason}`;
    }
    
    this.log(message);
    this.showGameEndDialog(data);
  }

  // ==================== RENDERIZADO ====================
  
  /**
   * Renderizar lobby
   * @param {Object} roomData - Datos de la sala
   */
  renderLobby(roomData) {

    
    // Usar el nuevo sistema declarativo
    this.renderLobbyDeclarative(roomData);
  }
  
  // Método eliminado - ahora se usa renderLobbyDeclarative
  
  // Método eliminado - ahora se usa generateTeamHTML
  
  // Método eliminado - ahora se usa generatePlayerSlotHTML
  
  // Método eliminado - ahora se usa canStartGame y generateBottomControlsHTML
  
  /**
   * Renderizar estado del juego
   * @param {Object} gameState - Estado del juego
   */
  renderGameState(gameState) {
    if (!gameState) return;
    

    
    // Usar el nuevo sistema declarativo
    this.renderGameDeclarative(gameState);
  }
  
  // Método eliminado - ahora se usa generateGameInfoHTML
  
  // Método eliminado - ahora se usa generatePlayerHandHTML

  // ==================== UTILIDADES DE UI ====================
  
  /**
   * Mostrar loading
   * @param {boolean} show - Mostrar o ocultar
   */
  showLoading(show = true) {
    if (this.elements.loading) {
      this.elements.loading.style.display = show ? 'block' : 'none';
    }
  }
  
  /**
   * Mostrar error
   * @param {string} message - Mensaje de error
   */
  showError(message) {
    // Buscar elementos directamente si this.elements no está disponible
    const errorMessageElement = this.elements?.errorMessage || document.getElementById('errorMessage');
    const errorElement = this.elements?.error || document.getElementById('error');
    
    if (errorMessageElement) {
      errorMessageElement.textContent = message;
    }
    if (errorElement) {
      errorElement.style.display = 'block';
    }
  }
  
  /**
   * Ocultar error
   */
  hideError() {
    const errorElement = this.elements?.error || document.getElementById('error');
    if (errorElement) {
      errorElement.style.display = 'none';
    }
  }
  
  /**
   * Agregar mensaje al log
   * @param {string} message - Mensaje
   */
  log(message) {
    if (!this.elements.log) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.innerHTML = `${timestamp} · ${message}`;
    
    this.elements.log.appendChild(logEntry);
    this.elements.log.scrollTop = this.elements.log.scrollHeight;
  }
  
  /**
   * Cambiar a vista de juego
   */
  switchToGame() {
    if (this.elements.lobbyPanel) {
      this.elements.lobbyPanel.style.display = 'none';
    }
    if (this.elements.gamePanel) {
      this.elements.gamePanel.style.display = 'block';
    }
  }
  
  /**
   * Cambiar a vista de lobby
   */
  switchToLobby() {
        if (this.elements.lobbyPanel) {
            this.elements.lobbyPanel.style.display = 'block';
        }
        if (this.elements.gamePanel) {
            this.elements.gamePanel.style.display = 'none';
        }
    }
  
  /**
   * Resetear UI del lobby
   */
  resetLobbyUI() {
    // Usar el nuevo sistema declarativo con datos por defecto
    const defaultRoomData = { code: '—', teams: { A: [], B: [] }, owner: null };
    this.renderLobbyDeclarativeForced(defaultRoomData, false); // Forzar estado inicial
    
    this.hideError();
    this.showLoading(false);
  }
  
  // ==================== SISTEMA DECLARATIVO ====================
  
  /**
   * Renderizar lobby de forma declarativa (regeneración completa)
   * @param {Object} roomData - Datos de la sala
   */
  renderLobbyDeclarative(roomData) {
    if (!roomData) {
      roomData = { code: '—', teams: { A: [], B: [] }, owner: null };
    }
    

    
    // Generar HTML completo del lobby
    const lobbyHTML = this.generateLobbyHTML(roomData);
    
    // Reemplazar contenido completo
    if (this.elements.lobbyPanel) {
      this.elements.lobbyPanel.innerHTML = lobbyHTML;
    }
    
    // Re-inicializar elementos del DOM
    this.reinitializeLobbyElements();
    
    // Re-bindear eventos del lobby
    this.bindLobbyEvents();
    
    // Cargar nombre guardado después del renderizado
    this.loadSavedPlayerName();
  }
  
  /**
   * Renderizar lobby de forma declarativa forzando un estado específico
   * @param {Object} roomData - Datos de la sala
   * @param {boolean} forceInRoom - Forzar estado de "en sala"
   */
  renderLobbyDeclarativeForced(roomData, forceInRoom = false) {
    if (!roomData) {
      roomData = { code: '—', teams: { A: [], B: [] }, owner: null };
    }
    
    // Generar HTML completo del lobby con estado forzado
    const lobbyHTML = this.generateLobbyHTMLForced(roomData, forceInRoom);
    
    // Reemplazar contenido completo
    if (this.elements.lobbyPanel) {
      this.elements.lobbyPanel.innerHTML = lobbyHTML;
    }
    
    // Re-inicializar elementos del DOM
    this.reinitializeLobbyElements();
    
    // Re-bindear eventos del lobby
    this.bindLobbyEvents();
    
    // Cargar nombre guardado después del renderizado
    this.loadSavedPlayerName();
  }
  
  /**
   * Generar HTML completo del lobby
   * @param {Object} roomData - Datos de la sala
   * @returns {string} HTML del lobby
   */
  generateLobbyHTML(roomData) {
    const isInRoom = this.adapter.isInRoom();
    const isOwner = this.adapter.isOwner();
    const teamA = roomData.teams.A || [];
    const teamB = roomData.teams.B || [];
    const totalPlayers = teamA.length + teamB.length;
    
    // Generar controles principales
    const mainControlsHTML = this.generateMainControlsHTML(isInRoom);
    
    // Generar grid de jugadores
    const playersGridHTML = this.generatePlayersGridHTML(roomData.teams, isInRoom);
    
    // Generar controles del owner
    const ownerControlsHTML = this.generateOwnerControlsHTML(isOwner, totalPlayers, isInRoom);
    
    // Generar controles inferiores
    const bottomControlsHTML = this.generateBottomControlsHTML(roomData, isInRoom);
    
    return `
      <h2>Lobby</h2>
      ${mainControlsHTML}
      ${playersGridHTML}
      ${ownerControlsHTML}
      ${bottomControlsHTML}
    `;
  }
  
  /**
   * Generar HTML completo del lobby con estado forzado
   * @param {Object} roomData - Datos de la sala
   * @param {boolean} forceInRoom - Forzar estado de "en sala"
   * @returns {string} HTML del lobby
   */
  generateLobbyHTMLForced(roomData, forceInRoom = false) {
    const isInRoom = forceInRoom;
    const isOwner = forceInRoom && (roomData.owner === this.adapter.getCurrentPlayer()?.uid);
    const teamA = roomData.teams.A || [];
    const teamB = roomData.teams.B || [];
    const totalPlayers = teamA.length + teamB.length;
    
    // Generar controles principales
    const mainControlsHTML = this.generateMainControlsHTML(isInRoom);
    
    // Generar grid de jugadores
    const playersGridHTML = this.generatePlayersGridHTML(roomData.teams, isInRoom);
    
    // Generar controles del owner
    const ownerControlsHTML = this.generateOwnerControlsHTML(isOwner, totalPlayers, isInRoom);
    
    // Generar controles inferiores
    const bottomControlsHTML = this.generateBottomControlsHTML(roomData, isInRoom);
    
    return `
      <h2>Lobby</h2>
      ${mainControlsHTML}
      ${playersGridHTML}
      ${ownerControlsHTML}
      ${bottomControlsHTML}
    `;
  }
  
  /**
   * Generar HTML de controles principales
   * @param {boolean} isInRoom - Si está en una sala
   * @returns {string} HTML de controles principales
   */
  generateMainControlsHTML(isInRoom) {
    const createJoinStyle = isInRoom ? 'style="display:none"' : '';
    
    return `
      <div class="row" ${createJoinStyle}>
        <input id="displayName" placeholder="Tu nombre" />
        <select id="teamPick">
          <option value="A">Equipo A</option>
          <option value="B">Equipo B</option>
        </select>
        <button id="btnCreate" class="primary">Crear sala</button>
        <input id="roomCode" placeholder="Código de sala" />
        <button id="btnJoin">Unirse</button>
        <span class="muted">Comparte el código para invitar (4 jugadores).</span>
      </div>
    `;
  }
  
  /**
   * Generar HTML del grid de jugadores
   * @param {Object} teams - Datos de los equipos
   * @param {boolean} isInRoom - Si está en una sala
   * @returns {string} HTML del grid de jugadores
   */
  generatePlayersGridHTML(teams, isInRoom = false) {
    // Solo mostrar el grid de jugadores si está en una sala
    if (!isInRoom) {
      return '';
    }
    
    const teamA = teams.A || [];
    const teamB = teams.B || [];
    
    const teamAHTML = this.generateTeamHTML('A', teamA);
    const teamBHTML = this.generateTeamHTML('B', teamB);
    
    return `
      <div class="players" id="playersGrid">
        ${teamAHTML}
        ${teamBHTML}
      </div>
    `;
  }
  
  /**
   * Generar HTML de un equipo
   * @param {string} teamName - Nombre del equipo
   * @param {Array} players - Jugadores del equipo
   * @returns {string} HTML del equipo
   */
  generateTeamHTML(teamName, players) {
    const isOwner = this.adapter.isOwner();
    const currentPlayer = this.adapter.getCurrentPlayer();
    
    let playersHTML = '';
    
    // Renderizar jugadores existentes
    players.forEach(player => {
      playersHTML += this.generatePlayerSlotHTML(player, teamName, isOwner, currentPlayer);
    });
    
    // Agregar slots vacíos
    const emptySlots = GAME_CONFIG.MAX_PLAYERS_PER_TEAM - players.length;
    for (let i = 0; i < emptySlots; i++) {
      playersHTML += this.generatePlayerSlotHTML(null, teamName, isOwner, currentPlayer);
    }
    
    return `
      <div class="team">
        <h3>Equipo ${teamName} (${players.length}/${GAME_CONFIG.MAX_PLAYERS_PER_TEAM})</h3>
        <div class="team-players">
          ${playersHTML}
        </div>
      </div>
    `;
  }
  
  /**
   * Generar HTML de un slot de jugador
   * @param {Object|null} player - Datos del jugador
   * @param {string} team - Equipo
   * @param {boolean} isOwner - Si el jugador actual es owner
   * @param {Object} currentPlayer - Jugador actual
   * @returns {string} HTML del slot
   */
  generatePlayerSlotHTML(player, team, isOwner, currentPlayer) {
    if (player) {
      const isCurrentPlayer = player.id === currentPlayer?.uid;
      const isConnected = player.connected &&
        (Date.now() - (player.lastHeartbeat || 0)) < GAME_CONFIG.DISCONNECT_TIMEOUT;
      
      const statusIcon = isConnected ? '🟢' : '🔴';
      const kickButton = isOwner && !isCurrentPlayer ?
        `<button class="kick-btn" data-player-id="${player.id}" style="font-size:12px; padding:2px 6px; margin-left:8px;">✕</button>` : '';
      
      const meClass = isCurrentPlayer ? ' me' : '';
      
      return `
        <div class="pCard team${team}${meClass}">
          <div class="row" style="justify-content: space-between; align-items: center;">
            <div class="row">
              <span class="tag">${team}</span>
              <b>${player.name}</b>
              <span style="font-size:10px;">${statusIcon}</span>
            </div>
            ${kickButton}
          </div>
        </div>
      `;
    } else {
      return `
        <div class="pCard">
          <span class="muted">Vacante - Equipo ${team}</span>
        </div>
      `;
    }
  }
  
  /**
   * Generar HTML de controles del owner
   * @param {boolean} isOwner - Si es owner
   * @param {number} totalPlayers - Total de jugadores
   * @param {boolean} isInRoom - Si está en una sala
   * @returns {string} HTML de controles del owner
   */
  generateOwnerControlsHTML(isOwner, totalPlayers, isInRoom = false) {
    // Solo mostrar controles del owner si está en una sala
    if (!isInRoom) {
      return '';
    }
    
    const displayStyle = (isOwner && totalPlayers > 1) ? 'flex' : 'none';
    
    return `
      <div id="ownerControls" class="row" style="display:${displayStyle}; margin-top:10px; padding:10px; background:#1a1f2e; border-radius:8px;">
        <span class="muted">Controles del anfitrión:</span>
        <button id="btnKickPlayer" class="warning" style="display:none;">Expulsar jugador</button>
      </div>
    `;
  }
  
  /**
   * Generar HTML de controles inferiores
   * @param {Object} roomData - Datos de la sala
   * @param {boolean} isInRoom - Si está en una sala
   * @returns {string} HTML de controles inferiores
   */
  generateBottomControlsHTML(roomData, isInRoom) {
    // Solo mostrar controles inferiores si está en una sala
    if (!isInRoom) {
      return '';
    }
    
    const canStart = this.canStartGame(roomData.teams);
    const startDisabled = canStart ? '' : 'disabled';
    
    return `
      <div class="row" style="justify-content:space-between; margin-top:10px">
        <div>
          <b>Código:</b> <span id="codeOut" class="muted">${roomData.code || '—'}</span>
          <button id="btnLeaveRoom" class="warning" style="margin-left:10px;">Salir de la sala</button>
        </div>
        <div class="row">
          <button id="btnStart" class="primary" ${startDisabled}>Iniciar partida</button>
          <span class="muted" id="startRequirement">Se necesitan 2 jugadores por equipo</span>
        </div>
      </div>
    `;
  }
  
  /**
   * Verificar si se puede iniciar el juego
   * @param {Object} teams - Datos de los equipos
   * @returns {boolean} Si se puede iniciar
   */
  canStartGame(teams) {
    const isOwner = this.adapter.isOwner();
    const teamA = teams.A || [];
    const teamB = teams.B || [];
    
    return isOwner &&
      teamA.length === GAME_CONFIG.MAX_PLAYERS_PER_TEAM &&
      teamB.length === GAME_CONFIG.MAX_PLAYERS_PER_TEAM;
  }
  
  /**
   * Re-inicializar elementos del DOM del lobby
   */
  reinitializeLobbyElements() {
    // Actualizar referencias a elementos del lobby
    this.elements.displayName = document.getElementById('displayName');
    this.elements.teamPick = document.getElementById('teamPick');
    this.elements.btnCreate = document.getElementById('btnCreate');
    this.elements.btnJoin = document.getElementById('btnJoin');
    this.elements.roomCodeInput = document.getElementById('roomCode');
    this.elements.codeOut = document.getElementById('codeOut');
    this.elements.playersGrid = document.getElementById('playersGrid');
    this.elements.btnStart = document.getElementById('btnStart');
    this.elements.ownerControls = document.getElementById('ownerControls');
    this.elements.btnKickPlayer = document.getElementById('btnKickPlayer');
    this.elements.btnLeaveRoom = document.getElementById('btnLeaveRoom');
    this.elements.startRequirement = document.getElementById('startRequirement');
  }
  
  /**
   * Bindear eventos del lobby
   */
  bindLobbyEvents() {
    // Botones principales
    this.elements.btnCreate?.addEventListener('click', () => this.handleCreateGame());
    this.elements.btnJoin?.addEventListener('click', () => this.handleJoinGame());
    this.elements.btnStart?.addEventListener('click', () => this.handleStartGame());
    this.elements.btnLeaveRoom?.addEventListener('click', () => this.handleLeaveGame());
    this.elements.btnKickPlayer?.addEventListener('click', () => this.handleKickPlayer());
    
    // Input de nombre - limpiar errores al escribir y guardar en localStorage
    this.elements.displayName?.addEventListener('input', () => {
      this.hideError();
      this.savePlayerName();
    });
    
    // Input de código de sala - limpiar errores al escribir
    this.elements.roomCodeInput?.addEventListener('input', () => this.hideError());
    
    // Enter en código de sala
    this.elements.roomCodeInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleJoinGame();
      }
    });
    
    // Botones de kick individuales
    const kickButtons = document.querySelectorAll('.kick-btn');
    kickButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = btn.getAttribute('data-player-id');
        const playerName = btn.closest('.pCard').querySelector('b').textContent;
        this.selectedPlayerId = playerId;
        if (this.elements.btnKickPlayer) {
          this.elements.btnKickPlayer.style.display = 'inline-block';
          this.elements.btnKickPlayer.textContent = `Expulsar a ${playerName}`;
        }
      });
    });
  }
  
  // ==================== SISTEMA DECLARATIVO - VISTA DE JUEGO ====================
  
  /**
   * Renderizar vista de juego de forma declarativa (regeneración completa)
   * @param {Object} gameState - Estado del juego
   */
  renderGameDeclarative(gameState) {
    if (!gameState) {
      console.warn('renderGameDeclarative: gameState no proporcionado');
      return;
    }
    

    
    // Generar HTML completo de la vista de juego
    const gameHTML = this.generateGameHTML(gameState);
    
    // Reemplazar contenido completo
    if (this.elements.gamePanel) {
      this.elements.gamePanel.innerHTML = gameHTML;
    }
    
    // Re-inicializar elementos del DOM del juego (con pequeño delay para asegurar que el DOM se actualice)
    setTimeout(() => {
      this.reinitializeGameElements();
      
      // Re-bindear eventos del juego
      this.bindGameEvents();
    }, 0);
  }
  
  /**
   * Generar HTML completo de la vista de juego
   * @param {Object} gameState - Estado del juego
   * @returns {string} HTML de la vista de juego
   */
  generateGameHTML(gameState) {
    const gameInfoHTML = this.generateGameInfoHTML(gameState);
    const gameAreaHTML = this.generateGameAreaHTML(gameState);
    const playerHandHTML = this.generatePlayerHandHTML();
    const gameControlsHTML = this.generateGameControlsHTML(gameState);
    
    return `
      <h2>Partida en curso</h2>
      ${gameInfoHTML}
      ${gameAreaHTML}
      ${playerHandHTML}
      ${gameControlsHTML}
    `;
  }
  
  /**
   * Generar HTML de información del juego
   * @param {Object} gameState - Estado del juego
   * @returns {string} HTML de información del juego
   */
  generateGameInfoHTML(gameState) {
    const currentPlayerName = this.getPlayerName(gameState.currentTurn);
    const isMyTurn = this.adapter.isMyTurn();
    const turnIndicator = isMyTurn ? '🟢 Tu turno' : `🔴 Turno de ${currentPlayerName}`;
    
    return `
      <div class="game-info" style="background:#1a1f2e; padding:15px; border-radius:8px; margin-bottom:15px;">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div class="hp-display">
            <div class="team-hp">
              <span class="team-label">Equipo A:</span>
              <span id="hpA" class="hp-value">${gameState.hp?.A || 0}</span> HP
            </div>
            <div class="team-hp">
              <span class="team-label">Equipo B:</span>
              <span id="hpB" class="hp-value">${gameState.hp?.B || 0}</span> HP
            </div>
          </div>
          <div class="turn-indicator" id="turnIndicator">
            ${turnIndicator}
          </div>
        </div>
      </div>
    `;
  }
  
  /**
   * Generar HTML del área de juego
   * @param {Object} gameState - Estado del juego
   * @returns {string} HTML del área de juego
   */
  generateGameAreaHTML(gameState) {
    return `
      <div class="game-area" style="background:#2a2f3e; padding:20px; border-radius:8px; margin-bottom:15px; min-height:200px;">
        <div class="battlefield" style="text-align:center;">
          <h3>Campo de batalla</h3>
          <div class="battle-log" id="battleLog" style="background:#1a1f2e; padding:10px; border-radius:4px; max-height:150px; overflow-y:auto;">
            <!-- Los logs de batalla se mostrarán aquí -->
          </div>
        </div>
      </div>
    `;
  }
  
  /**
   * Generar HTML de la mano del jugador
   * @returns {string} HTML de la mano del jugador
   */
  generatePlayerHandHTML() {
    const hand = this.adapter.getMyHand();
    const isMyTurn = this.adapter.isMyTurn();
    
    const cardsHTML = hand.map((card, index) => {
      const cardData = CARD_LIBRARY[card.id];
      if (!cardData) return '';
      
      const playableClass = isMyTurn ? 'playable' : 'disabled';
      const clickHandler = isMyTurn ? `onclick="window.uiRenderer.handlePlayCard(${index})"` : '';
      
      return `
        <div class="card ${playableClass}" ${clickHandler}>
          <div class="card-name">${cardData.name}</div>
          <div class="card-type">${cardData.type}</div>
          <div class="card-description">${cardData.description}</div>
          ${cardData.damage ? `<div class="card-damage">⚔️ ${cardData.damage}</div>` : ''}
          ${cardData.healing ? `<div class="card-healing">❤️ ${cardData.healing}</div>` : ''}
          ${cardData.draw ? `<div class="card-draw">🃏 +${cardData.draw}</div>` : ''}
        </div>
      `;
    }).join('');
    
    return `
      <div class="player-hand" style="margin-bottom:15px;">
        <h3>Tu mano (${hand.length} cartas)</h3>
        <div id="handZone" class="hand-zone" style="display:flex; gap:10px; overflow-x:auto; padding:10px; background:#1a1f2e; border-radius:8px;">
          ${cardsHTML}
        </div>
      </div>
    `;
  }
  
  /**
   * Generar HTML de controles del juego
   * @param {Object} gameState - Estado del juego
   * @returns {string} HTML de controles del juego
   */
  generateGameControlsHTML(gameState) {
    const isMyTurn = this.adapter.isMyTurn();
    const endTurnDisabled = isMyTurn ? '' : 'disabled';
    
    return `
      <div class="game-controls" style="background:#1a1f2e; padding:15px; border-radius:8px;">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div class="turn-controls">
            <button id="btnEndTurn" class="primary" ${endTurnDisabled}>Terminar turno</button>
            <span class="muted" style="margin-left:10px;">
              ${isMyTurn ? 'Juega una carta o termina tu turno' : 'Esperando tu turno...'}
            </span>
          </div>
          <div class="game-actions">
            <button id="btnLeaveGame" class="warning">Abandonar partida</button>
          </div>
        </div>
      </div>
    `;
  }
  
  /**
   * Re-inicializar elementos del DOM del juego
   */
  reinitializeGameElements() {
    // Actualizar referencias a elementos del juego
    this.elements.hpA = document.getElementById('hpA');
    this.elements.hpB = document.getElementById('hpB');
    this.elements.turnIndicator = document.getElementById('turnIndicator');
    this.elements.battleLog = document.getElementById('battleLog');
    this.elements.handZone = document.getElementById('handZone');
    this.elements.btnEndTurn = document.getElementById('btnEndTurn');
    this.elements.btnLeaveGame = document.getElementById('btnLeaveGame');
  }
  
  /**
   * Bindear eventos del juego
   */
  bindGameEvents() {
    // Botón de terminar turno
    this.elements.btnEndTurn?.addEventListener('click', () => this.handleEndTurn());
    
    // Botón de abandonar partida
    this.elements.btnLeaveGame?.addEventListener('click', () => this.handleLeaveGame());
  }
  
  /**
   * Manejar terminar turno
   */
  async handleEndTurn() {
    try {
      await this.adapter.endTurn();
      this.log('Turno terminado');
    } catch (error) {
      this.showError(error.message);
    }
  }

  /**
   * Mostrar diálogo de fin de juego
   * @param {Object} data - Datos del fin de juego
   */
  showGameEndDialog(data) {
    // Implementación simple - se puede mejorar con un modal
    let message;
    
    if (data.winner === 'tie') {
      message = '¡Empate!\n\nAmbos equipos llegaron a 0 HP al mismo tiempo.';
    } else {
      message = `¡El Equipo ${data.winner} ganó!\n\n${data.reason}\n\nHP Final:\nEquipo A: ${data.finalHP.A}\nEquipo B: ${data.finalHP.B}`;
    }
    
    setTimeout(() => {
      alert(message);
    }, 1000);
  }
  
  /**
   * Obtener nombre de un jugador por ID
   * @param {string} playerId - ID del jugador
   * @returns {string} - Nombre del jugador
   */
  getPlayerName(playerId) {
    const players = this.adapter.getAllPlayers();
    const player = players.find(p => p.uid === playerId);
    return player ? player.name : 'Jugador desconocido';
  }
  
  /**
   * Cargar nombre guardado del localStorage
   */
  loadSavedPlayerName() {
    try {
      const savedName = localStorage.getItem('cardgame_player_name');
      if (savedName) {
        // Usar setTimeout para asegurar que el DOM esté renderizado
        setTimeout(() => {
          const displayNameElement = document.getElementById('displayName');
          if (displayNameElement) {
            displayNameElement.value = savedName;
          }
        }, 100);
      }
    } catch (error) {
      console.warn('Error cargando nombre guardado:', error);
    }
  }
  
  /**
   * Guardar nombre del jugador en localStorage
   */
  savePlayerName() {
    try {
      if (this.elements.displayName && this.elements.displayName.value.trim()) {
        localStorage.setItem('cardgame_player_name', this.elements.displayName.value.trim());
      }
    } catch (error) {
      console.warn('Error guardando nombre:', error);
    }
  }
  
  /**
   * Limpiar todo el estado del renderer
   */
  cleanup() {
    this.adapter.clearEvents();
    this.resetLobbyUI();
    this.switchToLobby();
  }
}

// DESHABILITADO: Instanciación automática comentada para evitar duplicación con main.js
// La instancia se crea ahora en main.js para evitar event listeners duplicados

// Solo exportar la clase
export { UIRenderer };
export default UIRenderer;