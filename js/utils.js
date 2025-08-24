// utils.js - Utilidades adicionales para el juego

// ==================== SISTEMA DE NOTIFICACIONES ====================

export class NotificationSystem {
  static create(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Estilos inline para evitar dependencias CSS
    Object.assign(notification.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '12px 20px',
      borderRadius: '8px',
      color: 'white',
      fontFamily: 'inherit',
      fontSize: '14px',
      zIndex: '9999',
      maxWidth: '300px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transform: 'translateX(100%)',
      transition: 'transform 0.3s ease-out',
      backgroundColor: this.getColor(type)
    });
    
    document.body.appendChild(notification);
    
    // Animar entrada
    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Auto-remover
    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, duration);
    
    return notification;
  }
  
  static getColor(type) {
    const colors = {
      info: '#246bff',
      success: '#14e191',
      warning: '#ff9500',
      error: '#ff6b6b'
    };
    return colors[type] || colors.info;
  }
  
  static success(message, duration) {
    return this.create(message, 'success', duration);
  }
  
  static error(message, duration) {
    return this.create(message, 'error', duration);
  }
  
  static warning(message, duration) {
    return this.create(message, 'warning', duration);
  }
}

// ==================== GESTIÓN DE SONIDOS ====================

export class SoundManager {
  constructor() {
    this.enabled = true;
    this.volume = 0.3;
    this.sounds = new Map();
  }
  
  // Crear sonidos usando Web Audio API
  createTone(frequency, duration, type = 'sine') {
    if (!this.enabled) return Promise.resolve();
    
    return new Promise((resolve) => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      
      gainNode.gain.setValueAtTime(this.volume, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration);
      
      setTimeout(resolve, duration * 1000);
    });
  }
  
  // Sonidos del juego
  async playCardSound() {
    await this.createTone(440, 0.1, 'triangle');
  }
  
  async playTurnSound() {
    await this.createTone(660, 0.15, 'sine');
  }
  
  async playErrorSound() {
    await this.createTone(200, 0.2, 'square');
  }
  
  async playWinSound() {
    await this.createTone(880, 0.3, 'sine');
    await this.createTone(1100, 0.3, 'sine');
  }
  
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
  
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }
}

// ==================== VALIDACIONES AVANZADAS ====================

export class ValidationUtils {
  static sanitizeInput(input, maxLength = 50) {
    return input
      .trim()
      .substring(0, maxLength)
      .replace(/[<>'"&]/g, ''); // Remover caracteres peligrosos
  }
  
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  static isValidUsername(username) {
    const usernameRegex = /^[a-zA-Z0-9_-]{2,20}$/;
    return usernameRegex.test(username);
  }
  
  static hasOnlyAllowedChars(input) {
    const allowedRegex = /^[a-zA-Z0-9\s\-_áéíóúñü]+$/i;
    return allowedRegex.test(input);
  }
}

// ==================== MANEJO DE ERRORES ====================

export class ErrorHandler {
  static log(error, context = '') {
    const timestamp = new Date().toISOString();
    const errorInfo = {
      timestamp,
      context,
      message: error.message,
      stack: error.stack,
      userAgent: navigator.userAgent
    };
    
    console.error('Game Error:', errorInfo);
    
    // En producción, aquí enviarías el error a un servicio de logging
    // this.sendToLoggingService(errorInfo);
  }
  
  static handleFirebaseError(error) {
    const firebaseErrors = {
      'permission-denied': 'No tienes permisos para realizar esta acción',
      'not-found': 'El recurso solicitado no existe',
      'already-exists': 'El recurso ya existe',
      'resource-exhausted': 'Se ha excedido el límite de uso',
      'failed-precondition': 'La operación no se puede completar en el estado actual',
      'unavailable': 'El servicio no está disponible temporalmente'
    };
    
    return firebaseErrors[error.code] || 'Error de conexión. Inténtalo de nuevo.';
  }
}

// ==================== ALMACENAMIENTO LOCAL ====================

export class LocalStorage {
  static setItem(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn('No se pudo guardar en localStorage:', error);
      return false;
    }
  }
  
  static getItem(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.warn('No se pudo leer de localStorage:', error);
      return defaultValue;
    }
  }
  
  static removeItem(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn('No se pudo eliminar de localStorage:', error);
      return false;
    }
  }
  
  static clear() {
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      console.warn('No se pudo limpiar localStorage:', error);
      return false;
    }
  }
}

// ==================== UTILIDADES DE TIEMPO ====================

export class TimeUtils {
  static formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  static formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `hace ${days} día${days > 1 ? 's' : ''}`;
    if (hours > 0) return `hace ${hours} hora${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    return 'hace un momento';
  }
  
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ==================== UTILIDADES DE ANIMACIÓN ====================

export class AnimationUtils {
  static fadeIn(element, duration = 300) {
    element.style.opacity = '0';
    element.style.display = 'block';
    
    return this.animate(element, [
      { opacity: 0 },
      { opacity: 1 }
    ], duration);
  }
  
  static fadeOut(element, duration = 300) {
    return this.animate(element, [
      { opacity: 1 },
      { opacity: 0 }
    ], duration).then(() => {
      element.style.display = 'none';
    });
  }
  
  static slideIn(element, direction = 'right', duration = 300) {
    const transforms = {
      right: ['translateX(100%)', 'translateX(0)'],
      left: ['translateX(-100%)', 'translateX(0)'],
      up: ['translateY(-100%)', 'translateY(0)'],
      down: ['translateY(100%)', 'translateY(0)']
    };
    
    element.style.transform = transforms[direction][0];
    element.style.display = 'block';
    
    return this.animate(element, [
      { transform: transforms[direction][0] },
      { transform: transforms[direction][1] }
    ], duration);
  }
  
  static bounce(element, intensity = 10, duration = 600) {
    return this.animate(element, [
      { transform: 'translateY(0)' },
      { transform: `translateY(-${intensity}px)` },
      { transform: 'translateY(0)' },
      { transform: `translateY(-${intensity/2}px)` },
      { transform: 'translateY(0)' }
    ], duration);
  }
  
  static animate(element, keyframes, duration, options = {}) {
    return element.animate(keyframes, {
      duration,
      easing: 'ease-out',
      fill: 'forwards',
      ...options
    }).finished;
  }
}

// ==================== UTILIDADES DE PERFORMANCE ====================

export class PerformanceUtils {
  static debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        timeout = null;
        if (!immediate) func(...args);
      };
      const callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func(...args);
    };
  }
  
  static throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
  
  static measurePerformance(name, fn) {
    return async (...args) => {
      const start = performance.now();
      const result = await fn(...args);
      const end = performance.now();
      console.log(`${name} took ${end - start} milliseconds`);
      return result;
    };
  }
}

// ==================== EXPORTAR INSTANCIAS ====================

// Instancias globales para fácil acceso
export const soundManager = new SoundManager();
export const notifications = NotificationSystem;