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

First, provide a brief, user-friendly summary of the financial plan in plain English, highlighting key recommendations (monthly savings, investment, portfolio allocation, and goals). Then, return ONLY a valid JSON object in this format (no markdown):

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
        max_tokens: 700
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Extract the model's reply
    const aiReply = openRouterResponse.data.choices[0].message.content;
    // Split summary and JSON
    let summary = '';
    let plan = null;
    const jsonStart = aiReply.indexOf('{');
    if (jsonStart !== -1) {
      summary = aiReply.slice(0, jsonStart).trim();
      let jsonString = aiReply.slice(jsonStart).trim();
      if (jsonString.startsWith('```')) {
        jsonString = jsonString.replace(/```[a-z]*\n?/gi, '').replace(/```$/, '').trim();
      }
      try {
        plan = JSON.parse(jsonString);
      } catch (e) {
        return res.status(500).json({ error: "AI did not return a valid structured plan.", summary });
      }
    } else {
      summary = aiReply.trim();
    }
    res.json({ summary, plan });
  } catch (error) {
    console.error('OpenRouter API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 