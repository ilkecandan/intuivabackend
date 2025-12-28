// server.js - Example Core Structure
const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors()); // Allow requests from your frontend domain
app.use(express.json());

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'; // Verify the correct endpoint
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY; // Set this in Railway variables

// The key endpoint for generating tasks
app.post('/api/generate-tasks', async (req, res) => {
    try {
        const userAnswers = req.body.answers; // Expects { "0": "Answer to Q1", "1": "..." }
        const questions = req.body.questions; // Send questions for context

        // 1. Construct the AI Prompt
        const prompt = constructProjectManagerPrompt(userAnswers, questions);

        // 2. Call DeepSeek API
        const aiResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat", // or the latest model
            messages: [
                { role: "system", content: "You are an expert project manager and Agile/Lean consultant." },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 2000
        }, {
            headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }
        });

        // 3. Parse the AI's text response into a structured task list
        const generatedTasksText = aiResponse.data.choices[0].message.content;
        const tasks = parseAITasks(generatedTasksText); // You need to write this parser

        // 4. Send tasks back to frontend
        res.json({ success: true, tasks: tasks });

    } catch (error) {
        console.error('DeepSeek API Error:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Failed to generate tasks', fallbackTasks: [] });
    }
});

// Helper function to build a detailed prompt
function constructProjectManagerPrompt(answers, questions) {
    let promptText = `Act as a senior project manager. Based on the following Q&A from a project discovery session, generate a concise, actionable Kanban task list.

    **INSTRUCTIONS:**
    1. Analyze the user's answers to infer project scope, goals, and risks.
    2. Generate 5-8 specific tasks. Prioritize them (High/Medium).
    3. Assign each to a relevant category (todo, inprogress, done). Most should be 'todo'.
    4. Format EACH task as a JSON object with: id, title, description, status, priority, tags.
    5. If answers are generic or empty, suggest foundational project setup tasks.
    6. OUTPUT ONLY a valid JSON array. Example: [{"id":"1", "title":"...", ...}]

    **QUESTIONS AND ANSWERS:**\n`;
    // ... (logic to combine Q&A) ...
    promptText += "\n\nNow, generate the task list JSON array:";
    return promptText;
}

// Helper function to extract JSON from AI text response
function parseAITasks(text) {
    try {
        // Find JSON array pattern in the response
        const jsonMatch = text.match(/\[\s*\{.*\}\s*\]/s);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch (e) {
        console.error("Parsing AI tasks failed:", e);
        return []; // Return empty, triggering fallback in frontend
    }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
