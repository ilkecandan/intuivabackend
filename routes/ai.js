const express = require('express');
const router = express.Router();
const axios = require('axios');

// Helper function to analyze answers with AI
async function analyzeWithAI(answers, projectName) {
    try {
        // Check if DeepSeek API key is available
        const apiKey = process.env.DEEPSEEK_API_KEY;
        
        if (!apiKey) {
            console.log('DeepSeek API key not found, using fallback task generation');
            return generateFallbackTasks(answers, projectName);
        }

        // Prepare prompt for AI
        const prompt = createAIPrompt(answers, projectName);
        
        // Call DeepSeek API
        const response = await axios.post(
            'https://api.deepseek.com/v1/chat/completions',
            {
                model: "deepseek-chat",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert project manager and Lean/Kanban specialist. Analyze the project setup answers and generate appropriate tasks for a Kanban board. Focus on actionable, specific tasks that reflect the project's goals and address identified pain points."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 2000,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Parse AI response
        const aiResponse = response.data.choices[0].message.content;
        return parseAIResponse(aiResponse);

    } catch (error) {
        console.error('AI Analysis Error:', error.message);
        // Fallback to generated tasks if AI fails
        return generateFallbackTasks(answers, projectName);
    }
}

// Create comprehensive prompt for AI
function createAIPrompt(answers, projectName) {
    return `
PROJECT ANALYSIS REQUEST
Project Name: ${projectName}

USER'S ANSWERS:
${Object.entries(answers).map(([key, value]) => `
${key.replace(/([A-Z])/g, ' $1').toUpperCase()}:
${value}
`).join('\n')}

INSTRUCTIONS:
Based on these answers, generate 5-10 specific, actionable tasks for a Kanban board. Each task should include:
1. A clear, concise title
2. A brief description
3. Priority (high, medium, low, critical)
4. Suggested assignee role (backend, frontend, design, pm, etc.)
5. Relevant tags
6. Reason why this task is important based on the answers

Format your response as a JSON array with this structure:
[
  {
    "title": "Task title",
    "description": "Task description",
    "priority": "high|medium|low|critical",
    "assignee": "suggested role",
    "tags": ["tag1", "tag2"],
    "reason": "Why this task is important based on user answers"
  }
]

Focus on tasks that:
- Address the pain points mentioned
- Move toward the defined "Done" state
- Implement the suggested workflow improvements
- Set up necessary infrastructure
- Create value for the identified customer
`;
}

// Parse AI response to extract tasks - UPDATED FIX
function parseAIResponse(aiResponse) {
    try {
        console.log('Raw AI Response:', aiResponse.substring(0, 500)); // Debug log
        
        // Try to extract JSON from markdown code blocks
        let jsonString = aiResponse;
        
        // Remove markdown code blocks if present
        if (aiResponse.includes('```json')) {
            jsonString = aiResponse.split('```json')[1].split('```')[0].trim();
        } else if (aiResponse.includes('```')) {
            jsonString = aiResponse.split('```')[1].split('```')[0].trim();
        }
        
        // Clean up any remaining non-JSON text
        const jsonStart = jsonString.indexOf('[');
        const jsonEnd = jsonString.lastIndexOf(']') + 1;
        
        if (jsonStart !== -1 && jsonEnd !== -1) {
            jsonString = jsonString.substring(jsonStart, jsonEnd);
        }
        
        console.log('Cleaned JSON String:', jsonString.substring(0, 300)); // Debug log
        
        const tasks = JSON.parse(jsonString);
        
        // Validate tasks structure
        const validatedTasks = tasks.map(task => ({
            title: task.title || "Untitled Task",
            description: task.description || "No description provided",
            priority: ['critical', 'high', 'medium', 'low'].includes(task.priority?.toLowerCase()) 
                ? task.priority.toLowerCase() 
                : 'medium',
            assignee: task.assignee || 'unassigned',
            tags: Array.isArray(task.tags) ? task.tags : [task.tags || 'general'],
            reason: task.reason || "Task generated based on project analysis"
        }));
        
        return { 
            tasks: validatedTasks, 
            analysis: "AI-generated tasks based on your workflow analysis"
        };
        
    } catch (error) {
        console.error('AI Response Parse Error:', error.message);
        console.error('Failed JSON string:', aiResponse);
        return generateFallbackTasks({}, 'Project');
    }
}

// Generate fallback tasks if AI fails
function generateFallbackTasks(answers, projectName) {
    const tasks = [
        {
            title: "Define project scope and objectives",
            description: "Based on customer identification, clearly outline project boundaries and success criteria",
            priority: "high",
            assignee: "pm",
            tags: ["planning", "strategy", "scope"],
            reason: "Foundation for all subsequent work based on customer focus"
        },
        {
            title: "Map current workflow processes",
            description: "Document existing workflow steps including waiting points and rework areas",
            priority: "high",
            assignee: "analyst",
            tags: ["analysis", "workflow", "documentation"],
            reason: "Addresses workflow visualization and waste identification"
        },
        {
            title: "Set up Kanban board structure",
            description: "Create columns based on identified workflow stages and waiting points",
            priority: "high",
            assignee: "pm",
            tags: ["setup", "kanban", "organization"],
            reason: "Implements the visualized workflow from your answers"
        },
        {
            title: "Define WIP limits for each column",
            description: "Establish work-in-progress limits based on team capacity and workflow analysis",
            priority: "medium",
            assignee: "team-lead",
            tags: ["planning", "limits", "flow"],
            reason: "Implements flow management principles from your answers"
        },
        {
            title: "Create task template with required information",
            description: "Define minimum information needed on each task card for clarity",
            priority: "medium",
            assignee: "pm",
            tags: ["templates", "standards", "documentation"],
            reason: "Addresses card design requirements from practical implementation"
        },
        {
            title: "Set up metrics tracking system",
            description: "Implement cycle time, throughput, and bottleneck tracking",
            priority: "medium",
            assignee: "analyst",
            tags: ["metrics", "analytics", "improvement"],
            reason: "Supports continuous improvement and metric tracking from your answers"
        },
        {
            title: "Create escalation procedure documentation",
            description: "Document clear steps for addressing bottlenecks and blockers",
            priority: "low",
            assignee: "pm",
            tags: ["documentation", "process", "escalation"],
            reason: "Addresses escalation path requirements"
        },
        {
            title: "Plan initial workflow review meeting",
            description: "Schedule first process improvement session based on board metrics",
            priority: "low",
            assignee: "pm",
            tags: ["meeting", "review", "improvement"],
            reason: "Implements review frequency from pursuit of perfection"
        }
    ];
    
    return { 
        tasks, 
        analysis: "Generated comprehensive task list based on Kanban best practices and your project setup"
    };
}

// AI Analysis endpoint
router.post('/analyze', async (req, res) => {
    try {
        const { answers, projectName } = req.body;
        
        if (!answers || typeof answers !== 'object') {
            return res.status(400).json({
                error: 'Invalid request data',
                message: 'Answers object is required'
            });
        }

        console.log('Analyzing project setup for:', projectName);
        console.log('Number of questions answered:', Object.keys(answers).length);

        // Analyze with AI or fallback
        const result = await analyzeWithAI(answers, projectName || 'New Project');
        
        res.json({
            success: true,
            projectName: projectName || 'New Project',
            analysis: result.analysis,
            tasks: result.tasks,
            metrics: {
                totalTasks: result.tasks.length,
                highPriority: result.tasks.filter(t => t.priority === 'high' || t.priority === 'critical').length,
                byAssignee: result.tasks.reduce((acc, task) => {
                    acc[task.assignee] = (acc[task.assignee] || 0) + 1;
                    return acc;
                }, {})
            }
        });

    } catch (error) {
        console.error('Analysis endpoint error:', error);
        res.status(500).json({
            error: 'Failed to analyze project setup',
            message: error.message
        });
    }
});

// Test AI endpoint
router.get('/test', async (req, res) => {
    try {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        
        if (!apiKey) {
            return res.json({
                status: 'configured',
                ai: 'fallback',
                message: 'Using fallback task generation (set DEEPSEEK_API_KEY for AI features)'
            });
        }

        // Test AI connection with a simple prompt
        const response = await axios.post(
            'https://api.deepseek.com/v1/chat/completions',
            {
                model: "deepseek-chat",
                messages: [{ role: "user", content: "Say 'AI is working' if you can read this." }],
                max_tokens: 10
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            status: 'connected',
            ai: 'deepseek',
            response: response.data.choices[0].message.content,
            model: response.data.model
        });

    } catch (error) {
        res.json({
            status: 'error',
            ai: 'unavailable',
            message: error.message
        });
    }
});

module.exports = router;
