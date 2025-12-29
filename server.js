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
            timeout: 40000 // 30 second timeout
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
// Enhanced prompt construction with multilingual, industry-aware experience assessment
function constructProjectManagerPrompt(answers, questions) {
    let qaText = "";
    let hasSubstantialAnswers = false;
    
    // Enhanced answer analysis with industry detection
    let answerAnalysis = {
        wordCount: 0,
        technicalTerms: 0,
        structuredThinking: 0,
        specificDetails: 0,
        clarityScore: 0,
        confidenceScore: 0,
        professionalKeywords: new Set(),
        industryKeywords: new Set(),
        languageProfile: { english: 0, turkish: 0, mixed: 0 },
        answerPatterns: []
    };
    
    // Comprehensive professional indicators (English & Turkish)
    const professionalIndicators = {
        english: [
            // Project Management
            'agile', 'scrum', 'kanban', 'sprint', 'retrospective', 'backlog', 'standup',
            'stakeholder', 'roadmap', 'milestone', 'deliverable', 'kpi', 'roi', 'okr',
            'waterfall', 'ci/cd', 'devops', 'ux/ui', 'api', 'mvp', 'poc', 'prototype',
            'budget', 'timeline', 'resource', 'risk', 'mitigation', 'dependency', 'constraint',
            'jira', 'asana', 'trello', 'confluence', 'git', 'github', 'gitlab', 'notion',
            
            // Business Terms
            'strategy', 'tactic', 'objective', 'goal', 'metric', 'analytics', 'dashboard',
            'benchmark', 'baseline', 'stakeholder', 'shareholder', 'board', 'executive',
            
            // Technical Terms
            'framework', 'architecture', 'infrastructure', 'deployment', 'integration',
            'automation', 'orchestration', 'container', 'microservice', 'api', 'sdk',
            
            // Quality Terms
            'qa', 'testing', 'validation', 'verification', 'compliance', 'audit', 'review'
        ],
        
        turkish: [
            // Project Management (Turkish)
            'çevik', 'scrum', 'kanban', 'sprint', 'retrospektif', 'geriye dönük', 'iş listesi',
            'paydaş', 'yol haritası', 'kilometre taşı', 'teslimat', 'kpi', 'roi', 'okr',
            'şelale', 'ci/cd', 'devops', 'kullanıcı deneyimi', 'arayüz', 'api', 'mvp', 'poc',
            'bütçe', 'zaman çizelgesi', 'zamanlama', 'kaynak', 'risk', 'azaltma', 'bağımlılık',
            'jira', 'asana', 'trello', 'confluence', 'git', 'github', 'gitlab', 'notion',
            
            // Business Terms (Turkish)
            'strateji', 'taktik', 'hedef', 'amaç', 'metrik', 'analitik', 'gösterge panosu',
            'kıyaslama', 'temel', 'paydaş', 'hisse sahibi', 'yönetim kurulu', 'üst yönetim',
            
            // Technical Terms (Turkish)
            'çerçeve', 'mimari', 'altyapı', 'dağıtım', 'entegrasyon',
            'otomasyon', 'orkestrasyon', 'konteyner', 'mikroservis', 'api', 'sdk',
            
            // Quality Terms (Turkish)
            'kalite güvence', 'test', 'doğrulama', 'geçerlilik', 'uygunluk', 'denetim', 'inceleme'
        ]
    };
    
    // Industry detection keywords
    const industryIndicators = {
        software: ['code', 'programming', 'software', 'app', 'website', 'mobile', 'web', 'database', 'server', 'cloud'],
        construction: ['building', 'construction', 'contractor', 'architect', 'blueprint', 'permit', 'safety', 'site'],
        marketing: ['campaign', 'marketing', 'brand', 'social media', 'seo', 'content', 'advertising', 'audience'],
        education: ['learning', 'education', 'training', 'course', 'student', 'curriculum', 'assessment', 'teacher'],
        healthcare: ['patient', 'medical', 'health', 'hospital', 'clinic', 'treatment', 'doctor', 'nurse'],
        finance: ['financial', 'investment', 'banking', 'accounting', 'budget', 'revenue', 'profit', 'loss'],
        manufacturing: ['production', 'manufacturing', 'assembly', 'supply chain', 'inventory', 'quality control'],
        retail: ['retail', 'store', 'customer', 'sales', 'inventory', 'merchandise', 'point of sale']
    };
    
    // Build Q&A text and analyze answers
    Object.entries(answers).forEach(([index, answer]) => {
        const questionIndex = parseInt(index);
        if (questionIndex < questions.length && answer) {
            const question = questions[questionIndex];
            const answerText = answer.trim();
            
            if (answerText && 
                answerText !== '[Skipped]' && 
                answerText !== '[Not Applicable]') {
                
                hasSubstantialAnswers = true;
                
                // Analyze language profile
                detectLanguageProfile(answerText, answerAnalysis);
                
                // Analyze answer sophistication
                const words = answerText.split(/\s+/).filter(w => w.length > 0);
                answerAnalysis.wordCount += words.length;
                
                // Calculate clarity score (sentence structure, punctuation)
                answerAnalysis.clarityScore += calculateClarityScore(answerText);
                
                // Calculate confidence score (decisive language)
                answerAnalysis.confidenceScore += calculateConfidenceScore(answerText);
                
                // Check for professional terminology in both languages
                professionalIndicators.english.forEach(term => {
                    if (answerText.toLowerCase().includes(term)) {
                        answerAnalysis.technicalTerms++;
                        answerAnalysis.professionalKeywords.add(term);
                    }
                });
                
                professionalIndicators.turkish.forEach(term => {
                    if (answerText.toLowerCase().includes(term)) {
                        answerAnalysis.technicalTerms++;
                        answerAnalysis.professionalKeywords.add(term);
                    }
                });
                
                // Check for structured thinking
                answerAnalysis.structuredThinking += analyzeStructure(answerText);
                
                // Check for specific details
                answerAnalysis.specificDetails += analyzeSpecificity(answerText);
                
                // Detect industry
                detectIndustry(answerText, answerAnalysis, industryIndicators);
                
                // Detect answer patterns (questions, uncertainties, etc.)
                detectAnswerPatterns(answerText, answerAnalysis);
            }
            
            // Build Q&A text preserving original language
            qaText += `Q${parseInt(index) + 1} (${question.category}): ${question.text}\n`;
            qaText += `A${parseInt(index) + 1}: ${answer || "(No answer provided)"}\n\n`;
        }
    });
    
    // Determine primary language
    const primaryLanguage = determinePrimaryLanguage(answerAnalysis);
    
    // Enhanced experience level determination with weighted scoring
    const experienceScore = calculateExperienceScore(answerAnalysis, hasSubstantialAnswers);
    const { experienceLevel, experienceReasoning } = determineExperienceLevel(experienceScore, answerAnalysis);
    
    // Get industry context
    const primaryIndustry = Array.from(answerAnalysis.industryKeywords)[0] || 'general';
    
    // Get language-specific guidance
    const languageGuidance = getLanguageGuidance(primaryLanguage, experienceLevel);
    
    // Industry-specific adjustments
    const industryAdjustments = getIndustryAdjustments(primaryIndustry, experienceLevel);
    
    // Enhanced prompt construction
    const prompt = buildEnhancedPrompt(
        experienceLevel,
        experienceReasoning,
        primaryLanguage,
        primaryIndustry,
        languageGuidance,
        industryAdjustments,
        qaText,
        answerAnalysis
    );
    
    // Log detailed analysis
    console.log(`🤖 Enhanced Analysis:`);
    console.log(`   Level: ${experienceLevel} (Score: ${experienceScore.toFixed(1)})`);
    console.log(`   Language: ${primaryLanguage} (EN:${answerAnalysis.languageProfile.english}, TR:${answerAnalysis.languageProfile.turkish})`);
    console.log(`   Industry: ${primaryIndustry}`);
    console.log(`   Keywords: ${Array.from(answerAnalysis.professionalKeywords).slice(0, 5).join(', ')}`);
    console.log(`   Clarity: ${answerAnalysis.clarityScore}, Confidence: ${answerAnalysis.confidenceScore}`);
    
    return prompt;
}

// Helper Functions
function detectLanguageProfile(text, analysis) {
    const englishPattern = /\b(the|and|for|with|this|that|project|manage|plan)\b/i;
    const turkishPattern = /\b(ve|ile|bu|şu|proje|yönet|plan)\b/i;
    
    const englishMatches = (text.match(englishPattern) || []).length;
    const turkishMatches = (text.match(turkishPattern) || []).length;
    
    if (englishMatches > turkishMatches) {
        analysis.languageProfile.english++;
    } else if (turkishMatches > englishMatches) {
        analysis.languageProfile.turkish++;
    } else if (englishMatches > 0 && turkishMatches > 0) {
        analysis.languageProfile.mixed++;
    }
}

function calculateClarityScore(text) {
    let score = 0;
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length > 1) score += 1;
    if (text.includes(',')) score += 0.5;
    if (text.includes(':')) score += 0.5;
    if (!text.match(/[.!?]$/)) score -= 0.5; // Incomplete sentence
    
    return score;
}

function calculateConfidenceScore(text) {
    let score = 0;
    const lowerText = text.toLowerCase();
    
    // Positive indicators
    if (lowerText.includes('will ') || lowerText.includes('going to')) score += 1;
    if (lowerText.includes('definitely') || lowerText.includes('certainly')) score += 1;
    if (lowerText.includes('need to') || lowerText.includes('must')) score += 0.5;
    
    // Negative indicators (uncertainty)
    if (lowerText.includes('maybe') || lowerText.includes('perhaps')) score -= 0.5;
    if (lowerText.includes('not sure') || lowerText.includes('unsure')) score -= 1;
    if (lowerText.includes('i think') || lowerText.includes('i guess')) score -= 0.5;
    
    return score;
}

function analyzeStructure(text) {
    let score = 0;
    if (text.includes('\n-') || text.includes('\n•') || text.includes('\n*')) score += 2;
    if (text.match(/\n\d+\./) || text.match(/^\d+\./m)) score += 2;
    if (text.includes('|') || text.includes(';')) score += 1;
    if (text.includes('•') || text.includes('→')) score += 1;
    
    return score > 0 ? 1 : 0;
}

function analyzeSpecificity(text) {
    let score = 0;
    if (text.match(/\d+/)) score += 1; // Numbers
    if (text.match(/\$\d+/)) score += 1; // Money
    if (text.match(/\b\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}\b/)) score += 2; // Dates
    if (text.match(/[A-Z][a-z]+ [A-Z][a-z]+/)) score += 1; // Proper names
    if (text.includes('@') || text.includes('http')) score += 1; // Contact info or URLs
    
    return score > 0 ? 1 : 0;
}

function detectIndustry(text, analysis, indicators) {
    const lowerText = text.toLowerCase();
    Object.entries(indicators).forEach(([industry, keywords]) => {
        keywords.forEach(keyword => {
            if (lowerText.includes(keyword)) {
                analysis.industryKeywords.add(industry);
            }
        });
    });
}

function detectAnswerPatterns(text, analysis) {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('?') && text.split('?').length > 2) {
        analysis.answerPatterns.push('questioning');
    }
    if (text.length > 0 && text.endsWith('?')) {
        analysis.answerPatterns.push('seeking_guidance');
    }
    if (lowerText.includes('example') || lowerText.includes('örnek')) {
        analysis.answerPatterns.push('requesting_examples');
    }
    if (text.split('.').length > 3 && text.length > 100) {
        analysis.answerPatterns.push('detailed_explanation');
    }
}

function determinePrimaryLanguage(analysis) {
    if (analysis.languageProfile.turkish > analysis.languageProfile.english) {
        return 'turkish';
    } else if (analysis.languageProfile.english > analysis.languageProfile.turkish) {
        return 'english';
    } else {
        return 'mixed';
    }
}

function calculateExperienceScore(analysis, hasSubstantialAnswers) {
    let score = 0;
    
    // Base score
    if (!hasSubstantialAnswers) return 0;
    
    // Word count (capped)
    score += Math.min(analysis.wordCount / 50, 5);
    
    // Technical terms
    score += analysis.technicalTerms * 2;
    
    // Structure
    score += analysis.structuredThinking * 3;
    
    // Specificity
    score += analysis.specificDetails * 1.5;
    
    // Clarity
    score += analysis.clarityScore * 0.5;
    
    // Confidence
    score += analysis.confidenceScore * 0.5;
    
    return score;
}

function determineExperienceLevel(score, analysis) {
    let level = "beginner";
    let reasoning = "";
    
    if (score >= 15) {
        level = "expert";
        reasoning = "Demonstrates professional expertise with technical depth and structured thinking";
    } else if (score >= 10) {
        level = "professional";
        reasoning = "Shows strong professional knowledge and systematic approach";
    } else if (score >= 7) {
        level = "experienced";
        reasoning = "Has practical experience with clear understanding of processes";
    } else if (score >= 4) {
        level = "intermediate";
        reasoning = "Shows some understanding but needs guidance on implementation";
    } else if (score >= 2) {
        level = "beginner_engaged";
        reasoning = "Engaged but needs foundational guidance and encouragement";
    } else {
        level = "beginner_new";
        reasoning = "New to project concepts, needs step-by-step guidance";
    }
    
    // Adjust based on answer patterns
    if (analysis.answerPatterns.includes('seeking_guidance') && level !== 'beginner_new') {
        level = level.replace('expert', 'experienced').replace('professional', 'intermediate');
        reasoning += " (shows willingness to learn)";
    }
    
    return { experienceLevel: level, experienceReasoning: reasoning };
}

function getLanguageGuidance(language, experienceLevel) {
    const guidance = {
        turkish: {
            beginner_new: `DİL: Türkçe. Kullanıcı yeni başlıyor.
YAKLAŞIM:
• Basit, anlaşılır Türkçe kullan
• Cesaret verici ifadeler ekle ("Harika başlangıç!", "Adım adım ilerleyelim")
• Yerel araç/template önerileri ver
• Kültürel bağlamı düşün (Türkiye'de iş yapma şekilleri)`,
            
            beginner_engaged: `DİL: Türkçe. Kullanıcı öğrenmeye açık.
YAKLAŞIM:
• Net, uygulanabilir adımlar
• Türkçe kaynak önerileri
• Yerel örneklerle açıklama
• Motivasyonu yüksek tut`,
            
            expert: `DİL: Türkçe. Kullanıcı uzman seviyede.
YAKLAŞIM:
• Profesyonel Türkçe terimler kullan
• Yerel regülasyonları dikkate al
• Türkiye pazarına özgü stratejiler
• Yerel ekosistem entegrasyonu`
        },
        
        english: {
            beginner_new: `LANGUAGE: English. User is just starting.
APPROACH:
• Use simple, clear English
• Add encouraging phrases ("Great start!", "Let's build momentum")
• Suggest global best practices
• Focus on universal project principles`,
            
            beginner_engaged: `LANGUAGE: English. User is eager to learn.
APPROACH:
• Clear, actionable steps
• International resource suggestions
• Global examples and case studies
• Maintain motivational tone`,
            
            expert: `LANGUAGE: English. User is expert level.
APPROACH:
• Use professional terminology
• Reference international standards
• Suggest global tool integrations
• Consider cross-cultural team dynamics`
        }
    };
    
    return guidance[language]?.[experienceLevel] || guidance.english.beginner_new;
}

function getIndustryAdjustments(industry, experienceLevel) {
    const adjustments = {
        software: {
            beginner: "Focus on version control basics, simple testing, and incremental development",
            expert: "Include CI/CD pipelines, code review processes, and architectural decisions"
        },
        construction: {
            beginner: "Emphasize safety protocols, permit requirements, and basic scheduling",
            expert: "Include risk management for delays, supply chain logistics, and stakeholder coordination"
        },
        marketing: {
            beginner: "Focus on audience research, content planning, and basic analytics",
            expert: "Include campaign optimization, ROI tracking, and multi-channel strategy"
        },
        general: {
            beginner: "Universal project management basics applicable to any industry",
            expert: "Advanced PM techniques adaptable to various business contexts"
        }
    };
    
    return adjustments[industry]?.[experienceLevel.split('_')[0]] || adjustments.general.beginner;
}

function buildEnhancedPrompt(experienceLevel, experienceReasoning, primaryLanguage, primaryIndustry, languageGuidance, industryAdjustments, qaText, analysis) {
    // Task count based on experience
    const taskCount = experienceLevel.includes('beginner') ? 6 : 
                     experienceLevel === 'intermediate' ? 8 :
                     experienceLevel === 'experienced' ? 10 : 12;
    
    // Tone based on experience
    const tone = experienceLevel.includes('beginner') ? 
                "warm, encouraging, and patient" : 
                "professional, respectful, and collaborative";
    
    return `ROLE: You are an adaptive, multilingual project management consultant with global experience.
CONTEXT: Based on sophisticated analysis, user is at "${experienceLevel}" level.
REASONING: ${experienceReasoning}
INDUSTRY CONTEXT: ${primaryIndustry}
LANGUAGE: ${primaryLanguage.toUpperCase()}

${languageGuidance}

INDUSTRY-SPECIFIC GUIDANCE:
• ${industryAdjustments}
• Consider ${primaryIndustry}-specific challenges and opportunities
• Suggest industry-appropriate tools and methodologies

EXPERTISE-ADJUSTED INSTRUCTIONS:
1. Generate exactly ${taskCount} actionable Kanban tasks
2. Match task complexity to: ${experienceLevel.replace('_', ' ')}
3. Use ${tone} tone in task descriptions
4. For beginners: Include "quick win" tasks to build confidence
5. For experts: Include strategic and optimization tasks
6. Reference their specific answers where meaningful

TASK STRUCTURE REQUIREMENTS:
• Status: Always 'todo' (they're just starting)
• Priority: Mix of high (1-2), medium (3-4), low (rest)
• Tags: Include experience-level appropriate tags
• Descriptions: ${experienceLevel.includes('beginner') ? 'Include brief "why this matters"' : 'Assume professional context'}

SPECIAL CONSIDERATIONS:
${analysis.answerPatterns.includes('seeking_guidance') ? '• User asked questions - address these directly in relevant tasks' : ''}
${analysis.answerPatterns.includes('requesting_examples') ? '• User wants examples - provide concrete scenarios in task descriptions' : ''}
${primaryLanguage === 'mixed' ? '• User mixes languages - respond in clear, simple English with Turkish terms where helpful' : ''}

CRITICAL FORMAT REQUIREMENTS:
• Return ONLY a valid JSON array
• No additional text, explanations, or markdown
• Each task: {"id": "descriptive_id", "title": "Task", "description": "...", "status": "todo", "priority": "high/medium/low", "tags": ["tag1", "tag2"]}
• IDs must be lowercase_with_underscores

USER'S Q&A (preserve original language):
${qaText}

YOUR RESPONSE (JSON array only):`;
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
