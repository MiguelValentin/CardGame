# Notas Técnicas - CardGame

## Problemas Críticos Resueltos y Consideraciones de Mantenimiento

### ⚠️ IMPORTANTE: NO MODIFICAR SIN REVISAR ESTAS NOTAS

Este documento detalla problemas críticos que fueron resueltos durante el desarrollo. Antes de realizar optimizaciones o simplificaciones del código, revisar estas notas para evitar regresiones.

---

## 1. Problema: Salas Reaparecen Después de Eliminación

### 🐛 Descripción del Problema
- **Síntoma**: Las salas eliminadas por el owner reaparecían en la base de datos
- **Causa Raíz**: Condición de carrera entre el heartbeat y la eliminación de sala
- **Impacto**: Salas "fantasma" en Firestore, confusión de usuarios

### ✅ Solución Implementada

#### A. Detener Heartbeat ANTES de Eliminar
```javascript
// En leaveRoom() - CRÍTICO: Este orden es importante
RoomManager.stopHeartbeat(); // PRIMERO
// Luego eliminar sala
```

#### B. Eliminación Completa de Subcolecciones
```javascript
// Firestore NO elimina subcolecciones automáticamente
// Eliminar manualmente la subcolección 'players'
const playersRef = collection(db, 'rooms', gameState.roomId, 'players');
const playersSnapshot = await getDocs(playersRef);
const deletePromises = playersSnapshot.docs.map(playerDoc => 
  deleteDoc(playerDoc.ref)
);
await Promise.all(deletePromises);

// DESPUÉS eliminar documento principal
await deleteDoc(roomRef);
```

### 🚨 NO CAMBIAR:
1. **Orden de eliminación**: Heartbeat → Subcolecciones → Documento principal
2. **Imports requeridos**: `collection`, `getDocs` son necesarios
3. **Eliminación explícita de subcolecciones**: Firestore no las elimina automáticamente

---

## 2. Problema: Condición de Carrera en Sincronización Cross-Browser

### 🐛 Descripción del Problema
- **Síntoma**: El segundo jugador se unía exitosamente pero era expulsado inmediatamente
- **Causa Raíz**: Condición de carrera entre la actualización de Firebase y el listener de verificación
- **Impacto**: Imposibilidad de jugar con múltiples jugadores, sincronización cross-browser fallaba

### ✅ Solución Implementada

#### A. Protección Temporal Contra Expulsión
```javascript
// En subscribeToRoom() - game-engine.js
// Solo expulsar si el jugador definitivamente no existe Y no es el owner
if (!playerExists && this.room.id && this.player.uid !== roomData.owner) {
  // Si acabamos de unirse (menos de 5 segundos), no expulsar aún
  const now = Date.now();
  const joinTime = this.joinTimestamp || 0;
  const timeSinceJoin = now - joinTime;
  
  if (timeSinceJoin < 5000) {
    console.log('🔍 DEBUG - Posible condición de carrera, esperando...');
    return; // No expulsar durante los primeros 5 segundos
  }
}
```

#### B. Timestamp de Unión
```javascript
// Marcar tiempo de unión en joinGame() y createGame()
this.joinTimestamp = Date.now();
```

### 🚨 NO CAMBIAR:
1. **Ventana de gracia de 5 segundos**: Necesaria para evitar expulsiones por condiciones de carrera
2. **Verificación de owner**: Los owners nunca deben ser expulsados automáticamente
3. **Timestamp de unión**: Crítico para calcular el tiempo transcurrido
4. **Logs de debug**: Facilitan la identificación de problemas futuros

### 📝 Contexto Técnico
Cuando un jugador se une a una sala:
1. La transacción de Firebase se completa exitosamente
2. Firebase notifica el cambio a todos los listeners
3. El listener verifica si el jugador existe en los equipos
4. **PROBLEMA**: Los datos pueden llegar de una versión anterior donde el jugador aún no estaba
5. **SOLUCIÓN**: Dar tiempo de gracia antes de expulsar

---

## 3. Problema: Validación de Jugadores en Múltiples Salas

### 🐛 Descripción del Problema
- **Síntoma**: Jugadores podían unirse a múltiples salas simultáneamente
- **Causa**: Falta de validación en `createRoom` y `joinByCode`
- **Impacto**: Estado inconsistente, bugs de sincronización

### ✅ Solución Implementada

#### Validación en Creación y Unión
```javascript
// Verificar si ya está en una sala ANTES de crear/unirse
if (gameState.roomId) {
  dom.log(ERROR_MESSAGES.ALREADY_IN_ROOM);
  return;
}
```

### 🚨 NO CAMBIAR:
1. **Validación temprana**: Verificar `gameState.roomId` antes de operaciones
2. **Mensajes de error**: Usar `ERROR_MESSAGES.ALREADY_IN_ROOM`

---

## 3. Problema: Interfaz Confusa en Estados de Sala

### 🐛 Descripción del Problema
- **Síntoma**: Botones de crear/unirse visibles cuando ya estás en sala
- **Causa**: UI no reflejaba el estado actual del jugador
- **Impacto**: Experiencia de usuario confusa

### ✅ Solución Implementada

#### Gestión de Estado de UI
```javascript
// Ocultar/mostrar botones según estado
if (gameState.roomId) {
  // En sala: mostrar botón salir, ocultar crear/unirse
  dom.elements.btnLeave.style.display = 'block';
  dom.elements.btnCreate.style.display = 'none';
  dom.elements.btnJoin.style.display = 'none';
}
```

### 🚨 NO CAMBIAR:
1. **Lógica de visibilidad**: Basada en `gameState.roomId`
2. **Botón "Salir de la sala"**: Esencial para UX

---

## 4. Problema: Servicio de Limpieza Interfiere con Eliminación

### 🐛 Descripción del Problema
- **Síntoma**: El cleanup service podía recrear salas recién eliminadas
- **Causa**: Verificaciones insuficientes en cleanup-service.js
- **Impacto**: Salas eliminadas reaparecían

### ✅ Solución Implementada

#### Verificaciones en Cleanup Service
```javascript
// No procesar salas sin owner (siendo eliminadas)
if (!roomData.owner) {
  console.log(`Saltando sala ${roomId} - no tiene owner`);
  return;
}

// Verificar existencia antes de actualizar
const roomSnap = await getDoc(roomRef);
if (!roomSnap.exists()) {
  console.log(`Sala ${roomId} ya no existe`);
  return;
}
```

### 🚨 NO CAMBIAR:
1. **Verificación de owner**: Saltar salas sin owner
2. **Verificación de existencia**: Antes de cualquier actualización

---

## 5. Problema: Condición de Carrera al Unirse a Equipos

### 🐛 Descripción del Problema
- **Síntoma**: Cuando múltiples jugadores intentan unirse al mismo equipo simultáneamente, solo el último jugador aparece en el slot
- **Causa Raíz**: Race condition en `addPlayerToTeam()` - múltiples jugadores leen el estado actual, verifican disponibilidad, y actualizan simultáneamente
- **Impacto**: El último en escribir sobrescribe a los anteriores

### ✅ Solución Implementada

#### Transacciones Atómicas
```javascript
// Usar transacciones atómicas en addPlayerToTeam()
await runTransaction(db, async (transaction) => {
  const roomSnap = await transaction.get(roomRef);
  const roomData = roomSnap.data();
  
  // Verificaciones dentro de la transacción
  if (teams[selectedTeam].length >= GAME_CONFIG.MAX_PLAYERS_PER_TEAM) {
    throw new Error(errorMessage);
  }
  
  // Actualización atómica
  transaction.update(roomRef, { teams: newTeams });
});
```

### 🚨 NO CAMBIAR:
1. **Uso de transacciones**: Para operaciones que requieren consistencia
2. **Verificaciones dentro de transacción**: Evita condiciones de carrera
3. **Import de runTransaction**: Necesario para operaciones atómicas

---

## Soluciones Implementadas

### 1. Centralización de Limpieza de Estado

**Problema**: Lógica de limpieza dispersa por todo el código
- Múltiples lugares con `gameState.roomId = null`
- Repetición de `dom.hideError()`, `dom.showLoading(false)`
- Inconsistencias en el reseteo de UI
- Código duplicado para volver al lobby

**Solución**: Clase `StateManager` centralizada
- `StateManager.resetToLobby()`: Limpieza completa con opciones configurables
- `StateManager.clearErrorsAndLoading()`: Limpieza rápida de errores y loading
- `StateManager.handleOperationError()`: Manejo consistente de errores
- `StateManager.smartReload()`: Alternativa inteligente a `location.reload()`

**Beneficios**:
- Código más mantenible y consistente
- Menos duplicación
- Limpieza más confiable
- Botón "Recargar" más eficiente (no recarga la página)

### 2. Problema: Mensajes de Error Genéricos y Orden de Operaciones

### 🐛 Descripción del Problema
- **Síntoma**: Cuando `addPlayerToTeam()` falla (ej: equipo lleno), se muestra "Error de conexión" en lugar del mensaje específico, Y el jugador aún entra a la sala
- **Causa Raíz**: 
  1. Los bloques catch mostraban `ERROR_MESSAGES.CONNECTION_ERROR` genérico
  2. `joinAsPlayer()` se ejecutaba ANTES que `addPlayerToTeam()`, por lo que si addPlayerToTeam fallaba, el jugador ya estaba en la sala
- **Impacto**: 
  1. Usuario ve "Error de conexión" en lugar de mensajes informativos
  2. Jugador puede ver la sala aunque no esté en ningún equipo

### ✅ Solución Implementada

#### Orden Correcto de Operaciones y Propagación de Mensajes
```javascript
// 1. Configurar roomId
gameState.roomId = roomId;

// 2. Primero verificar que se puede agregar al equipo
await RoomManager.addPlayerToTeam();

// 3. Solo entonces unirse a la sala
await RoomManager.joinAsPlayer(roomId, true);

// 4. Mostrar mensaje específico en caso de error
const errorMessage = error.message || ERROR_MESSAGES.CONNECTION_ERROR;
dom.showError(errorMessage);
```

### 🚨 NO CAMBIAR:
1. **Orden de operaciones**: addPlayerToTeam() ANTES que joinAsPlayer()
2. **Propagación de error.message**: Permite mostrar errores específicos
3. **Fallback a CONNECTION_ERROR**: Para errores sin mensaje específico
4. **Limpieza de gameState.roomId**: En bloques catch para evitar estado inconsistente

---

## 6. Problema: Estado Inconsistente Después de Error

### 🐛 Descripción del Problema
- **Síntoma**: Cuando un jugador no puede unirse a un equipo lleno y luego intenta cambiar equipo/sala, recibe "Ya estás en una sala. Sal de la sala actual antes de crear o unirte a otra."
- **Causa Raíz**: Cuando `addPlayerToTeam()` falla, `gameState.roomId` ya se estableció pero no se limpia en el bloque `catch`
- **Impacto**: El sistema piensa que el jugador sigue en una sala aunque nunca se unió realmente

### ✅ Solución Implementada

#### Limpieza de Estado en Bloques Catch
```javascript
} catch (error) {
  console.error('Error creando/uniéndose a sala:', error);
  
  // Limpiar estado si falló la operación
  gameState.roomId = null;
  
  // Mostrar mensaje específico
  const errorMessage = error.message || ERROR_MESSAGES.CONNECTION_ERROR;
  dom.showError(errorMessage);
  dom.showLoading(false);
}
```

### 🚨 NO CAMBIAR:
1. **Limpieza obligatoria**: Siempre limpiar `gameState.roomId = null` en bloques catch
2. **Orden de limpieza**: Limpiar estado ANTES de mostrar error
3. **Consistencia**: Aplicar en ambas funciones `createRoom()` y `joinByCode()`

---

## 📋 Checklist de Mantenimiento

Antes de modificar código relacionado con salas:

- [ ] ¿Se mantiene el orden de eliminación (heartbeat → subcolecciones → documento)?
- [ ] ¿Se valida que el jugador no esté ya en una sala?
- [ ] ¿La UI refleja correctamente el estado del jugador?
- [ ] ¿El cleanup service tiene las verificaciones necesarias?
- [ ] ¿Se eliminan explícitamente las subcolecciones?
- [ ] ¿Se usan transacciones para operaciones que requieren consistencia?

---

## 🔧 Imports Críticos

Estos imports son necesarios para el funcionamiento correcto:

```javascript
// En game.js - NO REMOVER
import {
  // ... otros imports
  collection,  // Para acceder a subcolecciones
  getDocs      // Para obtener documentos de subcolecciones
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
```

---

## 📝 Historial de Cambios

- **2024-01**: Implementación inicial de validaciones
- **2024-01**: Solución a problema de salas reapareciendo
- **2024-01**: Mejoras en UI y experiencia de usuario
- **2024-01**: Optimización del servicio de limpieza

---

## 7. Nueva Arquitectura Modular (2024-01)

### 🎯 Problema Resuelto: Código Legacy Monolítico

#### 🐛 Descripción del Problema Anterior
- **Síntoma**: Todo el código estaba en un solo archivo `game.js` de 800+ líneas
- **Causa Raíz**: Lógica de juego, networking, UI y Firebase mezcladas
- **Impacto**: Difícil mantenimiento, testing y escalabilidad

### ✅ Nueva Arquitectura Implementada

#### A. Separación de Responsabilidades
```
js/
├── main.js              # Punto de entrada y coordinación
├── game-engine.js       # Abstracción de Firebase y networking
├── card-game-logic.js   # Lógica específica del juego de cartas
├── card-game-adapter.js # Puente entre GameEngine y CardGameLogic
├── ui-renderer.js       # Renderizado y manejo de UI
└── config.js           # Configuración (sin cambios)
```

#### B. Clases Principales

**GameEngine**: Abstrae Firebase y networking
- Manejo de salas (crear, unirse, salir)
- Autenticación y gestión de jugadores
- Sistema de eventos para comunicación
- Heartbeat y limpieza automática

**CardGameLogic**: Lógica pura del juego
- Mecánicas de cartas (robar, barajar, efectos)
- Gestión de turnos y condiciones de victoria
- Estado del juego independiente de networking

**CardGameAdapter**: Puente entre capas
- Sincroniza estado local con Firebase
- Traduce eventos de UI a acciones de juego
- Maneja la comunicación bidireccional

**UIRenderer**: Manejo de interfaz
- Renderizado de estado de juego
- Event listeners de UI
- Transiciones entre lobby y juego

#### C. Sistema de Eventos
```javascript
// Comunicación entre capas
GameEngine → CardGameAdapter → UIRenderer
     ↑              ↓              ↓
  Firebase    CardGameLogic    DOM Events
```

### 🚨 Migración del Código Legacy

#### Archivo `game.js` → Nueva Arquitectura
- **NO ELIMINAR** `game.js` hasta verificar que todo funciona
- `index.html` ahora carga `main.js` en lugar de `game.js`
- Compatibilidad mantenida con `window.GameDebug.StateManager`

#### Imports Dinámicos
```javascript
// En main.js - Evita dependencias circulares
const gameEngineModule = await import('./game-engine.js');
const GameEngine = gameEngineModule.GameEngine;
```

### ✅ Beneficios de la Nueva Arquitectura

1. **Mantenibilidad**: Cada clase tiene una responsabilidad clara
2. **Testabilidad**: Lógica de juego separada de Firebase
3. **Escalabilidad**: Fácil agregar nuevos tipos de juegos
4. **Reutilización**: GameEngine puede usarse para otros juegos
5. **Debugging**: Mejor separación para identificar problemas

### 🚨 NO CAMBIAR (Compatibilidad)

1. **window.GameDebug**: Mantenido para debugging y botón "Recargar"
2. **StateManager.smartReload()**: Funciona con nueva arquitectura
3. **Estructura HTML**: Sin cambios en elementos DOM
4. **Firebase config**: Sin modificaciones

### 📋 Checklist de Migración

Antes de eliminar `game.js`:

- [ ] ¿Funciona la creación de salas?
- [ ] ¿Funciona unirse a salas?
- [ ] ¿Funciona el sistema de turnos?
- [ ] ¿Funciona el botón "Recargar"?
- [ ] ¿Se mantienen todas las validaciones críticas?
- [ ] ¿El cleanup automático sigue funcionando?

---

**Nota**: Este documento debe actualizarse cada vez que se resuelva un problema crítico o se implemente una solución importante.