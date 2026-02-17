export const config = {
  maxDuration: 30, // Vercel setting to allow the function to stay alive during fallbacks
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Use POST');

  const { messages } = await req.json();
  const lastQuery = messages[messages.length - 1].content;

  // 1. DuckDuckGo Search Context
  const search = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(lastQuery)}&format=json&no_html=1`);
  const sData = await search.json();
  const context = sData.AbstractText || "Online Search Context: " + lastQuery;

  // 2. Your Organized Model Tiers
  const modelStack = [
    "stepfun/step-3.5-flash:free",           // Tier 1: Fast
    "nvidia/nemotron-nano-9b-v2:free",      // Tier 1: Fast
    "google/gemma-3-4b-it:free",            // Tier 1: Fast
    "google/gemma-3-12b-it:free",           // Tier 2: Balanced
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "deepseek/deepseek-r1-0528:free",       // Tier 3: Thinking
    "meta-llama/llama-3.3-70b-instruct:free"
  ];

  // 3. The "Manual Jump" Logic
  for (const model of modelStack) {
    try {
      // We set a 3-second 'abort' for the FAST models to ensure quick fallback
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500); 

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "X-Title": "Honest25-AI"
        },
        body: JSON.stringify({
          "model": model, 
          "messages": [
            { "role": "system", "content": `You are Honest25-AI. Context: ${context}` },
            ...messages
          ]
        })
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (data.choices && data.choices[0]) {
        return res.status(200).json({ 
          reply: data.choices[0].message.content,
          modelUsed: model 
        });
      }
    } catch (e) {
      // If the model is slow (3.5s) or fails, the loop moves to the next model immediately
      console.log(`Fallback triggered: ${model} was too slow.`);
      continue; 
    }
  }

  res.status(500).json({ reply: "Honest25-AI is having trouble connecting to all models." });
}
