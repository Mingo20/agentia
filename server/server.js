/**
 * =========================================================
 * DELEGA IA — Servidor WhatsApp + QR
 * Desarrollado por DGtech 🇩🇴
 * Deploy: Render.com / Railway
 * =========================================================
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const qrcode  = require('qrcode');
const axios   = require('axios');
const path    = require('path');

const { Client, LocalAuth } = require('whatsapp-web.js');

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

// ─── Inicializar WhatsApp ─────────────────────────────────
function initWhatsApp() {
  console.log('[Delega IA] Iniciando cliente WhatsApp...');
  WA_STATUS = 'connecting';

  WA_CLIENT = new Client({
    authStrategy: new LocalAuth({ clientId: 'delegaia-server' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps'
      ]
    }
  });

  WA_CLIENT.on('qr', async (qr) => {
    console.log('[Delega IA] QR generado — listo para escanear');
    WA_STATUS = 'qr_ready';
    try {
      QR_IMAGE_URL = await qrcode.toDataURL(qr, {
        width: 280, margin: 2,
        color: { dark: '#128C7E', light: '#ffffff' }
      });
    } catch (e) { console.error('Error QR:', e.message); }
  });

  WA_CLIENT.on('authenticated', () => {
    console.log('[Delega IA] Autenticado correctamente');
    WA_STATUS = 'authenticated';
  });

  WA_CLIENT.on('ready', () => {
    console.log('[Delega IA] WhatsApp CONECTADO y listo');
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
    const text = msg.body || '';
    console.log(`[MSG] De ${from}: ${text.slice(0,80)}`);
    await handleMessage(from, text);
  });

  WA_CLIENT.on('disconnected', (reason) => {
    console.log('[Delega IA] Desconectado:', reason);
    WA_STATUS    = 'disconnected';
    QR_IMAGE_URL = null;
    SESSION_INFO = null;
    setTimeout(initWhatsApp, 10000);
  });

  WA_CLIENT.initialize().catch(err => {
    console.error('[Delega IA] Error init:', err.message);
    WA_STATUS = 'error';
    setTimeout(initWhatsApp, 20000);
  });
}

// ─── Manejar mensajes entrantes ───────────────────────────
async function handleMessage(from, text) {
  try {
    const res = await axios.post(`${BASE44_API_URL}/chatDelega`, {
      action:     'send_message',
      usuario_id: from,
      empresa_id: BASE44_APP_ID,
      mensaje:    text,
      contexto:   `whatsapp|phone:${from}`
    }, { timeout: 10000 });

    const data = res.data;
    if (data.success && data.message_id) {
      const reply = await pollReply(data.message_id);
      if (reply) {
        await WA_CLIENT.sendMessage(`${from}@c.us`, reply);
        return;
      }
    }
  } catch (e) {
    console.warn('[Delega IA] Backend error:', e.message);
  }
  await sendFallback(from, text);
}

async function pollReply(msgId, tries = 20, ms = 2500) {
  for (let i = 0; i < tries; i++) {
    await sleep(ms);
    try {
      const r = await axios.post(`${BASE44_API_URL}/chatDelega`,
        { action: 'poll_response', last_id: msgId },
        { timeout: 8000 }
      );
      if (r.data.ready && r.data.respuesta) return r.data.respuesta;
    } catch(e) {}
  }
  return null;
}

async function sendFallback(from, text) {
  if (WA_STATUS !== 'connected') return;
  const m = text.toLowerCase();
  let reply;
  if (m.includes('hola') || m.includes('buenos') || m.includes('buenas') || m === 'hi') {
    reply = `¡Hola! 👋 Soy *Delega IA*, tu asistente docente inteligente.\n\nPuedo ayudarte con:\n📋 *Planificaciones* MINERD\n📊 *Asistencia* automática\n📈 *Calificaciones* y boletines\n📝 *Rúbricas* de evaluación\n\n¿Con qué empezamos hoy?`;
  } else if (m.includes('planif') || m.includes('plan')) {
    reply = `📋 ¡Perfecto! Voy a generar tu planificación.\n\nIndícame:\n1️⃣ Asignatura\n2️⃣ Grado y sección\n3️⃣ Período (diario / semanal / mensual)`;
  } else if (m.includes('asistencia') || m.includes('falt') || m.includes('ausent')) {
    reply = `📊 Para registrar asistencia, dime quiénes faltaron.\n\nEjemplo: _"Hoy faltaron Juan Pérez y María López"_`;
  } else if (m.includes('nota') || m.includes('calificac') || m.includes('promedio')) {
    reply = `📈 Envíame las calificaciones así:\n\n_"Ana García 95, Carlos López 78, María Pérez 88"_\n\nY las registro automáticamente.`;
  } else if (m.includes('rúbrica') || m.includes('rubrica')) {
    reply = `📝 Creando tu rúbrica...\n\nIndícame el tema o actividad a evaluar.`;
  } else {
    reply = `🤖 Tu mensaje fue recibido por *Delega IA*.\n\nEstoy procesando tu solicitud...\n\nEscribe *hola* para ver todo lo que puedo hacer por ti.`;
  }
  try { await WA_CLIENT.sendMessage(`${from}@c.us`, reply); } catch(e) {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── API ENDPOINTS ────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok:        true,
    status:    WA_STATUS,
    uptime:    Math.floor((Date.now() - UPTIME_START) / 1000),
    session:   SESSION_INFO,
    version:   '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    status:   WA_STATUS,
    qr:       QR_IMAGE_URL,
    session:  SESSION_INFO,
    uptime:   Math.floor((Date.now() - UPTIME_START) / 1000)
  });
});

app.post('/api/refresh', async (req, res) => {
  console.log('[Delega IA] Solicitando nuevo QR...');
  if (WA_CLIENT) {
    try { await WA_CLIENT.destroy(); } catch(e) {}
    WA_CLIENT = null;
  }
  WA_STATUS    = 'connecting';
  QR_IMAGE_URL = null;
  SESSION_INFO = null;
  setTimeout(initWhatsApp, 2000);
  res.json({ ok: true, message: 'Reconectando... QR listo en ~20 segundos.' });
});

app.post('/api/send', async (req, res) => {
  const { phone, message, key } = req.body;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'No autorizado' });
  if (WA_STATUS !== 'connected') return res.status(503).json({ error: 'WhatsApp no conectado' });
  if (!phone || !message) return res.status(400).json({ error: 'Faltan phone y message' });
  try {
    await WA_CLIENT.sendMessage(`${phone}@c.us`, message);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Delega IA Server corriendo en puerto ${PORT}`);
  console.log(`📡 Health: /health`);
  console.log(`📱 Status: /api/status\n`);
  initWhatsApp();
});

process.on('unhandledRejection', r => console.error('Unhandled:', r));
process.on('uncaughtException',  e => console.error('Uncaught:', e.message));
