export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  // Basic validation
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // This env variable is set in your Vercel dashboard — never hardcode it here
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        // OpenRouter recommends sending these two headers
        'HTTP-Referer': process.env.SITE_URL || 'https://localhost',
        'X-Title': 'My Chatbot',
      },
      body: JSON.stringify({
        // Pick any model available on openrouter.ai/models
        // Free options: 'mistralai/mistral-7b-instruct' or 'meta-llama/llama-3-8b-instruct'
        // Good paid options: 'openai/gpt-4o' or 'anthropic/claude-3.5-sonnet'
        model: 'baidu/ernie-5.5-flash-preview:free',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful, friendly assistant. Keep answers clear and concise.',
          },
          ...messages,
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenRouter error:', errorData);
      return res.status(response.status).json({
        error: errorData.error?.message || 'OpenRouter request failed',
      });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
