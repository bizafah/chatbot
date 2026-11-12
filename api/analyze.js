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

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured on the server.' });
  }

  const {
    jobTitle           = 'Not specified',
    jobDescription     = '',
    requiredSkills     = '',
    experienceYears    = 0,
    passThreshold      = 70,
    additionalCriteria = '',
  } = config;

  // ── Prompts ───────────────────────────────────────────────────────────────
  // NOTE: Ernie models ignore system role on some versions — we embed
  // everything in the user turn to guarantee it is read.
  const userPrompt = `You are an expert ATS (Applicant Tracking System) and senior HR specialist.
Evaluate the resume below against the job requirements and respond with ONLY a JSON object — no prose, no markdown, no explanation, nothing else before or after the JSON.

=== JOB REQUIREMENTS ===
Job Title: ${jobTitle}
Job Description: ${jobDescription || 'Not provided'}
Required Skills: ${requiredSkills || 'Not specified'}
Minimum Experience: ${experienceYears} year(s)
Additional Criteria: ${additionalCriteria || 'None'}
Pass Threshold (context only): ${passThreshold}%

=== RESUME ===
${resumeText.slice(0, 10000)}

=== INSTRUCTIONS ===
Return ONLY this exact JSON structure with real values filled in. No text before or after it.

{
  "candidateName": "FULL NAME FROM RESUME OR Unknown",
  "overallScore": 72,
  "verdict": "Recommended",
  "breakdown": {
    "Skills Match": 80,
    "Experience Level": 70,
    "Education": 65,
    "Job Description Fit": 75,
    "Communication": 70
  },
  "strengths": [
    "Strength one",
    "Strength two",
    "Strength three"
  ],
  "gaps": [
    "Gap one",
    "Gap two"
  ],
  "feedback": "3 to 5 sentences of honest hiring manager feedback about this candidate."
}

Rules:
- overallScore must be a number 0-100
- All breakdown values must be numbers 0-100
- verdict must be exactly one of: Recommended | Review Recommended | Not Recommended
- strengths and gaps must be arrays of plain strings
- Output ONLY the JSON. No markdown fences. No extra words.`;

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
        model:       'baidu/ernie-5.5-flash-preview:free',
        messages:    [{ role: 'user', content: userPrompt }],
        max_tokens:  1400,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('OpenRouter error:', errData);
      return res.status(response.status).json({
        error: errData.error?.message || `OpenRouter returned status ${response.status}`,
      });
    }

    const data       = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    console.log('Raw LLM output:', rawContent); // visible in Vercel function logs

    // ── Aggressive JSON extraction ────────────────────────────────────────
    const parsed = extractJSON(rawContent);

    if (!parsed) {
      return res.status(500).json({
        error: 'The AI returned an unexpected format. Please try again.',
        raw: rawContent,
      });
    }

    // ── Sanitise / clamp ──────────────────────────────────────────────────
    parsed.overallScore  = clamp(parsed.overallScore);
    parsed.candidateName = str(parsed.candidateName, 'Unknown');
    parsed.verdict       = str(parsed.verdict, 'Review Recommended');
    parsed.feedback      = str(parsed.feedback, '');
    parsed.strengths     = arr(parsed.strengths);
    parsed.gaps          = arr(parsed.gaps);

    if (parsed.breakdown && typeof parsed.breakdown === 'object') {
      for (const key of Object.keys(parsed.breakdown)) {
        parsed.breakdown[key] = clamp(parsed.breakdown[key]);
      }
    } else {
      parsed.breakdown = {
        'Skills Match':        parsed.overallScore,
        'Experience Level':    parsed.overallScore,
        'Education':           parsed.overallScore,
        'Job Description Fit': parsed.overallScore,
        'Communication':       parsed.overallScore,
      };
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Try multiple strategies to pull a JSON object out of raw LLM text.
 * Returns the parsed object or null.
 */
function extractJSON(raw) {
  if (!raw) return null;

  // Strategy 1: direct parse (model obeyed instructions perfectly)
  try { return JSON.parse(raw.trim()); } catch (_) {}

  // Strategy 2: strip ```json ... ``` or ``` ... ``` fences
  const fenced = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();
  try { return JSON.parse(fenced); } catch (_) {}

  // Strategy 3: find the first { ... } block that spans the whole response
  const firstBrace = raw.indexOf('{');
  const lastBrace  = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch (_) {}
  }

  // Strategy 4: regex-extract every {...} candidate (handles extra text around JSON)
  const matches = raw.match(/\{[\s\S]*?\}/g);
  if (matches) {
    // Try longest match first (most likely to be the full object)
    const sorted = matches.sort((a, b) => b.length - a.length);
    for (const candidate of sorted) {
      try { return JSON.parse(candidate); } catch (_) {}
    }
  }

  return null;
}

function clamp(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : Math.min(100, Math.max(0, Math.round(n)));
}

function str(val, fallback) {
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

function arr(val) {
  return Array.isArray(val) ? val.filter(x => typeof x === 'string').slice(0, 8) : [];
}
