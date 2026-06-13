/**
 * =========================================================
 * DELEGA IA — Google Drive Module
 * Integración DIRECTA con Google Drive API
 * Sin dependencia de Base44 — 100% autónomo
 * DGtech 🇩🇴
 * =========================================================
 */

const axios = require('axios');
const qs    = require('querystring');

// ─── Configuración OAuth Google ───────────────────────────
const GOOGLE_CONFIG = {
  client_id:     process.env.GOOGLE_CLIENT_ID,
  client_secret: process.env.GOOGLE_CLIENT_SECRET,
  redirect_uri:  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
  token_uri:     'https://oauth2.googleapis.com/token',
  auth_uri:      'https://accounts.google.com/o/oauth2/auth',
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'openid','email','profile'
  ]
};

// ─── Token store en memoria (por usuario) ─────────────────
// En producción usar Redis o una DB. Para Render usamos archivo local.
const fs   = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '.data', 'tokens.json');

function loadTokens() {
  try {
    if (!fs.existsSync(path.dirname(TOKENS_FILE))) {
      fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    }
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveTokens(tokens) {
  try {
    if (!fs.existsSync(path.dirname(TOKENS_FILE))) {
      fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
    }
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
  } catch(e) { console.error('Error saving tokens:', e.message); }
}

let TOKEN_STORE = loadTokens();

// ─── Generar URL de autorización OAuth ───────────────────
function getAuthUrl(state = 'default') {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CONFIG.client_id,
    redirect_uri:  GOOGLE_CONFIG.redirect_uri,
    response_type: 'code',
    scope:         GOOGLE_CONFIG.scopes.join(' '),
    access_type:   'offline',
    prompt:        'consent',
    state:         state
  });
  return `${GOOGLE_CONFIG.auth_uri}?${params.toString()}`;
}

// ─── Intercambiar código por tokens ───────────────────────
async function exchangeCode(code, userId = 'default') {
  const res = await axios.post(GOOGLE_CONFIG.token_uri, qs.stringify({
    code,
    client_id:     GOOGLE_CONFIG.client_id,
    client_secret: GOOGLE_CONFIG.client_secret,
    redirect_uri:  GOOGLE_CONFIG.redirect_uri,
    grant_type:    'authorization_code'
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  const tokens = {
    access_token:  res.data.access_token,
    refresh_token: res.data.refresh_token,
    expires_at:    Date.now() + (res.data.expires_in * 1000),
    scope:         res.data.scope,
    userId
  };
  TOKEN_STORE[userId] = tokens;
  saveTokens(TOKEN_STORE);
  return tokens;
}

// ─── Refrescar token si expiró ────────────────────────────
async function getValidToken(userId = 'default') {
  let t = TOKEN_STORE[userId];
  if (!t) throw new Error(`Usuario ${userId} no autorizado en Google Drive`);

  // Si expira en menos de 5 minutos, renovar
  if (Date.now() > t.expires_at - 300000) {
    const res = await axios.post(GOOGLE_CONFIG.token_uri, qs.stringify({
      refresh_token: t.refresh_token,
      client_id:     GOOGLE_CONFIG.client_id,
      client_secret: GOOGLE_CONFIG.client_secret,
      grant_type:    'refresh_token'
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    t.access_token = res.data.access_token;
    t.expires_at   = Date.now() + (res.data.expires_in * 1000);
    TOKEN_STORE[userId] = t;
    saveTokens(TOKEN_STORE);
  }
  return t.access_token;
}

// ─── Headers autenticados ─────────────────────────────────
async function authHeaders(userId = 'default') {
  const token = await getValidToken(userId);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ─── Buscar o crear carpeta ───────────────────────────────
async function findOrCreateFolder(name, parentId = null, userId = 'default') {
  const headers = await authHeaders(userId);
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;

  const searchRes = await axios.get(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers }
  );

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    return searchRes.data.files[0].id;
  }

  // Crear carpeta
  const meta = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId ? { parents: [parentId] } : {})
  };
  const createRes = await axios.post(
    'https://www.googleapis.com/drive/v3/files',
    meta,
    { headers }
  );
  return createRes.data.id;
}

// ─── Crear estructura MINERD completa ─────────────────────
async function crearEstructuraDocente(docente, userId = 'default') {
  console.log(`[Drive] Creando estructura para: ${docente.nombre}`);

  // Raíz Delega IA
  const rootId = await findOrCreateFolder('📚 Delega IA', null, userId);

  // Carpeta del docente
  const docenteId = await findOrCreateFolder(`👤 ${docente.nombre}`, rootId, userId);

  // Año académico
  const anioId = await findOrCreateFolder('📅 2025-2026', docenteId, userId);

  // Estructura por trimestre
  const trimestres = ['1er Trimestre (Sep-Dic)', '2do Trimestre (Ene-Mar)', '3er Trimestre (Abr-Jun)'];
  const estructura = {};

  for (const trim of trimestres) {
    const trimId = await findOrCreateFolder(`📁 ${trim}`, anioId, userId);
    const subCarpetas = [
      '📋 Planificaciones Mensuales',
      '📆 Planes Semanales',
      '📄 Planes Diarios',
      '📝 Rúbricas de Evaluación',
      '✅ Registro de Asistencia',
      '📊 Calificaciones y Boletines',
      '📎 Documentos MINERD'
    ];
    const subs = {};
    for (const sub of subCarpetas) {
      subs[sub] = await findOrCreateFolder(sub, trimId, userId);
    }
    estructura[trim] = { id: trimId, subcarpetas: subs };
  }

  // Guardar IDs en el store
  TOKEN_STORE[userId] = TOKEN_STORE[userId] || {};
  TOKEN_STORE[userId].driveStructure = {
    rootId, docenteId, anioId, estructura,
    createdAt: new Date().toISOString()
  };
  saveTokens(TOKEN_STORE);

  console.log(`[Drive] ✅ Estructura creada para ${docente.nombre}`);
  return { rootId, docenteId, anioId, estructura };
}

// ─── Guardar documento de texto en Drive ──────────────────
async function guardarDocumento({ titulo, contenido, tipo, trimestre = '2do', userId = 'default' }) {
  const headers = await authHeaders(userId);

  // Determinar carpeta destino según tipo
  const mapTipo = {
    'mensual':    '📋 Planificaciones Mensuales',
    'semanal':    '📆 Planes Semanales',
    'diario':     '📄 Planes Diarios',
    'rubrica':    '📝 Rúbricas de Evaluación',
    'asistencia': '✅ Registro de Asistencia',
    'calificacion': '📊 Calificaciones y Boletines',
    'documento':  '📎 Documentos MINERD'
  };

  const trimMap = {
    '1er': '1er Trimestre (Sep-Dic)',
    '2do': '2do Trimestre (Ene-Mar)',
    '3er': '3er Trimestre (Abr-Jun)'
  };

  // Obtener ID de carpeta destino
  let folderId = null;
  const structure = TOKEN_STORE[userId]?.driveStructure;
  if (structure) {
    const trimKey = trimMap[trimestre] || trimMap['2do'];
    const subKey  = mapTipo[tipo] || '📎 Documentos MINERD';
    folderId = structure.estructura?.[trimKey]?.subcarpetas?.[subKey] || structure.docenteId;
  }

  // Crear Google Doc directamente
  const boundary = 'delegaia_boundary_' + Date.now();
  const metadata = JSON.stringify({
    name:     titulo,
    mimeType: 'application/vnd.google-apps.document',
    ...(folderId ? { parents: [folderId] } : {})
  });

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    contenido,
    `--${boundary}--`
  ].join('\r\n');

  const uploadRes = await axios.post(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    body,
    {
      headers: {
        ...await authHeaders(userId),
        'Content-Type': `multipart/related; boundary=${boundary}`
      }
    }
  );

  const file = uploadRes.data;
  console.log(`[Drive] ✅ Documento guardado: ${file.name} → ${file.webViewLink}`);
  return file;
}

// ─── Listar documentos del docente ───────────────────────
async function listarDocumentos(folderId, userId = 'default') {
  const headers = await authHeaders(userId);
  const q = `'${folderId}' in parents and trashed=false`;
  const res = await axios.get(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,webViewLink,createdTime,modifiedTime)&orderBy=modifiedTime desc`,
    { headers }
  );
  return res.data.files || [];
}

// ─── Estado de autorización ──────────────────────────────
function getAuthStatus(userId = 'default') {
  const t = TOKEN_STORE[userId];
  if (!t || !t.access_token) return { authorized: false };
  return {
    authorized:    true,
    expires_at:    new Date(t.expires_at).toISOString(),
    hasStructure:  !!t.driveStructure,
    userId
  };
}

function getAllAuthorized() {
  return Object.keys(TOKEN_STORE).filter(k => TOKEN_STORE[k]?.access_token);
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  getValidToken,
  crearEstructuraDocente,
  guardarDocumento,
  listarDocumentos,
  getAuthStatus,
  getAllAuthorized,
  findOrCreateFolder
};
