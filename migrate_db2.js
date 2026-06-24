const API = 'https://spiderwebargapi.com.ar/api/v1';
const KEY = '4a461c83d6f9a3d76a4bf436820fca629290e49422bfe9e9b48d603b7567a1d0';
const DB = 'sw_Franco Calegari_TechCareWeb';

async function runQuery(query, label) {
  const res = await fetch(`${API}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
    body: JSON.stringify({ database: DB, query })
  });
  const data = await res.json();
  if (!data.success) {
    console.error(`❌ [${label}]:`, JSON.stringify(data));
  } else {
    console.log(`✅ [${label}]`);
  }
}

async function migrate() {
  console.log('🚀 Migración v2 — Flujo 9 estados + Chat\n');

  // 1. ENUM actualizado con todos los estados del flujo optimizado
  await runQuery(`
    ALTER TABLE requests
    MODIFY COLUMN status ENUM(
      'pendiente',
      'en_revision',
      'en_coordinacion',
      'en_recepcion',
      'en_diagnostico',
      'esperando_aprobacion',
      'en_reparacion',
      'esperando_repuestos',
      'listo_para_retiro',
      'completado',
      'cancelado',
      'en_negociacion_entrega',
      'cancelado_por_tecnico',
      'producto_no_recibido',
      'esperando_respuesta_cliente',
      'en_negociacion_devolucion',
      'en_devolucion',
      'finalizado',
      'en_proceso_de_devolucion',
      'reparacion_aceptada',
      'reparacion_completa',
      'solicitud_finalizada',
      'consulta_denegada'
    ) DEFAULT 'pendiente'
  `, 'ENUM 9 estados');

  // 2. Tabla de mensajes de chat
  await runQuery(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      sender_id INT NOT NULL,
      sender_role ENUM('client', 'technician', 'bot') NOT NULL DEFAULT 'client',
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
    )
  `, 'Tabla messages');

  // 3. Columna tiempo estimado para el estado actual
  await runQuery(`
    ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS estimated_time VARCHAR(60) NULL AFTER status
  `, 'Columna estimated_time');

  console.log('\n✅ Migración v2 completada.');
}

migrate();
