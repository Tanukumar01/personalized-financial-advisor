require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Helper: Simple financial plan generator (fallback)
function generateFinancialPlan({ income = 100000, expenses = 50000, goals = [], risk = 2 }) {
  const monthly_savings = income - expenses;
  const recommended_investment = Math.round(monthly_savings * 0.6);
  let portfolio_allocation;
  if (risk === 1) {
    portfolio_allocation = { equity: 20, debt: 60, gold: 10, emergency: 10 };
  } else if (risk === 3) {
    portfolio_allocation = { equity: 70, debt: 15, gold: 10, emergency: 5 };
  } else {
    portfolio_allocation = { equity: 50, debt: 30, gold: 10, emergency: 10 };
  }
  
  // Example goal corpus calculation (SIP growth at 12%)
  const calcTargetCorpus = (goal) => {
    const years = goal.duration_years || 5;
    const rate = 0.12;
    return Math.round((goal.monthly_investment || recommended_investment) * ((Math.pow(1 + rate, years) - 1) / rate) * (1 + rate));
  };
  const structuredGoals = goals.map(g => ({
    name: g.name,
    target_amount: g.target_amount || calcTargetCorpus(g),
    duration_years: g.duration_years || 5
  }));
  return {
    monthly_savings,
    recommended_investment,
    portfolio_allocation,
    goals: structuredGoals
  };
}

// Rule-based risk profiler
function getRiskProfile(userMessage) {
  const msg = userMessage.toLowerCase();
  if (msg.includes('safe') || msg.includes('conservative') || msg.includes('secure')) return 1;
  if (msg.includes('aggressive') || msg.includes('high return') || msg.includes('growth')) return 3;
  return 2; // default moderate
}

// POST /api/chat endpoint
app.post('/api/chat', async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    // Call OpenRouter API (Llama3 or similar)
    const openRouterResponse = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'meta-llama/llama-3-70b-instruct',
        messages: [
          {
            role: 'system',
            content: `
You are an intelligent financial planning assistant.

Your task is to:
1. Extract financial details from the user's message (income, expenses, risk profile, goals).
2. Estimate monthly savings as income - expenses.
3. Calculate the recommended monthly investment required to meet each goal, assuming an 8–12% annual return depending on the risk profile.
4. Assign a portfolio allocation based on risk level:
   - Low risk: equity 10–25%, debt 50–60%, gold 5–10%, emergency 10–20%
   - Moderate risk: equity 40–60%, debt 20–30%, gold 10%, emergency 10–20%
   - High risk: equity 70–80%, debt 10–20%, gold 5–10%, emergency 5–10%

Return ONLY a valid JSON object in this exact format — with no explanation, no markdown, and no extra characters:

{
  "monthly_savings": 0,
  "monthly_recommended_investment": 0,
  "portfolio_allocation": {
    "equity": 0,
    "debt": 0,
    "gold": 0,
    "emergency": 0
  },
  "goals": [
    {
      "name": "Goal Name",
      "target_amount": 0,
      "duration_years": 0
    }
  ]
}

If any field is missing or approximate, use reasonable estimates based on typical financial logic.
`
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 512
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`, //use openrouter api key
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract the model's reply
    const aiReply = openRouterResponse.data.choices[0].message.content;
    let plan;
    try {
      let jsonString = aiReply.trim();
      if (jsonString.startsWith('```')) {
        jsonString = jsonString.replace(/```[a-z]*\\n?/gi, '').replace(/```$/, '').trim();
      }
      plan = JSON.parse(jsonString);
      res.json(plan);
    } catch (e) {
      // If AI does not return valid JSON, return an error
      res.status(500).json({ error: "AI did not return a valid structured plan." });
      return;
    }
  } catch (error) {
    console.error('OpenRouter API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 