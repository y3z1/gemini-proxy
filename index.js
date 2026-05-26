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

app.post('/claude', async (req, res) => {
  try {
    const { system, messages } = req.body;

    console.log('Messages count:', messages?.length);
    console.log('System length:', system?.length);

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const cleanContents = [];
    for (const msg of contents) {
      const last = cleanContents[cleanContents.length - 1];
      if (last && last.role === msg.role) {
        last.parts[0].text += '\n' + msg.parts[0].text;
      } else {
        cleanContents.push(msg);
      }
    }

    const body = {
      system_instruction: { parts: [{ text: (system || '').substring(0, 8000) }] },
      contents: cleanContents,
      generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await r.json();
    console.log('Gemini status:', r.status);
    console.log('Gemini response:', JSON.stringify(data).substring(0, 500));

    if (!r.ok) {
      return res.status(r.status).json({ error: data });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No pude generar una respuesta.';
    res.json({ content: [{ type: 'text', text }] });

  } catch(e) {
    console.error('Error:', e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy corriendo en puerto ${PORT}`));
