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

function calculateRequiredYears(target, monthlyInvestment, annualReturn = 0.10) {
  // FV = P * [((1 + r)^n - 1) / r] * (1 + r)
  // Solve for n (years)
  let r = annualReturn;
  let P = monthlyInvestment;
  let FV = target;
  let n = 1;
  while (P * ((Math.pow(1 + r, n) - 1) / r) * (1 + r) < FV && n < 100) {
    n++;
  }
  return n;
}

function calculateSIP(goal, years, annualRate) {
  const r = annualRate / 12;
  const n = years * 12;
  const factor = (Math.pow(1 + r, n) - 1) / r * (1 + r);
  return Math.round(goal / factor);
}

const monthlyInvestment = calculateSIP(25000000, 20, 0.12);
console.log(monthlyInvestment); // ~25116

function validateRetirementPlan(plan) {
  // Find the retirement goal (case-insensitive)
  const goal = plan.goals.find(g => g.name && g.name.toLowerCase().includes('retire'));
  
  // If the retirement target is suspiciously low, scale it up (e.g., lakh → crore)
  if (goal && goal.target_amount < 10000000) {
    goal.target_amount *= 10;
  }

  // Normalize portfolio allocation if values are in decimals (e.g., 0.2 instead of 20)
  if (Object.values(plan.portfolio_allocation).some(v => v <= 1)) {
    for (let key in plan.portfolio_allocation) {
      plan.portfolio_allocation[key] = Math.round(plan.portfolio_allocation[key] * 100);
    }
  }

  // Optionally remove 'emergency' from allocation if it's not part of the main portfolio
  if (plan.portfolio_allocation.emergency > 0) {
    delete plan.portfolio_allocation.emergency;
  }

  return plan;
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
If the user's current savings and investment capacity are not sufficient to achieve a goal in the requested time, recommend a more realistic duration required to reach the target amount, assuming an 8–12% annual return. Clearly state the adjusted duration in the JSON output.
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

    // Assume you have already parsed plan, and extracted income/expenses from the user message if possible
    let income, expenses;

    // Try to extract monthly income and expenses from the user message
    const incomeMatch = userMessage.match(/income[^\\d]*(\\d+[\\d,]*)[^\\d]*(per year|annually|a year)/i);
    const expensesMatch = userMessage.match(/expenses[^\\d]*(\\d+[\\d,]*)[^\\d]*(per year|annually|a year)/i);
    if (incomeMatch) income = Math.round(parseInt(incomeMatch[1].replace(/,/g, '')) / 12);
    if (expensesMatch) expenses = Math.round(parseInt(expensesMatch[1].replace(/,/g, '')) / 12);

    // Validate and correct the plan
    if (plan && typeof income === 'number' && typeof expenses === 'number') {
      if (plan.monthly_savings !== income - expenses) {
        plan.monthly_savings = income - expenses;
      }
      if (plan.monthly_recommended_investment > plan.monthly_savings) {
        plan.monthly_recommended_investment = plan.monthly_savings;
      }
      if (
        plan &&
        plan.goals &&
        plan.goals.length > 0 &&
        plan.monthly_recommended_investment &&
        plan.goals[0].target_amount &&
        plan.goals[0].duration_years
      ) {
        const requiredYears = calculateRequiredYears(
          plan.goals[0].target_amount,
          plan.monthly_recommended_investment
        );
        if (requiredYears > plan.goals[0].duration_years) {
          plan.goals[0].duration_years = requiredYears;
          summary += `\nNote: To achieve your goal of ₹${plan.goals[0].target_amount}, you may need approximately ${requiredYears} years with your current investment capacity.`;
        }
      }
    }

    plan = validateRetirementPlan(plan);

    res.json({ summary, plan });
  } catch (error) {
    console.error('OpenRouter API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to process request.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 