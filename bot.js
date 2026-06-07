const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = 'bot_sodimac_verify';

const estadoUsuarios = {};

const camiones = {
    'HFSW85': 'Richard Paredes',
    'RXTH24': 'Israel Fuentes',
    'PCTV91': 'XXXX',
    'KBFD31': 'Dany Paredes'
};

async function sendMessage(to, message) {
    await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: 'whatsapp',
            to: to,
            type: 'text',
            text: { body: message }
        },
        {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        }
    );
}

async function downloadMedia(mediaId) {
    const mediaResponse = await axios.get(
        `https://graph.facebook.com/v18.0/${mediaId}`,
        { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } }
    );

    const mediaUrl = mediaResponse.data.url;
    const imageResponse = await axios.get(mediaUrl, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
        responseType: 'arraybuffer'
    });

    return {
        data: Buffer.from(imageResponse.data).toString('base64'),
        mimeType: imageResponse.headers['content-type']
    };
}

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verificado');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    const body = req.body;
    if (!body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) return;

    const message = body.entry[0].changes[0].value.messages[0];
    const usuario = message.from;
    const tipo = message.type;

    if (tipo === 'text') {
        const texto = message.text.body.trim();
        const textoLower = texto.toLowerCase();

        if (textoLower === 'menu' || textoLower === 'hola' || textoLower === 'inicio') {
            estadoUsuarios[usuario] = { opcion: 'esperando_menu' };
            await sendMessage(usuario, '👋 Bienvenido! ¿Qué deseas hacer?\n\n1️⃣ Crear cierre\n2️⃣ Crear ruta');
            return;
        }

        if (estadoUsuarios[usuario]?.opcion === 'esperando_menu') {
            if (texto === '1' || textoLower === 'crear cierre') {
                estadoUsuarios[usuario] = { opcion: 'esperando_camion' };
                await sendMessage(usuario, '🚛 ¿Qué camión?\n\n1️⃣ HFSW85\n2️⃣ RXTH24\n3️⃣ PCTV91\n4️⃣ KBFD31');
                return;
            }
            if (texto === '2' || textoLower === 'crear ruta') {
                estadoUsuarios[usuario] = { opcion: 'ruta' };
                await sendMessage(usuario, '🗺️ Perfecto! Envía la foto del informe de carga para generar la ruta.');
                return;
            }
            await sendMessage(usuario, '⚠️ Opción no válida.\n\n1️⃣ Para crear cierre\n2️⃣ Para crear ruta');
            return;
        }

        if (estadoUsuarios[usuario]?.opcion === 'esperando_camion') {
            const opciones = { '1': 'HFSW85', '2': 'RXTH24', '3': 'PCTV91', '4': 'KBFD31' };
            const patente = opciones[texto] || texto.toUpperCase().trim();
            if (camiones[patente]) {
                estadoUsuarios[usuario] = { opcion: 'cierre', patente: patente, chofer: camiones[patente] };
                await sendMessage(usuario, `✅ Camión ${patente} seleccionado.\n📋 Ahora envía la foto de la guía.`);
            } else {
                await sendMessage(usuario, '⚠️ Opción no válida.\n\n1️⃣ HFSW85\n2️⃣ RXTH24\n3️⃣ PCTV91\n4️⃣ KBFD31');
            }
            return;
        }

        if (textoLower === 'crear ruta') {
            estadoUsuarios[usuario] = { opcion: 'ruta' };
            await sendMessage(usuario, '🗺️ Perfecto! Envía la foto del informe de carga para generar la ruta.');
            return;
        }

        if (textoLower === 'crear cierre') {
            estadoUsuarios[usuario] = { opcion: 'esperando_camion' };
            await sendMessage(usuario, '🚛 ¿Qué camión?\n\n1️⃣ HFSW85\n2️⃣ RXTH24\n3️⃣ PCTV91\n4️⃣ KBFD31');
            return;
        }

        if (!estadoUsuarios[usuario]?.opcion) {
            await sendMessage(usuario, 'Escribe *hola* para ver el menú.');
        }
    }

    if (tipo === 'image') {
        if (!estadoUsuarios[usuario]?.opcion || estadoUsuarios[usuario]?.opcion === 'esperando_menu' || estadoUsuarios[usuario]?.opcion === 'esperando_camion') {
            await sendMessage(usuario, 'Por favor primero elige una opción:\n\n1️⃣ Crear cierre\n2️⃣ Crear ruta');
            return;
        }

        const mediaId = message.image.id;
        const media = await downloadMedia(mediaId);

        if (estadoUsuarios[usuario].opcion === 'cierre') {
            const patente = estadoUsuarios[usuario].patente;
            const chofer = estadoUsuarios[usuario].chofer;

            try {
                const response = await anthropic.messages.create({
                    model: 'claude-haiku-4-5',
                    max_tokens: 200,
                    messages: [{
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: media.mimeType,
                                    data: media.data
                                }
                            },
                            {
                                type: 'text',
                                text: `Analiza esta imagen de una guía de envío de Sodimac.
                                Extrae exactamente estos dos datos:
                                1. El valor que aparece al lado de "Origen:"
                                2. El valor numérico que aparece al lado de "Id.Ruta:"
                                
                                Responde ÚNICAMENTE en este formato JSON exacto, sin texto adicional:
                                {"tienda": "VALOR", "id": "VALOR"}
                                
                                Si no encuentras algún valor, pon "NO_ENCONTRADO" en ese campo.`
                            }
                        ]
                    }]
                });

                const respuestaTexto = response.content[0].text.trim();
                const jsonLimpio = respuestaTexto.replace(/```json|```/g, '').trim();
                const datos = JSON.parse(jsonLimpio);

                if (datos.tienda === 'NO_ENCONTRADO' || datos.id === 'NO_ENCONTRADO') {
                    await sendMessage(usuario, '⚠️ No pude leer la imagen. Intenta con una foto más clara.');
                    return;
                }

                await sendMessage(usuario,
`Transporte: Virgen de la puerta
Chofer: ${chofer}
Patente: ${patente}
Tienda: ${datos.tienda}
ID: ${datos.id}
Ruta al 100% ✅`);

            } catch (error) {
                console.error('Error cierre:', error);
                await sendMessage(usuario, '⚠️ No pude leer la imagen. Intenta con una foto más clara.');
            }
        }

        if (estadoUsuarios[usuario].opcion === 'ruta') {
            try {
                await sendMessage(usuario, '⏳ Analizando el informe, espera un momento...');

                const response = await anthropic.messages.create({
                    model: 'claude-haiku-4-5',
                    max_tokens: 3000,
                    messages: [{
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: media.mimeType,
                                    data: media.data
                                }
                            },
                            {
                                type: 'text',
                                text: `Lee este documento de Sodimac Chile con mucho cuidado.
                                Extrae TODAS las direcciones de entrega de cada reserva.
                                Cada bloque empieza con "Reserva:" y tiene una COMUNA en mayúsculas después de "Canal:XX".
                                La dirección tiene nombre de calle y número.
                                
                                REGLAS:
                                - Solo extrae lo que aparece literalmente
                                - NO incluyas nombres de personas ni productos
                                - Una dirección DEBE tener número
                                - NO repitas direcciones
                                
                                Responde ÚNICAMENTE con este JSON:
                                {"direcciones": ["COMUNA, CALLE NUMERO, Chile"]}
                                
                                Si no encuentras: {"direcciones": []}`
                            }
                        ]
                    }]
                });

                const respuestaTexto = response.content[0].text.trim();
                const jsonLimpio = respuestaTexto.replace(/```json|```/g, '').trim();
                const datos = JSON.parse(jsonLimpio);

                if (!datos.direcciones || datos.direcciones.length === 0) {
                    await sendMessage(usuario, '⚠️ No encontré direcciones. Intenta con una foto más clara.');
                    return;
                }

                const direccionesUnicas = [...new Set(datos.direcciones)];
                const linkCompleto = `https://www.google.com/maps/dir/${direccionesUnicas.map(d => encodeURIComponent(d)).join('/')}`;

                await sendMessage(usuario, `🗺️ Ruta generada con ${direccionesUnicas.length} paradas:\n\n🔗 Ver ruta completa:\n${linkCompleto}`);

                for (let i = 0; i < direccionesUnicas.length; i++) {
                    const direccion = direccionesUnicas[i];
                    const linkParada = `https://maps.google.com/?q=${encodeURIComponent(direccion)}`;
                    await sendMessage(usuario, `📍 Parada ${i + 1}:\n${direccion}\n🔗 ${linkParada}`);
                }

            } catch (error) {
                console.error('Error ruta:', error);
                await sendMessage(usuario, '⚠️ Ocurrió un error. Intenta de nuevo.');
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Bot corriendo en puerto ${PORT}`);
});