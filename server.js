const express = require('express');
const cors = require('cors');
require('dotenv').config();
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load environment variables
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_AI;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'Intuiva AI Backend is running' });
});

// AI Task Generation Endpoint
app.post('/api/generate-tasks', async (req, res) => {
    try {
        const { answers, questions, userContext } = req.body;
        
        if (!DEEPSEEK_API_KEY) {
            return res.status(500).json({ 
                error: 'AI service not configured',
                tasks: generateFallbackTasks(answers, questions) 
            });
        }

        // Prepare the prompt for DeepSeek
        const prompt = createAIPrompt(answers, questions, userContext);
        
        // Call DeepSeek API
        const aiTasks = await callDeepSeekAPI(prompt);
        
        // If AI fails, use fallback
        if (!aiTasks || aiTasks.length === 0) {
            const fallbackTasks = generateFallbackTasks(answers, questions);
            return res.json({ tasks: fallbackTasks, source: 'fallback' });
        }
        
        res.json({ tasks: aiTasks, source: 'ai' });
        
    } catch (error) {
        console.error('AI Generation Error:', error);
        
        // Always return fallback tasks on error
        const fallbackTasks = generateFallbackTasks(req.body.answers, req.body.questions);
        res.json({ tasks: fallbackTasks, source: 'fallback-error' });
    }
});

// Function to call DeepSeek API
async function callDeepSeekAPI(prompt) {
    try {
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: `You are an expert project manager and Kanban board specialist. 
                        Analyze the user's project context and generate actionable tasks for a Kanban board.
                        IMPORTANT: Return ONLY a valid JSON array of task objects. No explanations, no markdown, just JSON.`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            throw new Error(`DeepSeek API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0]?.message?.content;
        
        // Parse the AI response
        return parseAIResponse(aiResponse);
        
    } catch (error) {
        console.error('DeepSeek API call failed:', error);
        return null;
    }
}

// Create AI prompt based on user answers
function createAIPrompt(answers, questions, userContext = {}) {
    let prompt = `Generate Kanban tasks for a project manager based on these questionnaire answers:\n\n`;
    
    // Add questions and answers
    Object.entries(answers).forEach(([index, answer]) => {
        const questionIndex = parseInt(index);
        if (questionIndex < questions.length) {
            const question = questions[questionIndex];
            prompt += `Category: ${question.category}\n`;
            prompt += `Question: ${question.text}\n`;
            prompt += `Answer: ${answer}\n\n`;
        }
    });
    
    // Add user context if provided
    if (userContext.projectType) {
        prompt += `Project Type: ${userContext.projectType}\n`;
    }
    if (userContext.teamSize) {
        prompt += `Team Size: ${userContext.teamSize}\n`;
    }
    if (userContext.timeline) {
        prompt += `Timeline: ${userContext.timeline}\n`;
    }
    
    prompt += `\nBased on this information, generate 5-15 actionable Kanban tasks with:
    1. Clear, specific titles
    2. Detailed descriptions
    3. Priority levels (high, medium, low)
    4. Relevant tags/categories
    5. Initial status (todo, inprogress, done)
    
    Format each task as a JSON object with these fields:
    - id (auto-generated, just use "ai_" + random number)
    - title
    - description
    - status (default: "todo")
    - priority ("high", "medium", or "low")
    - tags (array of relevant keywords)
    
    Return ONLY a valid JSON array.`;
    
    return prompt;
}

// Parse AI response to extract JSON
function parseAIResponse(aiResponse) {
    try {
        // Try to extract JSON from the response
        const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const tasks = JSON.parse(jsonMatch[0]);
            
            // Validate and format tasks
            return tasks.map(task => ({
                id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: task.title || 'Untitled Task',
                description: task.description || '',
                status: task.status || 'todo',
                priority: task.priority || 'medium',
                tags: Array.isArray(task.tags) ? task.tags : [],
                createdAt: new Date().toISOString(),
                source: 'ai'
            }));
        }
        return [];
    } catch (error) {
        console.error('Failed to parse AI response:', error);
        return [];
    }
}

// Fallback task generator (existing logic)
function generateFallbackTasks(answers, questions) {
    const tasks = [];
    const hasValidAnswers = Object.values(answers).some(answer => 
        answer && answer !== '[Skipped]' && answer !== '[Not Applicable]'
    );
    
    if (!hasValidAnswers) {
        // Return generic project management tasks
        return [
            {
                id: `fb_${Date.now()}_1`,
                title: 'Define project scope and objectives',
                description: 'Clearly document what the project will and will not deliver',
                status: 'todo',
                priority: 'high',
                tags: ['planning', 'scope'],
                source: 'fallback'
            },
            {
                id: `fb_${Date.now()}_2`,
                title: 'Identify key stakeholders',
                description: 'List all stakeholders and define communication plan',
                status: 'todo',
                priority: 'medium',
                tags: ['stakeholders', 'communication'],
                source: 'fallback'
            },
            {
                id: `fb_${Date.now()}_3`,
                title: 'Set up project repository',
                description: 'Create Git repository with proper branching strategy',
                status: 'todo',
                priority: 'high',
                tags: ['setup', 'development'],
                source: 'fallback'
            }
        ];
    }
    
    // Generate tasks based on answers (your existing logic)
    // ... include your existing generateTasksBasedOnAnswers logic here
    
    return tasks.length > 0 ? tasks : [
        {
            id: `fb_${Date.now()}_default`,
            title: 'Start project planning',
            description: 'Begin with initial project setup and planning phase',
            status: 'todo',
            priority: 'medium',
            tags: ['planning', 'setup'],
            source: 'fallback'
        }
    ];
}

app.listen(PORT, () => {
    console.log(`AI Backend running on port ${PORT}`);
});
