/************************************************************
 * Script refactorizado SIN conexión a MongoDB ni guardado de
 * historiales. Se conserva el mismo flujo de lectura/escritura
 * de mensajes, la misma lógica de filtrado de números y la
 * misma funcionalidad de Notion (solo lectura y actualización).
 *
 * Ajustado para: 
 * - No guardar ni consultar datos en Mongo.
 * - Mantener el envío y recepción de mensajes vía Baileys.
 * - Respetar los intervalos de espera (2 minutos entre envíos,
 *   3 minutos en cada ciclo de monitoreo de Notion).
 ************************************************************/

// -----------------------------------------------------------------------------
// Importaciones
// -----------------------------------------------------------------------------
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const path = require('path');
const pino = require('pino');
const fs = require('fs');
const { Client: NotionClient } = require('@notionhq/client');

// -----------------------------------------------------------------------------
// Configuración
// -----------------------------------------------------------------------------
const CONFIG = {
  // Sesión de WhatsApp
  SESSION_NAME: process.argv[2] || "gabriel",

  // Notion
  NOTION_API_KEY: "API_NOTION",
  NOTION_DATABASE_ID: "ID_BASE_NOTION",
  CHECKED_EMAIL: "EMAIL_NOTION",  // Email que se chequea en SETTER

  // Tiempos (en milisegundos)
  MESSAGE_INTERVAL_MS: 2 * 60 * 1000,           // 2 minutos entre mensajes
  NOTION_MONITOR_INTERVAL_MS: 3 * 60 * 1000     // 3 minutos entre ciclos de monitoreo
};

// -----------------------------------------------------------------------------
// Clase de utilidades
// -----------------------------------------------------------------------------
class Utils {
  /**
   * Formatea el número de teléfono según reglas específicas.
   */
  static formatPhoneNumber(rawNumber) {
    let finalNumber = rawNumber.trim();

    // Si empieza con "54" y NO es "549", insertar el "9"
    if (finalNumber.startsWith("54") && !finalNumber.startsWith("549")) {
      finalNumber = finalNumber.replace(/^54/, "549");
      console.log(`[INFO] Ajustando número de Argentina: ${finalNumber}`);
    }
    // Si empieza con "52" y NO es "521", insertar el "1"
    if (finalNumber.startsWith("52") && !finalNumber.startsWith("521")) {
      finalNumber = finalNumber.replace(/^52/, "521");
      console.log(`[INFO] Ajustando número de México: ${finalNumber}`);
    }
    return finalNumber;
  }
}

// -----------------------------------------------------------------------------
// Servicio Notion
// -----------------------------------------------------------------------------
class NotionService {
  constructor(apiKey, databaseId) {
    this.notion = new NotionClient({ auth: apiKey });
    this.databaseId = databaseId;
  }

  async queryConfirmedNotInitiated() {
    return this.notion.databases.query({
      database_id: this.databaseId,
      filter: {
        and: [
          { property: "CONFIRMADO", checkbox: { equals: true } },
          { property: "INICIADO", checkbox: { equals: false } }
        ]
      }
    });
  }

  async retrievePage(pageId) {
    return this.notion.pages.retrieve({ page_id: pageId });
  }

  async markAsIniciado(pageId) {
    try {
      await this.notion.pages.update({
        page_id: pageId,
        properties: {
          "INICIADO": {
            checkbox: true
          }
        }
      });
      console.log(`[INFO] Propiedad "INICIADO" marcada en true para la página ${pageId}`);
    } catch (error) {
      console.error("[ERROR] Al marcar INICIADO en Notion:", error);
    }
  }
}

// -----------------------------------------------------------------------------
// Cliente de WhatsApp (sin lógica de guardado en DB)
// -----------------------------------------------------------------------------
class WhatsAppClient {
  constructor(sessionName) {
    this.sessionName = sessionName;
    this.sock = null;
    this.authFolder = path.join(__dirname, 'auth', this.sessionName);
    this.initialized = false;
  }

  async initialize() {
    if (!fs.existsSync(this.authFolder)) {
      fs.mkdirSync(this.authFolder, { recursive: true });
    }
    const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
    this.sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'error' }),
      printQRInTerminal: false
    });
    this.setupListeners(saveCreds);
  }

  setupListeners(saveCreds) {
    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.clear();
        console.log(`\n[Sesión: ${this.sessionName}] Escanea el siguiente código QR:\n`);
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const isBoom = lastDisconnect?.error instanceof Boom;
        const statusCode = isBoom ? lastDisconnect.error.output.statusCode : null;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.error(`[Sesión: ${this.sessionName}] Conexión cerrada. Reconectar: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(() => this.initialize(), 5000);
        } else {
          console.log(`[Sesión: ${this.sessionName}] Sesión cerrada definitivamente. Elimina la carpeta "auth/${this.sessionName}" para reconectar.`);
        }
      } else if (connection === 'open') {
        console.log(`[Sesión: ${this.sessionName}] Conectado con éxito.`);
        this.initialized = true;
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    // Manejo de mensajes recibidos (sin guardado en DB)
    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      const messages = m.messages || [];
      for (const msg of messages) {
        if (!msg.message) continue;
        const senderJid = msg.key.remoteJid || '';
        // Ignorar grupos y JIDs que no terminen en @s.whatsapp.net
        if (!senderJid.endsWith('@s.whatsapp.net')) continue;

        const textMsg = msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          "";
        if (!textMsg.trim()) continue;

        // Número sin @s.whatsapp.net
        const phoneRaw = senderJid.split('@')[0];

        // LÓGICA: 
        // - Si NO empieza con "549" -> aceptamos (en la versión con DB, se creaba doc).
        // - Si empieza con "549" y no existía doc, se ignoraba.
        // Aquí simplemente simulamos esa lógica pero sin guardar.

        if (phoneRaw.startsWith("549")) {
          // Caso: inicia con "549". Antes se verificaba si existía en la BD.
          // Si no existía, se ignoraba. Ahora no tenemos BD, así que:
          // -> Lo ignoramos directamente (no hacemos nada).
        } else {
          // Caso: NO inicia con "549". Antes se creaba doc con upsert.
          // Aquí solo mostramos que recibimos el mensaje.
          console.log(`[RECIBIDO] Mensaje de ${phoneRaw}: "${textMsg}" (No guardado en DB)`);
        }
      }
    });
  }

  // Envío de mensaje (sin guardado en DB)
  async sendMessage(toNumber, text) {
    try {
      await this.sock.sendMessage(toNumber, { text });
      console.log(`[OK] Mensaje enviado a ${toNumber}: "${text}"`);
    } catch (error) {
      console.error(`[ERROR] No se pudo enviar el mensaje a ${toNumber}:`, error);
      throw error;
    }
  }
}

// -----------------------------------------------------------------------------
// Monitor de Notion para enviar mensajes (sin DB)
// -----------------------------------------------------------------------------
class NotionMonitor {
  constructor(whatsAppClient, notionService, config) {
    this.whatsAppClient = whatsAppClient;
    this.notionService = notionService;
    this.config = config;
  }

  async process() {
    console.log("\n[INFO] Iniciando ciclo de monitoreo de Notion...");
    try {
      // 1. Consultar páginas de Notion (CONFIRMADO = true, INICIADO = false)
      const response = await this.notionService.queryConfirmedNotInitiated();
      console.log(`[INFO] Registros obtenidos: ${response.results.length}`);
      const messagesToSend = [];

      for (const page of response.results) {
        console.log(`\n[INFO] Procesando página: ${page.id}`);
        const pageDetail = await this.notionService.retrievePage(page.id);
        const setterPeople = pageDetail.properties["SETTER"]?.people ?? [];
        const emails = setterPeople.map(person => person.person?.email || "");
        console.log(`[INFO] Emails en SETTER: ${emails}`);

        if (!emails.includes(this.config.CHECKED_EMAIL)) {
          console.log(`[SKIP] El SETTER no es ${this.config.CHECKED_EMAIL}. Se ignora esta página.`);
          continue;
        }

        // Extraer el número desde la URL de WhatsApp
        const wpUrl = pageDetail.properties["WP"]?.url || "";
        if (!wpUrl.includes("https://api.whatsapp.com/send?phone=")) {
          console.log(`[SKIP] La propiedad WP no contiene un enlace válido: ${wpUrl}`);
          continue;
        }
        const rawNumber = wpUrl.split("phone=")[1] || "";
        const finalNumber = Utils.formatPhoneNumber(rawNumber);
        const jid = finalNumber + "@s.whatsapp.net";
        console.log(`[INFO] Número final: ${finalNumber}`);

        // Recuperar el mensaje inicial
        const mensajeInicial = pageDetail.properties["MENSAJE INICIAL"]?.rich_text?.[0]?.plain_text
          || pageDetail.properties["MENSAJE INICIAL"]?.title?.[0]?.plain_text
          || "";
        if (!mensajeInicial.trim()) {
          console.log(`[SKIP] "MENSAJE INICIAL" vacío en ${page.id}`);
          continue;
        }
        console.log(`[INFO] Mensaje a enviar: "${mensajeInicial}"`);

        // Antes se usaba un docId para guardar en DB. Aquí no lo necesitamos, 
        // pero mantenemos la estructura.
        messagesToSend.push({
          jid,
          text: mensajeInicial,
          pageId: page.id
        });
      }

      if (messagesToSend.length > 0) {
        await this.sendMessagesInSequence(messagesToSend);
      } else {
        console.log("[INFO] No se encontraron mensajes nuevos para enviar.");
      }

      console.log(`[INFO] Ciclo de monitoreo completado. Esperando ${this.config.NOTION_MONITOR_INTERVAL_MS / 60000} minutos...`);
      await new Promise(resolve => setTimeout(resolve, this.config.NOTION_MONITOR_INTERVAL_MS));
    } catch (error) {
      console.error("[ERROR] Al monitorear Notion:", error);
      console.log(`[INFO] Esperando ${this.config.NOTION_MONITOR_INTERVAL_MS / 60000} minutos antes del siguiente intento tras error...`);
      await new Promise(resolve => setTimeout(resolve, this.config.NOTION_MONITOR_INTERVAL_MS));
    }
  }

  async sendMessagesInSequence(messages) {
    console.log(`[INFO] Se encontraron ${messages.length} mensajes pendientes. Iniciando envío secuencial...`);
    for (const msg of messages) {
      try {
        await this.whatsAppClient.sendMessage(msg.jid, msg.text);
        await this.notionService.markAsIniciado(msg.pageId);

        console.log(`[INFO] Esperando ${this.config.MESSAGE_INTERVAL_MS / 60000} minutos antes de enviar el siguiente mensaje...`);
        await new Promise(resolve => setTimeout(resolve, this.config.MESSAGE_INTERVAL_MS));
      } catch (err) {
        console.error(`[ERROR] Al enviar mensaje a ${msg.jid} o marcar INICIADO:`, err);
      }
    }
    console.log("[INFO] Finalizado el envío secuencial de todos los mensajes encontrados.");
  }
}

// -----------------------------------------------------------------------------
// Función principal (sin DB)
// -----------------------------------------------------------------------------
async function main() {
  try {
    // 1. Inicializar cliente de WhatsApp (sin DB)
    const whatsAppClient = new WhatsAppClient(CONFIG.SESSION_NAME);
    await whatsAppClient.initialize();

    // Esperar hasta que la sesión esté completamente inicializada
    while (!whatsAppClient.initialized) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.log(`[INFO] Sesión de WhatsApp "${CONFIG.SESSION_NAME}" iniciada. Monitoreando Notion...`);

    // 2. Inicializar servicio Notion
    const notionService = new NotionService(CONFIG.NOTION_API_KEY, CONFIG.NOTION_DATABASE_ID);

    // 3. Iniciar el ciclo de monitoreo
    const notionMonitor = new NotionMonitor(whatsAppClient, notionService, CONFIG);
    while (true) {
      await notionMonitor.process();
    }
  } catch (err) {
    console.error("[ERROR] En la ejecución principal:", err);
    process.exit(1);
  }
}

main();
