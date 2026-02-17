export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { messages } = await req.json();
  const query = messages[messages.length - 1].content;

  // DuckDuckGo context (kept simple)
  let context = 'Using general knowledge.';
  try {
    const search = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
    const data = await search.json();
    context = data.AbstractText || context;
  } catch {}

  // Your tiered models
  const modelStack = [
    // FAST
    'stepfun/step-3.5-flash:free',
    'nvidia/nemotron-nano-9b-v2:free',
    'google/gemma-3-4b-it:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'qwen/qwen3-4b:free',
    // BALANCED
    'google/gemma-3-12b-it:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'z-ai/glm-4.5-air:free',
    'upstage/solar-pro-3:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    // HEAVY
    'deepseek/deepseek-r1-0528:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'openai/gpt-oss-120b:free',
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let modelUsed = null;
  let hasReplied = false;

  for (const model of modelStack) {
    if (hasReplied) break;

    res.write(`data: {"status":"Trying ${model.split('/').pop().replace(':free','')}..."}\n\n`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3200); // 3.2s max wait for first token

      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://your-vercel-domain.vercel.app', // optional but good
          'X-Title': 'Honest25-AI',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `You are Honest25-AI. Use context if helpful: ${context}. Be direct and friendly.` },
            ...messages,
          ],
          stream: true,
          temperature: 0.7,
        }),
      });

      clearTimeout(timeout);

      if (!apiRes.ok) throw new Error(`HTTP ${apiRes.status}`);

      const reader = apiRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
                hasReplied = true;
              }
            } catch {}
          }
        }
      }

      if (hasReplied) {
        modelUsed = model;
        res.write(`data: ${JSON.stringify({ done: true, modelUsed })}\n\n`);
      }

    } catch (err) {
      // Timeout or error → log & continue to next model
      console.log(`Model ${model} failed: ${err.message}`);
      if (!hasReplied) {
        res.write(`data: {"status":"${model} slow – jumping to next..."}\n\n`);
      }
      continue;
    }
  }

  if (!hasReplied) {
    res.write(`data: ${JSON.stringify({ content: 'Sorry, all models are slow right now. Try again in a minute.' })}\n\n`);
  }

  res.end();
}
