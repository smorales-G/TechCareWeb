const API = 'https://spiderwebargapi.com.ar/api/v1';
const KEY = '4a461c83d6f9a3d76a4bf436820fca629290e49422bfe9e9b48d603b7567a1d0';
const DB = 'sw_Franco Calegari_TechCareWeb';

async function runQuery(query) {
  const res = await fetch(`${API}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
    body: JSON.stringify({ database: DB, query })
  });
  const data = await res.json();
  if (!data.success) {
    console.error(`Error in query: ${query}`, data);
  } else {
    console.log(`Success: ${query.substring(0, 50)}...`);
  }
}

async function init() {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      password VARCHAR(255) NOT NULL,
      email VARCHAR(100) NOT NULL UNIQUE,
      profile_picture VARCHAR(255),
      role ENUM('client', 'technician', 'admin') DEFAULT 'client',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_id INT NOT NULL,
      title VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      additional_info TEXT,
      status ENUM('pendiente', 'en_revision', 'en_diagnostico', 'reparacion_aceptada', 'en_proceso_de_devolucion', 'reparacion_completa', 'finalizado', 'solicitud_finalizada', 'consulta_denegada') DEFAULT 'pendiente',
      diagnosis TEXT,
      price DECIMAL(10,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS request_media (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      media_url VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
    )
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      status VARCHAR(50) NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
    )
  `);
  console.log('DB Init Done');
}

init();
