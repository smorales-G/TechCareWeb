require('dotenv').config();

const API = 'https://spiderwebargapi.com.ar/api/v1';
const KEY = process.env.spiderapikey;
const DB = process.env.spiderapidb;
const STORAGE_ID = process.env.spiderapicloudstorageID;

class SpiderApi {
  // Database Query
  static async query(sql) {
    const res = await fetch(`${API}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
      body: JSON.stringify({ database: DB, query: sql })
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(`DB Error: ${JSON.stringify(data)}`);
    }
    return data.result;
  }

  // File Upload
  static async uploadFile(fileBuffer, originalName) {
    const formData = new FormData();
    const blob = new Blob([fileBuffer]);
    formData.append('files', blob, originalName);

    const res = await fetch(`${API}/storage/projects/${STORAGE_ID}/files`, {
      method: 'POST',
      headers: { 'X-API-KEY': KEY },
      body: formData
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(`Storage Error: ${JSON.stringify(data)}`);
    }
    return data.files[0]; // Returns uploaded file metadata, should have a url/id
  }

  // Optional: AI Chat
  static async chat(messages) {
    // get models
    const modelsRes = await fetch(`${API}/ia/models`, { headers: { 'X-API-KEY': KEY } });
    const modelsData = await modelsRes.json();
    if (!modelsData.models || modelsData.models.length === 0) return null;

    const res = await fetch(`${API}/ia/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': KEY },
      body: JSON.stringify({
        model_id: modelsData.models[0].id,
        messages: messages
      })
    });
    return res.json();
  }
}

module.exports = SpiderApi;
