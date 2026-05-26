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

async function getContexto() {
  try {
    const [docsRes, actasRes] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/documentos?order=created_at.asc`, {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      }),
      fetch(`${SB_URL}/rest/v1/actas_ia?order=created_at.asc`, {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      })
    ]);

    const docs = await docsRes.json();
    const actas = await actasRes.json();

    const estatutos = docs.filter(d => d.tipo === 'estatutos').map(d => d.contenido).join('\n\n');
    const actasHist = docs.filter(d => d.tipo === 'actas_historicas').map(d => d.contenido).join('\n\n');
    const actasRecientes = actas.map(a => `=== ACTA ${a.fecha} ===\n${a.contenido}`).join('\n\n');

    return { estatutos, actasHist, actasRecientes };
  } catch(e) {
    console.error('Error fetching context:', e);
    return { estatutos: '', actasHist: '', actasRecientes: '' };
  }
}

app.post('/claude', async (req, res) => {
  try {
    const { messages } = req.body;
    const { estatutos, actasHist, actasRecientes } = await getContexto();

    const SYSTEM = `Eres el asistente oficial del Fondo Familiar Francihelena, un fondo de ahorro y crédito familiar colombiano fundado en honor a Luis Francisco Adarme y Helena Salazar de Adarme.

Tienes acceso a los estatutos completos, la recopilación histórica de actas 2012-2023, y las actas recientes.

ESTATUTOS COMPLETOS:
${estatutos}

RECOPILACIÓN HISTÓRICA DE ACTAS 2012-2023:
${actasHist}

ACTAS RECIENTES:
${actasRecientes}

INSTRUCCIONES:
- Responde siempre en español, de forma clara y amigable
- Cita el artículo específico cuando respondas sobre estatutos (ej: "Según el Artículo 46...")
- Cuando menciones actas indica el mes y año
- Si no encuentras la información dilo claramente
- Sé conciso pero completo
- Nunca inventes datos que no estén en los documentos`;

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

    if (contents.length && contents[0].role !== 'user') {
      contents.unshift({ role: 'user', parts: [{ text: 'Hola' }] });
    }

    const body = {
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { maxOutputTokens: 800, temperature: 0.5 }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    console.log('Status:', r.status, '| Preview:', JSON.stringify(data).substring(0, 200));

    if (!r.ok) return res.status(r.status).json({ error: data });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No pude generar una respuesta.';
    res.json({ content: [{ type: 'text', text }] });

  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
