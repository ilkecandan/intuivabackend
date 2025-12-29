const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Check API key on startup
if (!DEEPSEEK_API_KEY) {
    console.error('❌ DEEPSEEK_API_KEY is not set in environment variables!');
    console.log('Please set it in your .env file: DEEPSEEK_API_KEY=your_api_key_here');
}

// Enhanced task generation endpoint with better error handling
app.post('/api/generate-tasks', async (req, res) => {
    try {
        console.log('🔧 Task generation request received');
        console.log('Language:', req.body.language || 'en');
        console.log('Answers count:', Object.keys(req.body.answers || {}).length);
        
        const userAnswers = req.body.answers || {};
        const questions = req.body.questions || [];
        const language = req.body.language || 'en';
        const generateReport = req.body.generateReport || false;

        // Validate API key
        if (!DEEPSEEK_API_KEY) {
            console.error('❌ API key not configured');
            const language = req.body.language || 'en';
            return res.json({ 
                success: false, 
                tasks: generateDefaultTasks(language, true),
                report: generateDefaultReport([], {}, language),
                note: "API service not configured - using smart default tasks",
                error: "DEEPSEEK_API_KEY not set in environment"
            });
        }

        // 1. Analyze user answers and construct smart prompt
        const analysis = analyzeUserAnswers(userAnswers, questions, language);
        const taskPrompt = constructSmartTaskPrompt(analysis, userAnswers, questions, language);
        
        console.log('🤖 Calling DeepSeek API for task generation...');
        
        // 2. Call DeepSeek API with improved timeout and error handling
        const taskResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: getTaskGenerationSystemPrompt(language, analysis.experienceLevel) 
                },
                { role: "user", content: taskPrompt }
            ],
            temperature: 0.7,
            max_tokens: 3500,
            stream: false
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 60000, // Increased timeout for Turkish responses
            validateStatus: (status) => status < 500 // Don't throw for 4xx errors
        });

        // 3. Parse and validate tasks
        const generatedTasksText = taskResponse.data.choices[0].message.content;
        console.log('✅ AI Response received, length:', generatedTasksText.length);
        
        const tasks = parseAITasks(generatedTasksText);
        const validatedTasks = validateAndCompleteTasks(tasks, userAnswers, language, analysis);
        
        // Ensure minimum 10 tasks
        const finalTasks = ensureMinimumTasks(validatedTasks, userAnswers, language, analysis);
        
        // 4. Generate report if requested (with better fallback)
        let report = null;
        if (generateReport) {
            try {
                report = await generateAIReport(userAnswers, questions, finalTasks, language);
            } catch (reportError) {
                console.error('Report generation failed:', reportError.message);
                report = generateSmartReport(finalTasks, userAnswers, language, analysis);
            }
        }

        // 5. Send response
        res.json({ 
            success: true, 
            tasks: finalTasks,
            report: report,
            note: analysis.experienceLevel === 'beginner_new' 
                ? "Created beginner-friendly tasks based on your answers" 
                : `Created ${analysis.experienceLevel}-level tasks based on your expertise`,
            analysis: {
                experienceLevel: analysis.experienceLevel,
                industry: analysis.primaryIndustry,
                languageProfile: analysis.languageProfile
            }
        });

    } catch (error) {
        console.error('🔥 DeepSeek API Error:', error.code || error.message);
        
        // More informative error logging
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        
        const language = req.body.language || 'en';
        const userAnswers = req.body.answers || {};
        const questions = req.body.questions || [];
        
        // Generate smart fallback tasks based on analysis
        const analysis = analyzeUserAnswers(userAnswers, questions, language);
        const fallbackTasks = generateSmartFallbackTasks(userAnswers, language, analysis);
        
        res.json({ 
            success: true, 
            tasks: fallbackTasks,
            report: generateSmartReport(fallbackTasks, userAnswers, language, analysis),
            note: "AI service temporarily unavailable - using smart fallback tasks based on your answers",
            fallback: true
        });
    }
});

// Separate endpoint for generating reports only
app.post('/api/generate-report', async (req, res) => {
    try {
        console.log('📊 Report generation request received');
        
        const { answers, questions, tasks, language } = req.body;
        const analysis = analyzeUserAnswers(answers || {}, questions || [], language || 'en');
        
        const report = await generateAIReport(answers || {}, questions || [], tasks || [], language || 'en');
        
        res.json({ 
            success: true, 
            report: report,
            note: `AI generated ${language === 'tr' ? 'Türkçe' : 'English'} project report`,
            analysis: {
                experienceLevel: analysis.experienceLevel
            }
        });

    } catch (error) {
        console.error('Report generation failed:', error.message);
        const language = req.body.language || 'en';
        const analysis = analyzeUserAnswers(req.body.answers || {}, req.body.questions || [], language);
        
        res.json({ 
            success: true, 
            report: generateSmartReport(req.body.tasks || [], req.body.answers || {}, language, analysis),
            note: "Using smart locally generated report",
            fallback: true
        });
    }
});

// ===== IMPROVED HELPER FUNCTIONS =====

// Comprehensive answer analysis
function analyzeUserAnswers(answers, questions, targetLanguage) {
    let qaText = "";
    let hasSubstantialAnswers = false;
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
        answerPatterns: [],
        keyThemes: [],
        projectScopeIndicators: []
    };
    
    // Turkish-specific professional indicators
    const turkishProfessionalTerms = [
        'proje', 'yönetimi', 'planlama', 'takvim', 'bütçe', 'kaynak', 'risk', 
        'paydaş', 'hedef', 'amaç', 'strateji', 'taktik', 'metodoloji',
        'çevik', 'scrum', 'kanban', 'sprint', 'teslimat', 'kalite', 'denetim',
        'rapor', 'analiz', 'değerlendirme', 'optimizasyon', 'iyileştirme',
        'süreç', 'iş akışı', 'verimlilik', 'performans', 'ölçüm'
    ];
    
    // Build Q&A text and analyze answers
    Object.entries(answers).forEach(([index, answer]) => {
        const questionIndex = parseInt(index);
        if (questionIndex < questions.length && answer) {
            const question = questions[questionIndex];
            const answerText = answer.trim();
            
            // Build Q&A text preserving original language
            qaText += `Soru ${parseInt(index) + 1} (${question.category || 'Genel'}): ${question.text}\n`;
            qaText += `Cevap ${parseInt(index) + 1}: ${answer || "(Cevap verilmedi)"}\n\n`;
            
            if (answerText && answerText !== '[Skipped]' && answerText !== '[Not Applicable]') {
                hasSubstantialAnswers = true;
                
                // Language detection for Turkish
                const turkishChars = (answerText.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
                const englishChars = (answerText.match(/[a-zA-Z]/g) || []).length;
                
                if (turkishChars > englishChars / 2) {
                    answerAnalysis.languageProfile.turkish++;
                    
                    // Check for Turkish professional terms
                    turkishProfessionalTerms.forEach(term => {
                        if (answerText.toLowerCase().includes(term)) {
                            answerAnalysis.technicalTerms++;
                            answerAnalysis.professionalKeywords.add(term);
                        }
                    });
                } else {
                    answerAnalysis.languageProfile.english++;
                }
                
                // Word count and detail analysis
                const words = answerText.split(/\s+/).filter(w => w.length > 0);
                answerAnalysis.wordCount += words.length;
                
                // Extract key themes for Turkish responses
                if (targetLanguage === 'tr' || answerAnalysis.languageProfile.turkish > 0) {
                    extractTurkishThemes(answerText, answerAnalysis);
                }
                
                // Check for project scope indicators
                if (answerText.toLowerCase().includes('proje') || 
                    answerText.toLowerCase().includes('project') ||
                    answerText.toLowerCase().includes('plan') ||
                    answerText.toLowerCase().includes('planlama')) {
                    answerAnalysis.projectScopeIndicators.push(answerText.substring(0, 100));
                }
            }
        }
    });
    
    // Determine experience level (simplified for better reliability)
    let experienceLevel = "beginner_new";
    let experienceReasoning = "Yeni başlayan - temel rehberlik gerekiyor";
    
    if (answerAnalysis.wordCount > 500) {
        experienceLevel = "experienced";
        experienceReasoning = "Detaylı cevaplar - deneyimli kullanıcı";
    } else if (answerAnalysis.wordCount > 200) {
        experienceLevel = "intermediate";
        experienceReasoning = "Orta düzey anlayış - pratik rehberlik";
    } else if (answerAnalysis.technicalTerms > 5) {
        experienceLevel = "professional";
        experienceReasoning = "Profesyonel terminoloji - uzman seviyesi";
    }
    
    // Determine primary industry from answers
    const primaryIndustry = Array.from(answerAnalysis.industryKeywords)[0] || 'general';
    
    return {
        qaText,
        hasSubstantialAnswers,
        answerAnalysis,
        experienceLevel,
        experienceReasoning,
        primaryIndustry,
        targetLanguage
    };
}

// Extract themes from Turkish text
function extractTurkishThemes(text, analysis) {
    const themes = {
        'planlama': ['plan', 'program', 'takvim', 'zamanlama', 'schedule'],
        'bütçe': ['bütçe', 'maliyet', 'para', 'ödeme', 'budget'],
        'ekip': ['ekip', 'takım', 'kişi', 'çalışan', 'personel', 'team'],
        'teknoloji': ['yazılım', 'teknoloji', 'dijital', 'uygulama', 'app', 'software'],
        'pazar': ['müşteri', 'pazar', 'satış', 'ürün', 'hizmet', 'customer'],
        'eğitim': ['eğitim', 'öğrenme', 'kurs', 'seminer', 'training']
    };
    
    const lowerText = text.toLowerCase();
    Object.entries(themes).forEach(([theme, keywords]) => {
        keywords.forEach(keyword => {
            if (lowerText.includes(keyword)) {
                analysis.keyThemes.push(theme);
            }
        });
    });
}

// Get system prompt based on language and experience level
function getTaskGenerationSystemPrompt(language, experienceLevel) {
    if (language === 'tr') {
        if (experienceLevel.includes('beginner')) {
            return `Sen 15+ yıllık deneyime sahip, Türkçe konuşan bir proje yönetimi danışmanısın.
            Kullanıcı yeni başlıyor - ona yardımcı ve destekleyici ol.
            Görevleri basit, anlaşılır Türkçe ile açıkla.
            Her görevde "Neden önemli?" kısmı ekle.
            Cesaret verici ve motive edici bir dil kullan.
            Yalnızca geçerli JSON dizisi döndür.`;
        } else if (experienceLevel === 'professional' || experienceLevel === 'expert') {
            return `Sen 15+ yıllık deneyime sahip, Türkçe konuşan bir proje yönetimi uzmanısın.
            Kullanıcı profesyonel seviyede - teknik terimler ve ileri seviye metodolojiler kullan.
            Görevleri detaylı ve stratejik şekilde planla.
            Endüstri standartlarına ve en iyi uygulamalara referans ver.
            Yalnızca geçerli JSON dizisi döndür.`;
        } else {
            return `Sen 15+ yıllık deneyime sahip, Türkçe konuşan bir proje yönetimi danışmanısın.
            Görevleri net, uygulanabilir ve gerçekçi şekilde oluştur.
            Türkiye iş kültürüne uygun önerilerde bulun.
            Yalnızca geçerli JSON dizisi döndür.`;
        }
    } else {
        // English prompts...
        if (experienceLevel.includes('beginner')) {
            return `You are a senior project management consultant with 15+ years experience.
            The user is new - be helpful and supportive.
            Explain tasks in simple, clear English.
            Add "Why this matters" section for each task.
            Use encouraging and motivational language.
            Return ONLY valid JSON array.`;
        } else {
            return `You are a senior project management consultant with 15+ years global experience.
            Create professional, actionable Kanban tasks.
            Include strategic considerations and best practices.
            Reference industry standards where applicable.
            Return ONLY valid JSON array.`;
        }
    }
}

// Construct smart task prompt
function constructSmartTaskPrompt(analysis, answers, questions, targetLanguage) {
    const taskCount = 10; // Always generate at least 10 tasks
    
    if (targetLanguage === 'tr') {
        return `ROLE: Türkçe konuşan bir proje yönetimi danışmanısınız.
KULLANICI SEVİYESİ: ${analysis.experienceLevel} - ${analysis.experienceReasoning}
DİL: TÜRKÇE

TALİMATLAR:
1. Tam olarak ${taskCount} uygulanabilir Kanban görevi oluşturun
2. Kullanıcının cevaplarını dikkate alın:
${analysis.qaText.split('\n').slice(0, 20).join('\n')}
3. ${analysis.experienceLevel.includes('beginner') ? 'Basit, adım adım ilerleyen görevler' : 'Stratejik ve detaylı görevler'} oluşturun
4. Görev başlıkları ve açıklamaları TÜRKÇE olmalı
5. Her görev için: başlık, açıklama, öncelik (yüksek/orta/düşük), etiketler
6. Kullanıcının bahsettiği temaları kullanın: ${analysis.answerAnalysis.keyThemes.slice(0, 3).join(', ')}

GÖREV YAPISI:
• Durum: Her zaman 'todo'
• Öncelik: Karışık (2 yüksek, 4 orta, 4 düşük)
• Etiketler: Konuya uygun Türkçe etiketler
• Açıklamalar: ${analysis.experienceLevel.includes('beginner') ? 'Kısa ve motive edici' : 'Detaylı ve profesyonel'}

FORMAT: YALNIZCA JSON dizisi:
[
  {
    "id": "benzersiz_id",
    "title": "Görev Başlığı",
    "description": "Görev açıklaması...",
    "status": "todo",
    "priority": "high/medium/low",
    "tags": ["etiket1", "etiket2"]
  }
]`;
    } else {
        return `ROLE: English-speaking project management consultant
USER LEVEL: ${analysis.experienceLevel} - ${analysis.experienceReasoning}
LANGUAGE: ENGLISH

INSTRUCTIONS:
1. Generate exactly ${taskCount} actionable Kanban tasks
2. Consider user's specific answers:
${analysis.qaText.split('\n').slice(0, 20).join('\n')}
3. Create ${analysis.experienceLevel.includes('beginner') ? 'simple, step-by-step tasks' : 'strategic and detailed tasks'}
4. Task titles and descriptions in ENGLISH
5. Each task: title, description, priority (high/medium/low), tags
6. Incorporate themes mentioned: ${analysis.answerAnalysis.keyThemes.slice(0, 3).join(', ')}

TASK STRUCTURE:
• Status: Always 'todo'
• Priority: Mixed (2 high, 4 medium, 4 low)
• Tags: Context-appropriate English tags
• Descriptions: ${analysis.experienceLevel.includes('beginner') ? 'Brief and encouraging' : 'Detailed and professional'}

FORMAT: ONLY JSON array:
[
  {
    "id": "unique_id",
    "title": "Task Title",
    "description": "Task description...",
    "status": "todo",
    "priority": "high/medium/low",
    "tags": ["tag1", "tag2"]
  }
]`;
    }
}

// Ensure minimum 10 tasks
function ensureMinimumTasks(tasks, answers, language, analysis) {
    if (tasks.length >= 10) return tasks;
    
    const additionalNeeded = 10 - tasks.length;
    const additionalTasks = generateAdditionalTasks(additionalNeeded, answers, language, analysis);
    
    return [...tasks, ...additionalTasks];
}

// Generate additional tasks when needed
function generateAdditionalTasks(count, answers, language, analysis) {
    const additionalTasks = [];
    const isTurkish = language === 'tr';
    
    const taskTemplates = isTurkish ? [
        {
            title: 'Proje hedeflerini önceliklendir',
            description: 'Hedeflerinizi aciliyet ve öneme göre sıralayın',
            priority: 'high',
            tags: ['planlama', 'öncelik']
        },
        {
            title: 'Risk analizi yap',
            description: 'Olası riskleri belirleyip önlem planı oluşturun',
            priority: 'medium',
            tags: ['risk', 'analiz']
        },
        {
            title: 'İletişim planı hazırla',
            description: 'Paydaşlarla nasıl iletişim kuracağınızı planlayın',
            priority: 'medium',
            tags: ['iletişim', 'paydaş']
        }
    ] : [
        {
            title: 'Prioritize project goals',
            description: 'Rank your goals by urgency and importance',
            priority: 'high',
            tags: ['planning', 'priority']
        },
        {
            title: 'Conduct risk analysis',
            description: 'Identify potential risks and create mitigation plans',
            priority: 'medium',
            tags: ['risk', 'analysis']
        },
        {
            title: 'Create communication plan',
            description: 'Plan how you will communicate with stakeholders',
            priority: 'medium',
            tags: ['communication', 'stakeholders']
        }
    ];
    
    for (let i = 0; i < count && i < taskTemplates.length; i++) {
        additionalTasks.push({
            id: `additional_${Date.now()}_${i}`,
            ...taskTemplates[i],
            status: 'todo'
        });
    }
    
    return additionalTasks;
}

// Generate smart fallback tasks when API fails
function generateSmartFallbackTasks(answers, language, analysis) {
    const isTurkish = language === 'tr';
    const tasks = [];
    const baseCount = 10;
    
    // Extract key words from answers for personalization
    const answerText = Object.values(answers).join(' ').toLowerCase();
    
    for (let i = 0; i < baseCount; i++) {
        const taskNum = i + 1;
        let task;
        
        if (isTurkish) {
            task = {
                id: `fallback_${Date.now()}_${taskNum}`,
                title: getTurkishTaskTitle(i, answerText, analysis.experienceLevel),
                description: getTurkishTaskDescription(i, answerText, analysis.experienceLevel),
                status: 'todo',
                priority: i < 2 ? 'high' : i < 6 ? 'medium' : 'low',
                tags: getTurkishTags(i, analysis)
            };
        } else {
            task = {
                id: `fallback_${Date.now()}_${taskNum}`,
                title: getEnglishTaskTitle(i, answerText, analysis.experienceLevel),
                description: getEnglishTaskDescription(i, answerText, analysis.experienceLevel),
                status: 'todo',
                priority: i < 2 ? 'high' : i < 6 ? 'medium' : 'low',
                tags: getEnglishTags(i, analysis)
            };
        }
        
        tasks.push(task);
    }
    
    return tasks;
}

// Helper functions for Turkish task generation
function getTurkishTaskTitle(index, answerText, experienceLevel) {
    const beginnerTitles = [
        'Proje fikrini netleştir',
        'Temel hedefleri belirle',
        'İlk adımları planla',
        'Kaynakları listeleyin',
        'Zaman çizelgesi oluştur',
        'İlerlemeyi takip et',
        'Geri bildirim al',
        'Düzeltmeler yap',
        'Sonuçları değerlendir',
        'Başarıyı kutla'
    ];
    
    const expertTitles = [
        'Stratejik yol haritası oluştur',
        'Paydaş analizi yap',
        'Risk yönetim planı geliştir',
        'KPI metriklerini tanımla',
        'Süreç iyileştirmeleri planla',
        'Kaynak optimizasyonu yap',
        'Kalite güvence süreçleri kur',
        'İletişim protokolleri belirle',
        'Performans değerlendirme sistemi oluştur',
        'Sürdürülebilirlik planı hazırla'
    ];
    
    const titles = experienceLevel.includes('beginner') ? beginnerTitles : expertTitles;
    return titles[index % titles.length];
}

function getTurkishTaskDescription(index, answerText, experienceLevel) {
    if (experienceLevel.includes('beginner')) {
        return `Bu adım projenizin ${index + 1}. temel bileşenidir. Küçük başlayın ve ilerledikçe öğrenin.`;
    } else {
        return `Profesyonel proje yönetimi metodolojilerine uygun olarak bu görevi tamamlayın.`;
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: DEEPSEEK_API_KEY ? 'healthy' : 'warning',
        service: 'Intuiva AI Backend',
        version: '2.1.0',
        features: ['smart-task-generation', 'bilingual-support', 'experience-adaptation'],
        languageSupport: ['English', 'Turkish'],
        apiKeyConfigured: !!DEEPSEEK_API_KEY,
        timestamp: new Date().toISOString()
    });
});

// Test endpoint with better diagnostics
app.post('/test-api', async (req, res) => {
    try {
        const testResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [{ role: "user", content: "Merhaba, test mesajı. Hello, test message." }],
            max_tokens: 10
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        
        res.json({
            success: true,
            message: 'API connection successful',
            response: testResponse.data
        });
    } catch (error) {
        res.json({
            success: false,
            message: 'API connection failed',
            error: error.message,
            code: error.code,
            apiKeyPresent: !!DEEPSEEK_API_KEY
        });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Intuiva Backend v2.1 running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 API test: POST http://localhost:${PORT}/test-api`);
    console.log(`🤖 DeepSeek API Key: ${DEEPSEEK_API_KEY ? 'Set ✅' : 'Missing ❌'}`);
    console.log(`🌍 Language support: English & Turkish (smart adaptation)`);
    console.log(`🎯 Features: 10+ tasks always, experience-based customization`);
});
