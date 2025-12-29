const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// The key endpoint for generating tasks
app.post('/api/generate-tasks', async (req, res) => {
    try {
        const userAnswers = req.body.answers || {};
        const questions = req.body.questions || [];

        // 1. Construct the AI Prompt
        const prompt = constructProjectManagerPrompt(userAnswers, questions);

        // 2. Call DeepSeek API
        const aiResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: `You are a practical, hands-on project manager who creates actionable Kanban tasks.
                    Your personality: Enthusiastic, supportive, and focused on execution.
                    Your goal: Turn ANY user input (even minimal, silly, or vague) into practical project tasks.
                    Philosophy: "Every project starts somewhere - let's build momentum!"` 
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.8, // Slightly higher for creative interpretation
            max_tokens: 2500
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            timeout: 30000 // 30 second timeout
        });

        // 3. Parse the AI's response
        const generatedTasksText = aiResponse.data.choices[0].message.content;
        const tasks = parseAITasks(generatedTasksText);

        // 4. Ensure tasks have proper structure
        const validatedTasks = validateAndCompleteTasks(tasks, userAnswers);

        // 5. Send tasks back to frontend
        res.json({ 
            success: true, 
            tasks: validatedTasks,
            note: validatedTasks.length > 0 ? "AI generated tasks based on your input" : "Using default tasks"
        });

    } catch (error) {
        console.error('DeepSeek API Error:', error.response?.data || error.message);
        // Return default tasks as fallback
        res.json({ 
            success: true, 
            tasks: generateDefaultTasks(),
            note: "AI service temporarily unavailable - using recommended starter tasks"
        });
    }
});

// Enhanced prompt construction
function constructProjectManagerPrompt(answers, questions) {
    let qaText = "";
    let hasSubstantialAnswers = false;
    
    // Build Q&A text
    Object.entries(answers).forEach(([index, answer]) => {
        const questionIndex = parseInt(index);
        if (questionIndex < questions.length) {
            const question = questions[questionIndex];
            const answerText = answer || "(No answer provided)";
            
            // Check if answer has substance
            if (answer && answer.trim() && 
                answer !== '[Skipped]' && 
                answer !== '[Not Applicable]' &&
                answer.trim().length > 3) {
                hasSubstantialAnswers = true;
            }
            
            qaText += `Q${parseInt(index) + 1} (${question.category}): ${question.text}\n`;
            qaText += `A${parseInt(index) + 1}: ${answerText}\n\n`;
        }
    });

    const prompt = `ROLE: You are a dedicated project manager helping someone start their project.
CONTEXT: The user has answered some discovery questions. Your job is to create a practical Kanban board for them.

${hasSubstantialAnswers ? 
`ANALYSIS REQUIRED: The user provided some substantial answers. Please analyze their responses and create tasks that:
1. Directly address what they mentioned
2. Expand on their ideas practically
3. Fill in gaps with sensible next steps
4. Prioritize based on what they seem to care about` 
: 
`SITUATION: The user provided minimal or no substantial answers. That's okay! Many people aren't sure where to start.
YOUR APPROACH: Create starter tasks that will help them:
1. Clarify their thinking
2. Discover what they actually want
3. Build momentum with easy wins
4. Establish good project habits`}

SPECIFIC INSTRUCTIONS:
1. Generate 5-8 actionable tasks for a Kanban board
2. Tasks should have: title, description, status ('todo'), priority ('high'/'medium'/'low'), and tags
3. Make tasks CONCRETE and DOABLE (avoid vague tasks)
4. Include at least 2 tasks that directly reference their answers (even if answers were minimal)
5. Mix: Planning tasks + Action tasks + Learning/Research tasks
6. Be encouraging in descriptions - assume they can do this!

FORMAT REQUIREMENTS:
- Return ONLY a valid JSON array
- Each task object MUST have: id, title, description, status, priority, tags
- Example: [{"id":"task_1", "title":"Clarify project goals", "description":"Based on your mention of 'making an app', let's define what success looks like", "status":"todo", "priority":"high", "tags":["planning", "goals"]}]

USER'S Q&A:
${qaText}

IMPORTANT: If the user said something "silly" or minimal, work with it! For example:
- If they said "I dunno": Create "Brainstorm project ideas" task
- If they said "Make money": Create "Research monetization strategies" task
- If they said "Something cool": Create "Define 'cool' for this project" task

Your task list (JSON array only):`;

    return prompt;
}

// Parse AI tasks with better error handling
function parseAITasks(text) {
    try {
        // Clean the text
        const cleanText = text.trim();
        
        // Look for JSON array
        const jsonStart = cleanText.indexOf('[');
        const jsonEnd = cleanText.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
            console.log("No JSON array found in response:", cleanText.substring(0, 200));
            return generateDefaultTasks();
        }
        
        const jsonString = cleanText.substring(jsonStart, jsonEnd);
        const tasks = JSON.parse(jsonString);
        
        // Validate it's an array
        if (!Array.isArray(tasks)) {
            console.log("Response is not an array:", typeof tasks);
            return generateDefaultTasks();
        }
        
        return tasks;
        
    } catch (e) {
        console.error("Parsing AI tasks failed:", e.message);
        console.log("Response snippet:", text.substring(0, 300));
        return generateDefaultTasks();
    }
}

// Validate and complete task structure
function validateAndCompleteTasks(tasks, userAnswers) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return generateDefaultTasks();
    }
    
    return tasks.map((task, index) => {
        // Ensure required fields
        const validatedTask = {
            id: task.id || `task_${Date.now()}_${index}`,
            title: task.title || `Task ${index + 1}`,
            description: task.description || "Action item for your project",
            status: ['todo', 'inprogress', 'done'].includes(task.status) ? task.status : 'todo',
            priority: ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
            tags: Array.isArray(task.tags) ? task.tags : ['project']
        };
        
        // Personalize based on answers if possible
        if (Object.keys(userAnswers).length > 0) {
            const firstAnswer = Object.values(userAnswers).find(a => 
                a && a !== '[Skipped]' && a !== '[Not Applicable]'
            );
            if (firstAnswer && firstAnswer.length > 10) {
                // Add personal touch to first task
                if (index === 0) {
                    validatedTask.description += ` Based on what you shared about "${firstAnswer.substring(0, 50)}...", this is your first step.`;
                }
            }
        }
        
        return validatedTask;
    }).slice(0, 8); // Limit to 8 tasks max
}

// Generate sensible default tasks
function generateDefaultTasks() {
    return [
        {
            id: `default_${Date.now()}_1`,
            title: "Clarify your project vision",
            description: "Write 2-3 sentences about what you want to achieve. Don't worry about perfection - just get ideas down!",
            status: "todo",
            priority: "high",
            tags: ["vision", "planning", "brainstorming"]
        },
        {
            id: `default_${Date.now()}_2`,
            title: "List 3 potential first steps",
            description: "What are the smallest, easiest things you could do to start? Example: 'Research similar projects' or 'Sketch ideas'",
            status: "todo",
            priority: "medium",
            tags: ["action", "momentum", "planning"]
        },
        {
            id: `default_${Date.now()}_3`,
            title: "Identify one resource you need",
            description: "What's one thing (tool, person, information) that would help you move forward?",
            status: "todo",
            priority: "medium",
            tags: ["resources", "planning"]
        },
        {
            id: `default_${Date.now()}_4`,
            title: "Set up project workspace",
            description: "Create a folder for your project files or set up a basic document to collect ideas",
            status: "todo",
            priority: "low",
            tags: ["setup", "organization"]
        },
        {
            id: `default_${Date.now()}_5`,
            title: "Schedule 30 minutes for focused work",
            description: "Block time in your calendar to actually work on this project. Consistency beats intensity!",
            status: "todo",
            priority: "high",
            tags: ["time management", "execution"]
        }
    ];
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Intuiva AI Backend',
        timestamp: new Date().toISOString()
    });
});

// Test endpoint
app.post('/test-prompt', (req, res) => {
    const { answers, questions } = req.body;
    const prompt = constructProjectManagerPrompt(answers || {}, questions || []);
    res.json({ prompt: prompt });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 DeepSeek API Key: ${DEEPSEEK_API_KEY ? 'Set ✅' : 'Missing ❌'}`);
});
