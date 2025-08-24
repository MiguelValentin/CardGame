/**
 * Main - Archivo principal que integra toda la nueva arquitectura
 * Reemplaza el archivo game.js legacy con la nueva estructura modular
 */

// Importar módulos de la nueva arquitectura
// Nota: Los imports se cargarán dinámicamente para evitar problemas de dependencias circulares

// Clases que se cargarán dinámicamente
let UIRenderer, CardGameAdapter, GameEngine, CardGameLogic;

/**
 * Clase principal de la aplicación
 */
class CardGameApp {
  constructor() {
    this.uiRenderer = null;
    this.isInitialized = false;
  }

  /**
   * Inicializar la aplicación
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      console.log('Inicializando Card Game App...');
      
      // Cargar módulos dinámicamente
      await this.loadModules();
      
      // Crear y configurar UI Renderer
      this.uiRenderer = new UIRenderer();
      await this.uiRenderer.initialize();
      
      // Exponer globalmente para debugging
      this.exposeGlobals();
      
      this.isInitialized = true;
      console.log('Card Game App inicializada correctamente');
      
    } catch (error) {
      console.error('Error inicializando aplicación:', error);
      throw error;
    }
  }
  
  /**
   * Cargar módulos dinámicamente
   */
  async loadModules() {
    try {
      // Cargar módulos en orden de dependencias
      const gameEngineModule = await import('./game-engine.js');
      GameEngine = gameEngineModule.GameEngine;
      
      const cardGameLogicModule = await import('./card-game-logic.js');
      CardGameLogic = cardGameLogicModule.CardGameLogic;
      
      const cardGameAdapterModule = await import('./card-game-adapter.js');
      CardGameAdapter = cardGameAdapterModule.CardGameAdapter;
      
      const uiRendererModule = await import('./ui-renderer.js');
      UIRenderer = uiRendererModule.UIRenderer;
      
      console.log('Módulos cargados correctamente');
    } catch (error) {
      console.error('Error cargando módulos:', error);
      throw error;
    }
  }
  
  /**
   * Exponer objetos globalmente para debugging y compatibilidad
   */
  exposeGlobals() {
    // Crear objeto de debugging global
    window.GameDebug = window.GameDebug || {};
    
    // Exponer clases principales
    window.GameDebug.CardGameApp = CardGameApp;
    window.GameDebug.UIRenderer = UIRenderer;
    window.GameDebug.CardGameAdapter = CardGameAdapter;
    window.GameDebug.GameEngine = GameEngine;
    window.GameDebug.CardGameLogic = CardGameLogic;
    
    // Exponer instancias
    window.GameDebug.app = this;
    window.GameDebug.uiRenderer = this.uiRenderer;
    window.GameDebug.adapter = this.uiRenderer?.adapter;
    
    // Mantener compatibilidad con el StateManager del archivo legacy
    window.GameDebug.StateManager = {
      smartReload: () => {
        console.log('Ejecutando smart reload con nueva arquitectura...');
        try {
          // Limpiar estado actual
          if (this.uiRenderer) {
            this.uiRenderer.cleanup();
          }
          
          // Reinicializar
          this.initialize().then(() => {
            console.log('Smart reload completado');
          }).catch(error => {
            console.error('Error en smart reload:', error);
            location.reload(); // Fallback
          });
        } catch (error) {
          console.error('Error durante smart reload:', error);
          location.reload(); // Fallback
        }
      },
      
      resetToLobby: () => {
        console.log('Reseteando a lobby con nueva arquitectura...');
        if (this.uiRenderer) {
          this.uiRenderer.handleLeaveGame();
        }
      },
      
      clearErrorsAndLoading: () => {
        if (this.uiRenderer) {
          this.uiRenderer.hideError();
          this.uiRenderer.showLoading(false);
        }
      }
    };
    
    console.log('Objetos globales expuestos en window.GameDebug');
  }
  
  /**
   * Obtener información del estado actual
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      hasUIRenderer: !!this.uiRenderer,
      inRoom: this.uiRenderer?.adapter?.isInRoom() || false,
      isOwner: this.uiRenderer?.adapter?.isOwner() || false,
      currentPlayer: this.uiRenderer?.adapter?.getCurrentPlayer() || null,
      currentRoom: this.uiRenderer?.adapter?.getCurrentRoom() || null
    };
  }
  
  /**
   * Limpiar toda la aplicación
   */
  cleanup() {
    if (this.uiRenderer) {
      this.uiRenderer.cleanup();
    }
    
    this.isInitialized = false;
    console.log('Aplicación limpiada');
  }
}

// Crear instancia global de la aplicación
const app = new CardGameApp();

// Función de inicialización global
window.initializeCardGame = async () => {
  try {
    await app.initialize();
    return app;
  } catch (error) {
    console.error('Error inicializando juego:', error);
    throw error;
  }
};

// Auto-inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.initializeCardGame().catch(error => {
      console.error('Error en auto-inicialización:', error);
    });
  });
} else {
  // DOM ya está listo
  window.initializeCardGame().catch(error => {
    console.error('Error en auto-inicialización:', error);
  });
}

// Exponer globalmente
window.CardGameApp = CardGameApp;
window.cardGameApp = app;

export { CardGameApp, app };
export default CardGameApp;