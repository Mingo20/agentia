/**
 * =========================================================
 * DELEGA IA — Servidor WhatsApp + QR
 * Desarrollado por DGtech
 * Deploy: Railway / Render
 * =========================================================
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const qrcode  = require('qrcode');
const axios   = require('axios');
const path    = require('path');

// WhatsApp Web.js
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Estado global ───────────────────────────────────────
let QR_DATA      = null;   // base64 del QR actual
let QR_IMAGE_URL = null;   // URL de imagen QR
let WA_STATUS    = 'disconnected'; // disconnected | qr_ready | connecting | connected
let WA_CLIENT    = null;
let SESSIONS     = {};     // { phone: { status, connectedAt } }

// ─── Base44 Config ───────────────────────────────────────
const BASE44_APP_ID  = process.env.BASE44_APP_ID  || '69bf571e53cddb8789552b4e';
const BASE44_API_URL = `https://app.base44.com/api/v1/apps/${BASE44_APP_ID}/functions`;

// ─── Inicializar cliente WhatsApp ─────────────────────────
function initWhatsApp() {
  console.log('🤖 Iniciando cliente WhatsApp...');
  WA_STATUS = 'connecting';

  WA_CLIENT = new Client({
    authStrategy: new LocalAuth({ clientId: 'delegaia' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    }
  });

  // Evento: QR generado
  WA_CLIENT.on('qr', async (qr) => {
    console.log('📱 QR generado — listo para escanear');
    WA_STATUS = 'qr_ready';
    try {
      QR_IMAGE_URL = await qrcode.toDataURL(qr, {
        width: 280,
        margin: 2,
        color: { dark: '#128C7E', light: '#ffffff' }
      });
      QR_DATA = qr;
    } catch (err) {
      console.error('Error generando QR imagen:', err.message);
      QR_DATA = qr;
    }
  });

  // Evento: Conectado
  WA_CLIENT.on('ready', () => {
    console.log('✅ WhatsApp conectado exitosamente');
    WA_STATUS = 'connected';
    QR_DATA   = null;
    const info = WA_CLIENT.info;
    if (info) {
      SESSIONS[info.wid.user] = {
        name:        info.pushname,
        phone:       info.wid.user,
        status:      'connected',
        connectedAt: new Date().toISOString()
      };
    }
  });

  // Evento: Mensaje entrante
  WA_CLIENT.on('message', async (msg) => {
    if (msg.fromMe) return;
    const from = msg.from.replace('@c.us', '');
    const text = msg.body || '';
    console.log(`📩 Mensaje de ${from}: ${text.slice(0, 60)}...`);
    await handleIncomingMessage(from, text, msg);
  });

  // Evento: Desconectado
  WA_CLIENT.on('disconnected', (reason) => {
    console.log('🔴 WhatsApp desconectado:', reason);
    WA_STATUS = 'disconnected';
    QR_DATA   = null;
    setTimeout(initWhatsApp, 8000); // reconectar en 8s
  });

  // Evento: Autenticado
  WA_CLIENT.on('authenticated', () => {
    console.log('🔐 Autenticación exitosa');
    WA_STATUS = 'connecting';
  });

  WA_CLIENT.initialize().catch(err => {
    console.error('Error inicializando WhatsApp:', err.message);
    WA_STATUS = 'error';
    setTimeout(initWhatsApp, 15000);
  });
}

// ─── Procesar mensajes entrantes ─────────────────────────
async function handleIncomingMessage(from, text, msg) {
  try {
    // 1. Enviar al backend Deno de Base44
    const response = await axios.post(
      `${BASE44_API_URL}/chatDelega`,
      {
        action:     'send_message',
        usuario_id: from,
        empresa_id: BASE44_APP_ID,
        mensaje:    text,
        contexto:   `whatsapp|phone:${from}`
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }
    );

    const data = response.data;
    if (!data.success || !data.message_id) {
      await sendFallbackReply(from, text);
      return;
    }

    // 2. Polling de la respuesta del agente
    const agentReply = await pollForReply(data.message_id, 20, 2500);

    // 3. Enviar respuesta al usuario de WhatsApp
    if (agentReply) {
      await WA_CLIENT.sendMessage(`${from}@c.us`, agentReply);
      console.log(`✅ Respuesta enviada a ${from}`);
    } else {
      await sendFallbackReply(from, text);
    }

  } catch (err) {
    console.error('Error procesando mensaje:', err.message);
    await sendFallbackReply(from, text);
  }
}

// ─── Polling respuesta del agente ────────────────────────
async function pollForReply(messageId, maxTries = 20, intervalMs = 2500) {
  for (let i = 0; i < maxTries; i++) {
    await sleep(intervalMs);
    try {
      const res = await axios.post(
        `${BASE44_API_URL}/chatDelega`,
        { action: 'poll_response', last_id: messageId },
        { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
      );
      if (res.data.ready && res.data.respuesta) {
        return res.data.respuesta;
      }
    } catch (e) {
      console.warn(`Poll intento ${i + 1} fallido:`, e.message);
    }
  }
  return null;
}

// ─── Respuesta de fallback ────────────────────────────────
async function sendFallbackReply(from, text) {
  if (!WA_CLIENT || WA_STATUS !== 'connected') return;
  const m = text.toLowerCase();
  let reply;
  if (m.includes('hola') || m.includes('buenos') || m.includes('buenas')) {
    reply = `¡Hola! 👋 Soy *Delega IA*, tu asistente docente.\n\nPuedo ayudarte con:\n📋 Planificaciones MINERD\n📊 Registro de asistencia\n📈 Calificaciones y boletines\n📝 Rúbricas de evaluación\n\n¿Con qué empezamos?`;
  } else if (m.includes('planif') || m.includes('plan')) {
    reply = `📋 Entendido! Voy a generar tu planificación.\n\nPor favor dime:\n1️⃣ Asignatura\n2️⃣ Grado y sección\n3️⃣ Período (diario/semanal/mensual)`;
  } else if (m.includes('asistencia') || m.includes('falt')) {
    reply = `📊 Para registrar asistencia, dime quiénes faltaron hoy.\n\nEjemplo: _"Hoy faltaron Juan Pérez y María López"_`;
  } else if (m.includes('nota') || m.includes('calificac')) {
    reply = `📈 Para registrar calificaciones envíame:\n\nNombre del estudiante y su nota.\n\nEjemplo: _"Ana García 95, Carlos López 78"_`;
  } else {
    reply = `🤖 Tu mensaje fue recibido y está siendo procesado por *Delega IA*.\n\nEn unos segundos recibirás una respuesta. Si no recibes respuesta, escribe *hola* para reiniciar.`;
  }
  await WA_CLIENT.sendMessage(`${from}@c.us`, reply);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────
// API ENDPOINTS
// ─────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'Delega IA WhatsApp Server',
    wa_status: WA_STATUS,
    uptime:    Math.floor(process.uptime()),
    sessions:  Object.keys(SESSIONS).length,
    version:   '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Estado del QR
app.get('/api/qr/status', (req, res) => {
  res.json({
    status:    WA_STATUS,
    has_qr:    !!QR_DATA,
    qr_image:  QR_IMAGE_URL,
    sessions:  Object.values(SESSIONS)
  });
});

// Obtener QR como imagen base64
app.get('/api/qr/image', (req, res) => {
  if (!QR_IMAGE_URL) {
    return res.json({ success: false, message: 'QR no disponible aún. Estado: ' + WA_STATUS });
  }
  res.json({ success: true, qr_image: QR_IMAGE_URL, status: WA_STATUS });
});

// Regenerar QR (desconectar y reconectar)
app.post('/api/qr/refresh', async (req, res) => {
  console.log('🔄 Solicitando nuevo QR...');
  if (WA_CLIENT) {
    try { await WA_CLIENT.destroy(); } catch (e) {}
  }
  QR_DATA      = null;
  QR_IMAGE_URL = null;
  WA_STATUS    = 'connecting';
  setTimeout(initWhatsApp, 2000);
  res.json({ success: true, message: 'Reconectando... El QR estará listo en 15 segundos.' });
});

// Enviar mensaje (uso interno/admin)
app.post('/api/send', async (req, res) => {
  const { phone, message, adminKey } = req.body;
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (WA_STATUS !== 'connected') {
    return res.status(503).json({ error: 'WhatsApp no conectado. Estado: ' + WA_STATUS });
  }
  if (!phone || !message) {
    return res.status(400).json({ error: 'Faltan phone y message' });
  }
  try {
    await WA_CLIENT.sendMessage(`${phone}@c.us`, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboard QR — sirve la página HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Iniciar servidor ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Delega IA Server corriendo en puerto ${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/health`);
  console.log(`📱 QR API: http://localhost:${PORT}/api/qr/status`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}\n`);
  initWhatsApp();
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
