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
    console.error(`❌ Error [${label}]:`, data);
  } else {
    console.log(`✅ OK [${label}]`);
  }
}

async function migrate() {
  console.log('🚀 Iniciando migración de base de datos...\n');

  // 1. Actualizar el ENUM de status con todos los estados del nuevo flujo
  await runQuery(`
    ALTER TABLE requests
    MODIFY COLUMN status ENUM(
      'pendiente',
      'en_negociacion_entrega',
      'cancelado_por_tecnico',
      'en_diagnostico',
      'producto_no_recibido',
      'esperando_respuesta_cliente',
      'en_reparacion',
      'en_negociacion_devolucion',
      'en_devolucion',
      'finalizado',
      'en_revision',
      'solicitud_finalizada',
      'consulta_denegada',
      'reparacion_aceptada',
      'en_proceso_de_devolucion',
      'reparacion_completa'
    ) DEFAULT 'pendiente'
  `, 'Actualizar ENUM status');

  // 2. Agregar columna tech_response para mensajes del técnico al cliente
  await runQuery(`
    ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS tech_response TEXT NULL AFTER additional_info
  `, 'Agregar columna tech_response');

  // 3. Agregar columna assigned_tech_id para tracking del técnico asignado
  await runQuery(`
    ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS assigned_tech_id INT NULL AFTER tech_response
  `, 'Agregar columna assigned_tech_id');

  console.log('\n✅ Migración completada.');
}

migrate();
