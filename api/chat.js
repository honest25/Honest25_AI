export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { messages } = await req.json();
  const query = messages[messages.length - 1].content;

  // Quick DuckDuckGo (optional context boost)
  let context = '';
  try {
    const search = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
    const data = await search.json();
    context = data.AbstractText || '';
  } catch {}

  const modelStack = [
    // FAST first
    'stepfun/step-3.5-flash:free',
    'nvidia/nemotron-nano-9b-v2:free',
    'google/gemma-3-4b-it:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'qwen/qwen3-4b:free',
    // Balanced
    'google/gemma-3-12b-it:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'z-ai/glm-4.5-air:free',
    // Heavy last
    'deepseek/deepseek-r1-0528:free',
    'meta-llama/llama-3.3-70b-instruct:free',
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let replied = false;

  for (const model of modelStack) {
    if (replied) break;

    res.write(`data: ${JSON.stringify({ status: `Trying ${model.replace(':free', '')}...` })}\n\n`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Title': 'Honest25-AI',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `You are Honest25-AI. ${context ? 'Use this context: ' + context : ''} Be friendly, concise.` },
            ...messages,
          ],
          stream: true,
        }),
      });

      clearTimeout(timeoutId);

      if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);

      const reader = apiRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
                replied = true;
              }
            } catch {}
          }
        }
      }

      if (replied) {
        res.write(`data: ${JSON.stringify({ done: true, modelUsed: model })}\n\n`);
      }
    } catch (err) {
      console.error(`Model ${model} failed:`, err.message);
      if (!replied) {
        res.write(`data: ${JSON.stringify({ status: `${model} slow – switching...` })}\n\n`);
      }
    }
  }

  if (!replied) {
    res.write(`data: ${JSON.stringify({ content: 'All fast models busy right now — try again soon!' })}\n\n`);
  }

  res.end();
}
