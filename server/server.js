/**
 * =========================================================
 * DELEGA IA — Servidor Principal
 * WhatsApp + Google Drive DIRECTO (sin Base44)
 * DGtech 🇩🇴
 * =========================================================
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const qrcode  = require('qrcode');
const axios   = require('axios');
const path    = require('path');

const { Client, LocalAuth } = require('whatsapp-web.js');
const drive = require('./google-drive');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Estado global ───────────────────────────────────────
let QR_IMAGE_URL = null;
let WA_STATUS    = 'starting';
let WA_CLIENT    = null;
let SESSION_INFO = null;
let UPTIME_START = Date.now();

const BASE44_APP_ID  = process.env.BASE44_APP_ID || '69bf571e53cddb8789552b4e';
const BASE44_API_URL = `https://app.base44.com/api/v1/apps/${BASE44_APP_ID}/functions`;

// ─── WhatsApp ─────────────────────────────────────────────
function initWhatsApp() {
  console.log('[Delega IA] Iniciando WhatsApp...');
  WA_STATUS = 'connecting';

  WA_CLIENT = new Client({
    authStrategy: new LocalAuth({ clientId: 'delegaia-server' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox','--disable-setuid-sandbox',
        '--disable-dev-shm-usage','--disable-accelerated-2d-canvas',
        '--no-first-run','--no-zygote','--single-process',
        '--disable-gpu','--disable-extensions'
      ]
    }
  });

  WA_CLIENT.on('qr', async (qr) => {
    console.log('[WA] QR generado');
    WA_STATUS = 'qr_ready';
    try {
      QR_IMAGE_URL = await qrcode.toDataURL(qr, {
        width: 280, margin: 2,
        color: { dark: '#128C7E', light: '#ffffff' }
      });
    } catch(e) {}
  });

  WA_CLIENT.on('authenticated', () => { WA_STATUS = 'authenticated'; });

  WA_CLIENT.on('ready', () => {
    console.log('[WA] Conectado!');
    WA_STATUS    = 'connected';
    QR_IMAGE_URL = null;
    const info   = WA_CLIENT.info;
    SESSION_INFO = {
      name:        info?.pushname || 'Docente',
      phone:       info?.wid?.user || '',
      connectedAt: new Date().toISOString()
    };
  });

  WA_CLIENT.on('message', async (msg) => {
    if (msg.fromMe) return;
    const from = msg.from.replace('@c.us','');
    const text = msg.body?.trim() || '';
    if (!text) return;
    console.log(`[MSG] ${from}: ${text.slice(0,80)}`);
    await handleMessage(from, text);
  });

  WA_CLIENT.on('disconnected', (reason) => {
    console.log('[WA] Desconectado:', reason);
    WA_STATUS = 'disconnected';
    QR_IMAGE_URL = null;
    SESSION_INFO = null;
    setTimeout(initWhatsApp, 10000);
  });

  WA_CLIENT.initialize().catch(err => {
    console.error('[WA] Error init:', err.message);
    WA_STATUS = 'error';
    setTimeout(initWhatsApp, 20000);
  });
}

// ─── Manejar mensajes WhatsApp ────────────────────────────
async function handleMessage(from, text) {
  const lower = text.toLowerCase();

  // 1. Comando especial: conectar Google Drive
  if (lower.includes('conectar drive') || lower.includes('autorizar drive') || lower.includes('google drive')) {
    const authUrl = drive.getAuthUrl(from);
    await sendWA(from,
      `🔗 *Conectar Google Drive*\n\n` +
      `Para guardar tus documentos directamente en tu Drive, haz clic en este enlace:\n\n` +
      `${authUrl}\n\n` +
      `_Una vez autorizado, todos tus planes y rúbricas se guardarán automáticamente en tu Drive._`
    );
    return;
  }

  // 2. Verificar estado Drive
  if (lower.includes('estado drive') || lower.includes('mi drive')) {
    const status = drive.getAuthStatus(from);
    if (status.authorized) {
      await sendWA(from,
        `✅ *Google Drive conectado*\n\n` +
        `📁 Estructura: ${status.hasStructure ? 'Creada ✅' : 'Pendiente ⏳'}\n` +
        `🔄 Token válido hasta: ${new Date(status.expires_at).toLocaleString('es')}`
      );
    } else {
      await sendWA(from, `❌ Drive no conectado. Escribe *conectar drive* para vincularlo.`);
    }
    return;
  }

  // 3. Guardar documento en Drive (si tiene Drive conectado)
  const driveStatus = drive.getAuthStatus(from);
  if (driveStatus.authorized) {
    // Detectar tipo de documento solicitado
    let tipo = null;
    let titulo = null;
    if (lower.includes('plan mensual') || lower.includes('planificación mensual')) {
      tipo = 'mensual';
      titulo = `Plan Mensual — ${new Date().toLocaleDateString('es',{month:'long',year:'numeric'})}`;
    } else if (lower.includes('plan semanal') || lower.includes('semana')) {
      tipo = 'semanal';
      titulo = `Plan Semanal — Semana del ${new Date().toLocaleDateString('es')}`;
    } else if (lower.includes('plan diario') || lower.includes('plan de clase') || lower.includes('planif')) {
      tipo = 'diario';
      titulo = `Plan Diario — ${new Date().toLocaleDateString('es',{weekday:'long',day:'numeric',month:'long'})}`;
    } else if (lower.includes('rúbrica') || lower.includes('rubrica')) {
      tipo = 'rubrica';
      titulo = `Rúbrica — ${text.replace(/rúbrica|rubrica/gi,'').trim() || 'Evaluación'}`;
    } else if (lower.includes('asistencia')) {
      tipo = 'asistencia';
      titulo = `Asistencia — ${new Date().toLocaleDateString('es')}`;
    }

    if (tipo && titulo) {
      // Obtener respuesta del agente Base44
      let contenidoHtml = await getAgentResponse(from, text);
      if (contenidoHtml) {
        try {
          // Guardar en Drive directamente
          const file = await drive.guardarDocumento({
            titulo,
            contenido: `<h1>${titulo}</h1><br>${contenidoHtml.replace(/\n/g,'<br>')}`,
            tipo,
            trimestre: '2do',
            userId: from
          });

          await sendWA(from,
            `${contenidoHtml}\n\n` +
            `📁 *Guardado en Google Drive:*\n${file.webViewLink}`
          );
          return;
        } catch(driveErr) {
          console.error('[Drive] Error guardando:', driveErr.message);
          // Continúa y envía la respuesta sin Drive
          await sendWA(from, contenidoHtml + '\n\n⚠️ _No se pudo guardar en Drive. Intenta reconectar._');
          return;
        }
      }
    }
  }

  // 4. Flujo normal → Base44 Agent
  const reply = await getAgentResponse(from, text);
  await sendWA(from, reply || fallback(from, text));
}

// ─── Obtener respuesta del agente Base44 ─────────────────
async function getAgentResponse(from, text) {
  try {
    const res = await axios.post(`${BASE44_API_URL}/chatDelega`, {
      action:     'send_message',
      usuario_id: from,
      empresa_id: BASE44_APP_ID,
      mensaje:    text,
      contexto:   `whatsapp|phone:${from}`
    }, { timeout: 10000 });

    if (res.data.success && res.data.message_id) {
      return await pollReply(res.data.message_id);
    }
  } catch(e) {
    console.warn('[Agent] Error:', e.message);
  }
  return null;
}

async function pollReply(msgId, tries=20, ms=2500) {
  for (let i=0; i<tries; i++) {
    await sleep(ms);
    try {
      const r = await axios.post(`${BASE44_API_URL}/chatDelega`,
        { action:'poll_response', last_id:msgId },
        { timeout:8000 }
      );
      if (r.data.ready && r.data.respuesta) return r.data.respuesta;
    } catch(e) {}
  }
  return null;
}

function fallback(from, text) {
  const m = text.toLowerCase();
  if (m.includes('hola')||m.includes('buenos')||m.includes('buenas'))
    return `¡Hola! 👋 Soy *Delega IA*, tu asistente docente.\n\nPuedo ayudarte con:\n📋 Planificaciones MINERD\n📊 Asistencia\n📈 Calificaciones\n📝 Rúbricas\n📁 Google Drive\n\n¿Con qué empezamos?`;
  if (m.includes('planif')||m.includes('plan'))
    return `📋 Dime: asignatura, grado y período (diario/semanal/mensual).`;
  if (m.includes('asistencia'))
    return `📊 Dime quiénes faltaron hoy y los registro.`;
  return `🤖 Recibido. Escribe *hola* para ver mis funciones.`;
}

async function sendWA(from, text) {
  if (WA_STATUS !== 'connected' || !WA_CLIENT) return;
  try { await WA_CLIENT.sendMessage(`${from}@c.us`, text); } catch(e) {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────
// RUTAS API
// ─────────────────────────────────────────────────────────

// Health
app.get('/health', (req, res) => res.json({
  ok:true, status:WA_STATUS,
  uptime:Math.floor((Date.now()-UPTIME_START)/1000),
  session:SESSION_INFO, version:'2.0.0',
  drive_users: drive.getAllAuthorized().length
}));

// Estado combinado
app.get('/api/status', (req, res) => res.json({
  status:WA_STATUS, qr:QR_IMAGE_URL,
  session:SESSION_INFO,
  uptime:Math.floor((Date.now()-UPTIME_START)/1000),
  drive_authorized: drive.getAllAuthorized().length
}));

// Regenerar QR
app.post('/api/refresh', async (req, res) => {
  if (WA_CLIENT) { try { await WA_CLIENT.destroy(); } catch(e){} WA_CLIENT=null; }
  WA_STATUS='connecting'; QR_IMAGE_URL=null; SESSION_INFO=null;
  setTimeout(initWhatsApp, 2000);
  res.json({ ok:true, message:'Reconectando...' });
});

// ─── GOOGLE DRIVE OAUTH ───────────────────────────────────

// Paso 1: Generar URL de autorización
app.get('/auth/google', (req, res) => {
  const userId = req.query.user || 'admin';
  const url = drive.getAuthUrl(userId);
  res.redirect(url);
});

// Paso 2: Callback OAuth
app.get('/auth/google/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code) return res.status(400).send('Falta el código de autorización.');
  try {
    const tokens = await drive.exchangeCode(code, userId || 'admin');
    console.log(`[Drive] ✅ Usuario ${userId} autorizado`);

    // Crear estructura automáticamente
    res.send(`
      <!DOCTYPE html><html lang="es">
      <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Delega IA — Drive Conectado</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:Inter,sans-serif;background:linear-gradient(135deg,#f0fbf5,#e8f5e9);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
        .card{background:#fff;border-radius:24px;padding:40px 32px;max-width:400px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(37,211,102,.12)}
        .icon{font-size:64px;margin-bottom:20px}
        h1{font-size:22px;font-weight:800;color:#111827;margin-bottom:10px}
        p{font-size:14px;color:#4b5563;line-height:1.6;margin-bottom:24px}
        .badge{background:#d1fae5;color:#065f46;padding:8px 20px;border-radius:20px;font-size:13px;font-weight:700;display:inline-block;margin-bottom:20px}
        .steps{background:#f7faf8;border-radius:14px;padding:16px;text-align:left;margin-bottom:24px}
        .step{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:13px;color:#374151}
        .step:not(:last-child){border-bottom:1px solid #e5e7eb}
        .n{width:22px;height:22px;border-radius:50%;background:#25D366;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        a.btn{display:block;background:#25D366;color:#fff;padding:13px;border-radius:50px;font-size:15px;font-weight:700;text-decoration:none}
        a.btn:hover{background:#128C7E}
        .footer{margin-top:16px;font-size:11px;color:#9ca3af}
      </style>
      </head>
      <body>
      <div class="card">
        <div class="icon">🎉</div>
        <div class="badge">✅ Google Drive Conectado</div>
        <h1>¡Autorización exitosa!</h1>
        <p>Tu Google Drive está vinculado con <strong>Delega IA</strong>. Ahora todos tus documentos académicos se guardarán automáticamente.</p>
        <div class="steps">
          <div class="step"><div class="n">1</div><span>Estructura de carpetas MINERD creándose...</span></div>
          <div class="step"><div class="n">2</div><span>Planes, rúbricas y asistencia → Drive automático</span></div>
          <div class="step"><div class="n">3</div><span>Accede desde cualquier dispositivo</span></div>
        </div>
        <a class="btn" href="/">← Volver al panel</a>
        <p class="footer">DGtech 🇩🇴 — Delega IA v2.0</p>
      </div>
      <script>
        // Crear estructura en background
        fetch('/api/drive/setup', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({userId:'${userId}',nombre:'Docente'})
        });
      </script>
      </body></html>
    `);
  } catch(e) {
    console.error('[Drive] Error callback:', e.message);
    res.status(500).send('Error al conectar Drive: ' + e.message);
  }
});

// Crear estructura Drive para docente
app.post('/api/drive/setup', async (req, res) => {
  const { userId, nombre } = req.body;
  try {
    const result = await drive.crearEstructuraDocente(
      { nombre: nombre || 'Docente' },
      userId || 'admin'
    );
    res.json({ ok:true, result });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Estado Drive por usuario
app.get('/api/drive/status', (req, res) => {
  const userId = req.query.user || 'admin';
  res.json(drive.getAuthStatus(userId));
});

// Guardar documento en Drive (llamado desde el frontend)
app.post('/api/drive/save', async (req, res) => {
  const { userId, titulo, contenido, tipo, trimestre } = req.body;
  try {
    const file = await drive.guardarDocumento({ titulo, contenido, tipo, trimestre, userId });
    res.json({ ok:true, file });
  } catch(e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});

// Enviar mensaje WhatsApp (admin)
app.post('/api/send', async (req, res) => {
  const { phone, message, key } = req.body;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error:'No autorizado' });
  if (WA_STATUS !== 'connected') return res.status(503).json({ error:'WhatsApp no conectado' });
  try {
    await WA_CLIENT.sendMessage(`${phone}@c.us`, message);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Delega IA v2.0 corriendo en puerto ${PORT}`);
  console.log(`📁 Google Drive: /auth/google`);
  console.log(`📱 WhatsApp QR: /\n`);
  initWhatsApp();
});

process.on('unhandledRejection', r => console.error('Unhandled:', r));
process.on('uncaughtException',  e => console.error('Uncaught:', e.message));
