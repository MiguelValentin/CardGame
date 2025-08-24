// cleanup-service.js - Servicio para limpiar jugadores desconectados

import { GAME_CONFIG } from './config.js';
import { 
  getFirestore, 
  collection, 
  query, 
  where, 
  getDocs,
  doc, 
  updateDoc,
  getDoc 
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Este servicio se ejecuta en segundo plano para limpiar jugadores desconectados
// En una aplicación real, esto se haría mejor con Cloud Functions

class CleanupService {
  constructor(db) {
    this.db = db;
    this.cleanupInterval = null;
  }

  // Iniciar el servicio de limpieza
  start() {
    if (this.cleanupInterval) return;
    
    // Ejecutar limpieza cada 2 minutos
    this.cleanupInterval = setInterval(() => {
      this.cleanupDisconnectedPlayers();
    }, 120000);
    
    console.log('Cleanup service iniciado');
  }

  // Detener el servicio
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('Cleanup service detenido');
    }
  }

  // Limpiar jugadores desconectados de todas las salas
  async cleanupDisconnectedPlayers() {
    try {
      // Buscar salas activas en lobby (no queremos interrumpir juegos en curso)
      const roomsRef = collection(this.db, 'rooms');
      const lobbyRoomsQuery = query(roomsRef, where('status', '==', 'lobby'));
      const snapshot = await getDocs(lobbyRoomsQuery);
      
      for (const roomDoc of snapshot.docs) {
        await this.cleanupRoom(roomDoc.id, roomDoc.data());
      }
    } catch (error) {
      console.error('Error en cleanup service:', error);
    }
  }

  // Limpiar una sala específica
  async cleanupRoom(roomId, roomData) {
    try {
      // No procesar salas que no tienen owner (pueden estar siendo eliminadas)
      if (!roomData.owner) {
        console.log(`Saltando sala ${roomId} - no tiene owner (posiblemente siendo eliminada)`);
        return;
      }

      // No procesar salas marcadas como abandonadas
      if (roomData.status === 'abandoned') {
        console.log(`Saltando sala ${roomId} - ya está marcada como abandonada`);
        return;
      }

      const now = Date.now();
      let needsUpdate = false;
      const newTeams = { A: [], B: [] };

      // Revisar jugadores en ambos equipos
      ['A', 'B'].forEach(team => {
        if (roomData.teams && roomData.teams[team]) {
          roomData.teams[team].forEach(player => {
            const lastHeartbeat = player.lastHeartbeat || 0;
            const timeSinceHeartbeat = now - lastHeartbeat;
            
            // Si el jugador ha estado desconectado por más del timeout, no lo incluimos
            if (player.connected && timeSinceHeartbeat < GAME_CONFIG.DISCONNECT_TIMEOUT) {
              newTeams[team].push(player);
            } else if (timeSinceHeartbeat >= GAME_CONFIG.DISCONNECT_TIMEOUT) {
              needsUpdate = true;
              console.log(`Removiendo jugador desconectado: ${player.name} (${timeSinceHeartbeat}ms sin heartbeat)`);
            }
          });
        }
      });

      // Actualizar la sala si es necesario
      if (needsUpdate) {
        const roomRef = doc(this.db, 'rooms', roomId);
        
        // Verificar que la sala aún existe antes de actualizarla
        const roomSnap = await getDoc(roomRef);
        if (!roomSnap.exists()) {
          console.log(`Sala ${roomId} ya no existe - saltando actualización`);
          return;
        }
        
        await updateDoc(roomRef, {
          teams: newTeams
        });
        
        console.log(`Sala ${roomId} limpiada - jugadores desconectados removidos`);
      }
      
      // Si la sala quedó vacía, marcarla como abandonada
      const totalPlayers = newTeams.A.length + newTeams.B.length;
      if (totalPlayers === 0 && needsUpdate) {
        await this.markRoomAsAbandoned(roomId);
      }
      
    } catch (error) {
      console.error(`Error limpiando sala ${roomId}:`, error);
    }
  }

  // Marcar sala como abandonada (para limpieza posterior)
  async markRoomAsAbandoned(roomId) {
    try {
      const roomRef = doc(this.db, 'rooms', roomId);
      await updateDoc(roomRef, {
        status: 'abandoned',
        abandonedAt: Date.now()
      });
      
      console.log(`Sala ${roomId} marcada como abandonada`);
    } catch (error) {
      console.error(`Error marcando sala como abandonada ${roomId}:`, error);
    }
  }

  // Limpiar salas abandonadas (llamar ocasionalmente)
  async cleanupAbandonedRooms() {
    try {
      const roomsRef = collection(this.db, 'rooms');
      const abandonedQuery = query(roomsRef, where('status', '==', 'abandoned'));
      const snapshot = await getDocs(abandonedQuery);
      
      const now = Date.now();
      const oneHourAgo = now - (60 * 60 * 1000); // 1 hora
      
      for (const roomDoc of snapshot.docs) {
        const roomData = roomDoc.data();
        
        // Si la sala fue abandonada hace más de 1 hora, eliminarla
        if (roomData.abandonedAt && roomData.abandonedAt < oneHourAgo) {
          // En lugar de eliminar, podríamos mover a otra colección
          // o simplemente dejarlas para limpieza manual
          console.log(`Sala abandonada encontrada: ${roomDoc.id}`);
        }
      }
    } catch (error) {
      console.error('Error limpiando salas abandonadas:', error);
    }
  }
}

// Utilidades para debugging y administración manual
export class AdminUtils {
  constructor(db) {
    this.db = db;
  }

  // Listar todas las salas activas
  async listActiveRooms() {
    try {
      const roomsRef = collection(this.db, 'rooms');
      const activeQuery = query(roomsRef, where('status', 'in', ['lobby', 'active']));
      const snapshot = await getDocs(activeQuery);
      
      const rooms = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const totalPlayers = (data.teams?.A?.length || 0) + (data.teams?.B?.length || 0);
        rooms.push({
          id: doc.id,
          code: data.code,
          status: data.status,
          players: totalPlayers,
          created: data.createdAt,
          owner: data.owner
        });
      });
      
      return rooms;
    } catch (error) {
      console.error('Error listando salas:', error);
      return [];
    }
  }

  // Forzar limpieza de una sala específica
  async forceCleanupRoom(roomId) {
    try {
      const roomRef = doc(this.db, 'rooms', roomId);
      const roomSnap = await getDoc(roomRef);
      
      if (roomSnap.exists()) {
        const cleanupService = new CleanupService(this.db);
        await cleanupService.cleanupRoom(roomId, roomSnap.data());
        console.log(`Limpieza forzada completada para sala: ${roomId}`);
      } else {
        console.log(`Sala no encontrada: ${roomId}`);
      }
    } catch (error) {
      console.error('Error en limpieza forzada:', error);
    }
  }

  // Estadísticas del servidor
  async getServerStats() {
    try {
      const rooms = await this.listActiveRooms();
      const lobbyRooms = rooms.filter(r => r.status === 'lobby');
      const activeRooms = rooms.filter(r => r.status === 'active');
      const totalPlayers = rooms.reduce((sum, r) => sum + r.players, 0);
      
      return {
        totalRooms: rooms.length,
        lobbyRooms: lobbyRooms.length,
        activeGames: activeRooms.length,
        totalPlayers,
        averagePlayersPerRoom: totalPlayers / (rooms.length || 1)
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      return null;
    }
  }
}

// Inicializar el servicio de limpieza
export function initCleanupService(db) {
  const cleanupService = new CleanupService(db);
  
  // Solo iniciar en una pestaña para evitar múltiples instancias
  // Usar localStorage para coordinar entre pestañas
  const isMainTab = !localStorage.getItem('cleanup-service-active');
  
  if (isMainTab) {
    localStorage.setItem('cleanup-service-active', 'true');
    cleanupService.start();
    
    // Limpiar cuando se cierre la pestaña
    window.addEventListener('beforeunload', () => {
      localStorage.removeItem('cleanup-service-active');
      cleanupService.stop();
    });
    
    // Limpiar salas abandonadas cada 30 minutos
    setInterval(() => {
      cleanupService.cleanupAbandonedRooms();
    }, 30 * 60 * 1000);
  }
  
  return cleanupService;
}

export { CleanupService };