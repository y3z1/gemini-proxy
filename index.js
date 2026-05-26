const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => res.send('Gemini Proxy activo ✓'));

const SB_URL = 'https://tnncnfyfdriewlwokprv.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubmNuZnlmZHJpZXdsd29rcHJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NDQxNjYsImV4cCI6MjA5NTEyMDE2Nn0.wAbMIqCgJ3pb7gQUAM4LvWkUwlMxbEAqfKmqGWkgOFs';

// Cache to avoid loading docs on every request
let cachedContext = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function getContexto() {
  if (cachedContext && Date.now() - cacheTime < CACHE_TTL) {
    return cachedContext;
  }
  try {
    const [docsRes, actasRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/documentos?tipo=eq.estatutos&select=contenido`, {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      }),
      fetch(`${SB_URL}/rest/v1/actas_ia?order=created_at.asc&select=fecha,contenido`, {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      })
    ]);

    const docs = await docsRes.json();
    const actas = await actasRes.json();

    // Keep estatutos short - first 3500 chars only
    const estatutos = (docs[0]?.contenido || '').substring(0, 3500);
    // Keep actas recientes concise
    const actasRecientes = actas.map(a => `[${a.fecha}]: ${a.contenido.substring(0, 800)}`).join('\n\n');

    cachedContext = { estatutos, actasRecientes };
    cacheTime = Date.now();
    console.log('Context loaded - estatutos:', estatutos.length, 'actas:', actasRecientes.length);
    return cachedContext;
  } catch(e) {
    console.error('Error fetching context:', e);
    return { estatutos: '', actasRecientes: '' };
  }
}

app.post('/claude', async (req, res) => {
  try {
    const { messages } = req.body;
    const { estatutos, actasRecientes } = await getContexto();

    const SYSTEM = `Eres mArIposItA, asistente del Fondo Familiar Francihelena (fondo de ahorro y crédito familiar colombiano).

ESTATUTOS (resumen):
${estatutos}

ACTAS RECIENTES 2026:
${actasRecientes}

Responde en español, de forma corta y clara. Cita artículos cuando sea relevante. Si no sabes algo, dilo.`;

    const contents = [];
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      const last = contents[contents.length - 1];
      if (last && last.role === role) {
        last.parts[0].text += '\n' + m.content;
      } else {
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }

    if (!contents.length || contents[0].role !== 'user') {
      contents.unshift({ role: 'user', parts: [{ text: 'Hola' }] });
    }

    // Keep only last 4 messages to save tokens
    const recentContents = contents.slice(-4);

    const body = {
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: recentContents,
      generationConfig: { maxOutputTokens: 400, temperature: 0.5 }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    console.log('Status:', r.status);
    if (!r.ok) {
      console.log('Error:', JSON.stringify(data).substring(0, 300));
      return res.status(r.status).json({ error: data });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No pude generar una respuesta.';
    res.json({ content: [{ type: 'text', text }] });

  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
