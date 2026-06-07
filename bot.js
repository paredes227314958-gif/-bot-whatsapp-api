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

async function sendButtons(to, message, buttons) {
    await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: message },
                action: {
                    buttons: buttons.map(btn => ({
                        type: 'reply',
                        reply: { id: btn.id, title: btn.title }
                    }))
                }
            }
        },
        {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        }
    );
}

async function sendList(to, message, items) {
    await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: message },
                action: {
                    button: 'Ver opciones',
                    sections: [{
                        title: 'Camiones disponibles',
                        rows: items.map(item => ({
                            id: item.id,
                            title: item.title
                        }))
                    }]
                }
            }
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

async function procesarCierre(usuario, patente, chofer) {
    const media = estadoUsuarios[usuario].foto;
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

        estadoUsuarios[usuario] = null;

    } catch (error) {
        console.error('Error cierre:', error);
        await sendMessage(usuario, '⚠️ No pude leer la imagen. Intenta con una foto más clara.');
    }
}

async function procesarRuta(usuario) {
    const media = estadoUsuarios[usuario].foto;
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

        estadoUsuarios[usuario] = null;

    } catch (error) {
        console.error('Error ruta:', error);
        await sendMessage(usuario, '⚠️ Ocurrió un error. Intenta de nuevo.');
    }
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

    if (tipo === 'image') {
        const mediaId = message.image.id;
        const media = await downloadMedia(mediaId);

        estadoUsuarios[usuario] = { foto: media, opcion: 'esperando_opcion' };

        await sendButtons(usuario, '📋 ¿Qué deseas hacer con esta imagen?', [
            { id: 'crear_cierre', title: '📋 Crear cierre' },
            { id: 'crear_ruta', title: '🗺️ Crear ruta' }
        ]);
        return;
    }

    if (tipo === 'interactive') {
        const buttonId = message.interactive.button_reply?.id || message.interactive.list_reply?.id;

        if (buttonId === 'crear_cierre') {
            estadoUsuarios[usuario] = { ...estadoUsuarios[usuario], opcion: 'esperando_camion' };
            await sendList(usuario, '🚛 ¿Qué camión?', [
                { id: 'camion_HFSW85', title: 'HFSW85' },
                { id: 'camion_RXTH24', title: 'RXTH24' },
                { id: 'camion_PCTV91', title: 'PCTV91' },
                { id: 'camion_KBFD31', title: 'KBFD31' }
            ]);
            return;
        }

        if (buttonId === 'crear_ruta') {
            await procesarRuta(usuario);
            return;
        }

        if (buttonId.startsWith('camion_')) {
            const patente = buttonId.replace('camion_', '');
            const chofer = camiones[patente];
            await procesarCierre(usuario, patente, chofer);
            return;
        }
    }

    if (tipo === 'text') {
        await sendMessage(usuario, '📸 Manda una foto de la guía para comenzar.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Bot corriendo en puerto ${PORT}`);
});