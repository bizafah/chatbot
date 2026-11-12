export default async function handler(req, res) {
  // ── Only POST ────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { resumeText, config } = req.body;

  if (!resumeText || typeof resumeText !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid resumeText' });
  }
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid config' });
  }

  // ── API key from Vercel env ───────────────────────────────────────────────
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured on the server.' });
  }

  // ── Build the structured prompt ──────────────────────────────────────────
  const {
    jobTitle          = 'Not specified',
    jobDescription    = '',
    requiredSkills    = '',
    experienceYears   = 0,
    passThreshold     = 70,
    additionalCriteria = '',
  } = config;

  const systemPrompt = `You are an expert ATS (Applicant Tracking System) and senior HR specialist with 15+ years of experience in technical recruiting. Your job is to objectively evaluate resumes against job requirements and return a precise, structured JSON response.

SCORING RULES:
- Be strict but fair. Do not inflate scores.
- Base every score on evidence found in the resume text.
- If a required skill is not mentioned at all, heavily penalise the relevant category.
- Overall score must reflect a weighted average of the breakdown scores.
- passThreshold is for your reference only; do NOT factor it into scoring logic.

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences, no extra text:
{
  "candidateName": "<full name extracted from resume, or 'Unknown' if not found>",
  "overallScore": <0-100 integer>,
  "verdict": "<one of: Recommended | Review Recommended | Not Recommended>",
  "breakdown": {
    "Skills Match":        <0-100>,
    "Experience Level":    <0-100>,
    "Education":           <0-100>,
    "Job Description Fit": <0-100>,
    "Communication":       <0-100>
  },
  "strengths": [
    "<specific strength 1>",
    "<specific strength 2>",
    "<specific strength 3>"
  ],
  "gaps": [
    "<specific gap or missing requirement 1>",
    "<specific gap or missing requirement 2>"
  ],
  "feedback": "<3-5 sentence paragraph of honest, actionable feedback for the hiring manager about this candidate>"
}`;

  const userPrompt = `## JOB REQUIREMENTS

**Job Title:** ${jobTitle}

**Job Description:**
${jobDescription || 'Not provided'}

**Required Skills:** ${requiredSkills || 'Not specified'}

**Minimum Experience Required:** ${experienceYears} year(s)

**Additional Criteria:** ${additionalCriteria || 'None'}

**Pass Threshold (for context only):** ${passThreshold}%

---

## RESUME TEXT

${resumeText.slice(0, 12000)}

---

Evaluate the resume above against the job requirements. Return ONLY the JSON object described in your instructions. Do not include any text before or after the JSON.`;

  // ── Call OpenRouter ───────────────────────────────────────────────────────
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer':  process.env.SITE_URL || 'https://localhost',
        'X-Title':       'ATS Resume Screener',
      },
      body: JSON.stringify({
        model: 'baidu/ernie-5.5-flash-preview:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        max_tokens:  1200,
        temperature: 0.2,   // low temp = consistent, deterministic scoring
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('OpenRouter error:', errData);
      return res.status(response.status).json({
        error: errData.error?.message || `OpenRouter returned status ${response.status}`,
      });
    }

    const data        = await response.json();
    const rawContent  = data.choices?.[0]?.message?.content || '';

    // ── Parse the JSON the LLM returned ────────────────────────────────────
    let parsed;
    try {
      // Strip any accidental markdown fences the model may add
      const cleaned = rawContent
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/,           '')
        .trim();

      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse failed. Raw LLM output:', rawContent);
      return res.status(500).json({
        error: 'The AI returned an unexpected format. Please try again.',
        raw:   rawContent,
      });
    }

    // ── Sanitise / clamp values before returning ────────────────────────────
    parsed.overallScore = Math.min(100, Math.max(0, Math.round(Number(parsed.overallScore) || 0)));

    if (parsed.breakdown && typeof parsed.breakdown === 'object') {
      for (const key of Object.keys(parsed.breakdown)) {
        parsed.breakdown[key] = Math.min(100, Math.max(0, Math.round(Number(parsed.breakdown[key]) || 0)));
      }
    }

    parsed.strengths = Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 8) : [];
    parsed.gaps      = Array.isArray(parsed.gaps)      ? parsed.gaps.slice(0, 8)      : [];
    parsed.feedback  = typeof parsed.feedback === 'string' ? parsed.feedback : '';
    parsed.candidateName = typeof parsed.candidateName === 'string' ? parsed.candidateName : 'Unknown';

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
}
