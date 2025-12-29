const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Enhanced task generation endpoint
app.post('/api/generate-tasks', async (req, res) => {
    try {
        console.log('🚀 Task generation request received');
        console.log('📋 Language:', req.body.language || 'en');
        console.log('📊 Answers count:', Object.keys(req.body.answers || {}).length);
        
        const userAnswers = req.body.answers || {};
        const questions = req.body.questions || [];
        const language = req.body.language || 'en';
        const generateReport = req.body.generateReport || false;

        // 1. Analyze user input and create enhanced prompt
        const analysis = analyzeUserInput(userAnswers, questions, language);
        const taskPrompt = constructProjectManagerPrompt(analysis, userAnswers, questions, language);
        
        console.log(`🤖 Calling DeepSeek API (${language})...`);
        
        // 2. Call DeepSeek API with better configuration for Turkish
        const systemPrompt = getSystemPrompt(language, analysis.experienceLevel);
        
        const taskResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: systemPrompt
                },
                { role: "user", content: taskPrompt }
            ],
            temperature: 0.7,
            max_tokens: 4000,
            stream: false
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 60000, // Increased timeout for better handling
            validateStatus: (status) => status < 500
        });

        // 3. Parse tasks
        const generatedTasksText = taskResponse.data.choices[0].message.content;
        console.log('✅ AI Response received, length:', generatedTasksText.length);
        
        const tasks = parseAITasks(generatedTasksText);
        const validatedTasks = validateAndCompleteTasks(tasks, userAnswers, language, analysis);
        
        // 4. Ensure minimum 10 tasks with smart enhancement
        const finalTasks = ensureMinimumTasks(validatedTasks, userAnswers, language, analysis);
        
        // 5. Generate report if requested
        let report = null;
        if (generateReport) {
            try {
                report = await generateAIReport(userAnswers, questions, finalTasks, language);
            } catch (reportError) {
                console.error('Report generation failed:', reportError.message);
                report = generateSmartReport(finalTasks, userAnswers, language, analysis);
            }
        }

        // 6. Send response
        res.json({ 
            success: true, 
            tasks: finalTasks,
            report: report,
            note: getGenerationNote(language, analysis.experienceLevel, finalTasks.length),
            analysis: {
                experienceLevel: analysis.experienceLevel,
                industry: analysis.primaryIndustry,
                languageProfile: analysis.languageProfile,
                taskCount: finalTasks.length
            }
        });

    } catch (error) {
        console.error('🔥 DeepSeek API Error:', error.code || error.message);
        
        if (error.response) {
            console.error('Response status:', error.response.status);
            if (error.response.status === 401) {
                console.error('❌ API Key issue - Check DEEPSEEK_API_KEY environment variable');
            }
        }
        
        const language = req.body.language || 'en';
        const userAnswers = req.body.answers || {};
        const questions = req.body.questions || [];
        
        // Generate smart fallback tasks
        const analysis = analyzeUserInput(userAnswers, questions, language);
        const fallbackTasks = generateSmartFallbackTasks(userAnswers, language, analysis);
        
        res.json({ 
            success: true, 
            tasks: fallbackTasks,
            report: generateSmartReport(fallbackTasks, userAnswers, language, analysis),
            note: language === 'tr' 
                ? "AI servisi geçici olarak kullanılamıyor - cevaplarınıza dayalı akıllı görevler oluşturuldu" 
                : "AI service temporarily unavailable - created smart tasks based on your answers",
            fallback: true,
            analysis: {
                experienceLevel: analysis.experienceLevel,
                taskCount: fallbackTasks.length
            }
        });
    }
});

// Separate endpoint for generating reports only
app.post('/api/generate-report', async (req, res) => {
    try {
        console.log('📊 Report generation request received');
        
        const { answers, questions, tasks, language } = req.body;
        const analysis = analyzeUserInput(answers || {}, questions || [], language || 'en');
        
        const report = await generateAIReport(answers || {}, questions || [], tasks || [], language || 'en');
        
        res.json({ 
            success: true, 
            report: report,
            note: language === 'tr' 
                ? `AI tarafından oluşturulmuş ${analysis.experienceLevel} seviyesi proje raporu` 
                : `AI generated ${analysis.experienceLevel}-level project report`,
            analysis: {
                experienceLevel: analysis.experienceLevel
            }
        });

    } catch (error) {
        console.error('Report generation failed:', error.message);
        const language = req.body.language || 'en';
        const analysis = analyzeUserInput(req.body.answers || {}, req.body.questions || [], language);
        
        res.json({ 
            success: true, 
            report: generateSmartReport(req.body.tasks || [], req.body.answers || {}, language, analysis),
            note: "Using smart locally generated report",
            fallback: true
        });
    }
});

// ===== ENHANCED HELPER FUNCTIONS =====

// Comprehensive user input analysis
function analyzeUserInput(answers, questions, targetLanguage) {
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
        projectScopeIndicators: [],
        mentionedTools: [],
        mentionedTimeframes: [],
        mentionedResources: []
    };
    
    // Enhanced Turkish professional indicators
    const turkishProfessionalIndicators = [
        // Project Management
        'proje', 'yönetim', 'planlama', 'plan', 'takvim', 'program', 'zamanlama',
        'bütçe', 'maliyet', 'kaynak', 'kaynaklar', 'risk', 'riskler', 'tehlike',
        'paydaş', 'paydaşlar', 'müşteri', 'kullanıcı', 'hedef', 'hedefler', 'amaç',
        'strateji', 'stratejik', 'taktik', 'metodoloji', 'yöntem', 'süreç', 'iş akışı',
        'çevik', 'agile', 'scrum', 'kanban', 'sprint', 'iterasyon', 'geriye dönük',
        'teslimat', 'deliverable', 'kilometre taşı', 'milestone', 'kpi', 'ölçüm',
        'kalite', 'kalite güvence', 'test', 'doğrulama', 'validasyon', 'denetim',
        
        // Technical Terms
        'yazılım', 'software', 'uygulama', 'app', 'web', 'mobil', 'database',
        'sunucu', 'server', 'bulut', 'cloud', 'api', 'arayüz', 'interface',
        'geliştirme', 'development', 'kod', 'code', 'programlama', 'programming',
        
        // Business Terms
        'iş', 'business', 'şirket', 'company', 'girişim', 'startup', 'pazar', 'market',
        'satış', 'sales', 'pazarlama', 'marketing', 'müşteri', 'customer', 'ürün', 'product'
    ];
    
    // English professional indicators
    const englishProfessionalIndicators = [
        'project', 'management', 'planning', 'schedule', 'timeline', 'budget',
        'resource', 'risk', 'stakeholder', 'goal', 'objective', 'strategy',
        'methodology', 'process', 'workflow', 'agile', 'scrum', 'kanban',
        'delivery', 'milestone', 'kpi', 'metric', 'quality', 'testing',
        'software', 'application', 'web', 'mobile', 'development', 'coding',
        'business', 'company', 'market', 'sales', 'marketing', 'customer'
    ];
    
    // Build Q&A text and analyze answers
    Object.entries(answers).forEach(([index, answer]) => {
        const questionIndex = parseInt(index);
        if (questionIndex < questions.length && answer) {
            const question = questions[questionIndex];
            const answerText = answer.trim();
            
            // Build Q&A text
            if (targetLanguage === 'tr') {
                qaText += `Soru ${parseInt(index) + 1} (${question.category || 'Genel'}): ${question.text}\n`;
                qaText += `Cevap ${parseInt(index) + 1}: ${answer || "(Cevap verilmedi)"}\n\n`;
            } else {
                qaText += `Q${parseInt(index) + 1} (${question.category}): ${question.text}\n`;
                qaText += `A${parseInt(index) + 1}: ${answer || "(No answer provided)"}\n\n`;
            }
            
            if (answerText && answerText !== '[Skipped]' && answerText !== '[Not Applicable]') {
                hasSubstantialAnswers = true;
                
                // Analyze language
                analyzeLanguage(answerText, answerAnalysis, targetLanguage);
                
                // Analyze content
                const words = answerText.split(/\s+/).filter(w => w.length > 0);
                answerAnalysis.wordCount += words.length;
                
                // Check for professional terms
                if (targetLanguage === 'tr') {
                    turkishProfessionalIndicators.forEach(term => {
                        if (answerText.toLowerCase().includes(term.toLowerCase())) {
                            answerAnalysis.technicalTerms++;
                            answerAnalysis.professionalKeywords.add(term);
                        }
                    });
                } else {
                    englishProfessionalIndicators.forEach(term => {
                        if (answerText.toLowerCase().includes(term.toLowerCase())) {
                            answerAnalysis.technicalTerms++;
                            answerAnalysis.professionalKeywords.add(term);
                        }
                    });
                }
                
                // Extract key themes
                extractKeyThemes(answerText, answerAnalysis, targetLanguage);
                
                // Check for structured thinking
                if (answerText.includes('\n') || answerText.includes('•') || answerText.includes('- ')) {
                    answerAnalysis.structuredThinking++;
                }
                
                // Check for specific details
                if (answerText.match(/\d+/) || answerText.includes('$') || answerText.includes('TL')) {
                    answerAnalysis.specificDetails++;
                }
                
                // Check confidence indicators
                if (answerText.toLowerCase().includes('kesinlikle') || 
                    answerText.toLowerCase().includes('mutlaka') ||
                    answerText.toLowerCase().includes('definitely') ||
                    answerText.toLowerCase().includes('certainly')) {
                    answerAnalysis.confidenceScore++;
                }
            }
        }
    });
    
    // Determine experience level
    let experienceLevel = "beginner_new";
    let experienceReasoning = targetLanguage === 'tr' 
        ? "Yeni başlayan - temel rehberlik ve destek gerekiyor" 
        : "New beginner - needs basic guidance and support";
    
    if (answerAnalysis.wordCount > 300 && answerAnalysis.technicalTerms > 3) {
        experienceLevel = "professional";
        experienceReasoning = targetLanguage === 'tr'
            ? "Profesyonel terminoloji kullanıyor - ileri seviye proje yönetimi bilgisi var"
            : "Uses professional terminology - has advanced project management knowledge";
    } else if (answerAnalysis.wordCount > 150) {
        experienceLevel = "experienced";
        experienceReasoning = targetLanguage === 'tr'
            ? "Deneyimli kullanıcı - pratik bilgi ve uygulama becerisi var"
            : "Experienced user - has practical knowledge and application skills";
    } else if (answerAnalysis.wordCount > 50) {
        experienceLevel = "intermediate";
        experienceReasoning = targetLanguage === 'tr'
            ? "Orta seviye - temel kavramları anlıyor, uygulamada rehberlik gerekiyor"
            : "Intermediate - understands basic concepts, needs guidance in application";
    }
    
    // Determine primary industry
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

// Analyze language profile
function analyzeLanguage(text, analysis, targetLanguage) {
    const turkishChars = (text.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
    
    if (turkishChars > 0 && turkishChars > englishChars / 3) {
        analysis.languageProfile.turkish++;
    } else if (englishChars > 0) {
        analysis.languageProfile.english++;
    }
    
    // Check for mixed language
    if (turkishChars > 0 && englishChars > 0) {
        analysis.languageProfile.mixed++;
    }
}

// Extract key themes from answers
function extractKeyThemes(text, analysis, language) {
    const lowerText = text.toLowerCase();
    
    // Common project themes
    const themes = {
        planning: ['plan', 'schedule', 'timeline', 'planlama', 'takvim', 'zamanlama'],
        budget: ['budget', 'cost', 'money', 'bütçe', 'maliyet', 'para'],
        team: ['team', 'person', 'employee', 'ekip', 'kişi', 'çalışan'],
        technology: ['software', 'tech', 'digital', 'app', 'yazılım', 'teknoloji'],
        marketing: ['market', 'customer', 'sales', 'pazar', 'müşteri', 'satış'],
        quality: ['quality', 'test', 'control', 'kalite', 'test', 'kontrol']
    };
    
    Object.entries(themes).forEach(([theme, keywords]) => {
        keywords.forEach(keyword => {
            if (lowerText.includes(keyword)) {
                analysis.keyThemes.push(theme);
            }
        });
    });
}

// Get appropriate system prompt
function getSystemPrompt(language, experienceLevel) {
    if (language === 'tr') {
        if (experienceLevel.includes('beginner')) {
            return `Sen 15+ yıllık deneyime sahip, sabırlı ve destekleyici bir proje yönetimi koçusun.
Kullanıcı yeni başlıyor, bu yüzden:
1. Çok basit ve anlaşılır Türkçe kullan
2. Her görevde "Bu neden önemli?" kısmı ekle
3. Cesaret verici ve motive edici ol
4. Küçük, başarılabilir adımlar öner
5. Kullanıcının cevaplarından öğeleri görevlere dahil et
6. YALNIZCA geçerli JSON dizisi döndür, başka metin YOK

Görev formatı:
{
  "id": "benzersiz_id",
  "title": "Türkçe görev başlığı",
  "description": "Açıklayıcı ve motive edici açıklama",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["etiket1", "etiket2"]
}`;
        } else if (experienceLevel === 'professional' || experienceLevel === 'expert') {
            return `Sen 15+ yıllık deneyime sahip, sektör lideri bir proje yönetimi danışmanısın.
Kullanıcı profesyonel seviyede, bu yüzden:
1. Profesyonel Türkçe proje yönetimi terminolojisi kullan
2. Stratejik ve ileri seviye görevler oluştur
3. En iyi uygulamaları ve endüstri standartlarını referans al
4. Risk yönetimi, KPI'lar ve optimizasyon öğelerini dahil et
5. Kullanıcının cevaplarından detaylı öğeleri görevlere dahil et
6. YALNIZCA geçerli JSON dizisi döndür, başka metin YOK

Görev formatı:
{
  "id": "benzersiz_id",
  "title": "Profesyonel Türkçe görev başlığı",
  "description": "Detaylı ve stratejik açıklama",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["profesyonel_etiket1", "profesyonel_etiket2"]
}`;
        } else {
            return `Sen 15+ yıllık deneyime sahip bir proje yönetimi danışmanısın.
Kullanıcı orta/ileri seviyede, bu yüzden:
1. Net, uygulanabilir ve gerçekçi görevler oluştur
2. Türkiye iş kültürüne uygun önerilerde bulun
3. Pratik çözümler ve yöntemler öner
4. Kullanıcının cevaplarından ilgili öğeleri görevlere dahil et
5. YALNIZCA geçerli JSON dizisi döndür, başka metin YOK

Görev formatı:
{
  "id": "benzersiz_id",
  "title": "Uygulanabilir Türkçe görev başlığı",
  "description": "Pratik ve açıklayıcı açıklama",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["uygulanabilir_etiket1", "uygulanabilir_etiket2"]
}`;
        }
    } else {
        // English prompts
        if (experienceLevel.includes('beginner')) {
            return `You are a senior project management coach with 15+ years experience.
The user is just starting, so:
1. Use very simple and clear English
2. Add "Why this matters" for each task
3. Be encouraging and motivational
4. Suggest small, achievable steps
5. Incorporate elements from the user's specific answers
6. Return ONLY valid JSON array, NO other text

Task format:
{
  "id": "unique_id",
  "title": "Simple English task title",
  "description": "Descriptive and encouraging description",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["tag1", "tag2"]
}`;
        } else {
            return `You are a senior project management consultant with 15+ years global experience.
The user is at ${experienceLevel} level, so:
1. Create professional, actionable Kanban tasks
2. Include strategic considerations and best practices
3. Reference industry standards where applicable
4. Incorporate specific elements from user's answers
5. Return ONLY valid JSON array, NO other text

Task format:
{
  "id": "unique_id",
  "title": "Professional English task title",
  "description": "Detailed and strategic description",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["professional_tag1", "professional_tag2"]
}`;
        }
    }
}

// Construct project manager prompt
function constructProjectManagerPrompt(analysis, answers, questions, targetLanguage) {
    const MIN_TASKS = 10;
    const MAX_TASKS = 15;
    
    if (targetLanguage === 'tr') {
        return `PROJE YÖNETİMİ DANIŞMANI GÖREVLERİ OLUŞTUR:

KULLANICI PROFİLİ:
• Seviye: ${analysis.experienceLevel}
• Açıklama: ${analysis.experienceReasoning}
• Ana Temalar: ${analysis.answerAnalysis.keyThemes.slice(0, 5).join(', ') || 'Genel proje yönetimi'}
• Teknik Terimler: ${Array.from(analysis.answerAnalysis.professionalKeywords).slice(0, 5).join(', ') || 'Yok'}

KULLANICI CEVAPLARI:
${analysis.qaText.split('\n').slice(0, 30).join('\n')}

TALİMATLAR:
1. Tam olarak ${MIN_TASKS}-${MAX_TASKS} adet KANBAN görevi oluştur
2. Tüm görevler TÜRKÇE olmalı
3. Kullanıcının özgün cevaplarından öğeleri görevlere dahil et
4. ${analysis.experienceLevel.includes('beginner') ? 'Basit, adım adım, başarılabilir görevler' : 'Stratejik, detaylı, profesyonel görevler'} oluştur
5. Öncelik dağılımı: 3 YÜKSEK, 5 ORTA, ${MIN_TASKS-8} DÜŞÜK öncelik
6. Her görev benzersiz ve uygulanabilir olmalı

GÖREV KONULARI (kullanıcı cevaplarına göre özelleştir):
${getTaskTopicsTurkish(analysis)}

ÖRNEK GÖREV YAPISI:
• Başlık: Net ve açıklayıcı Türkçe başlık
• Açıklama: ${analysis.experienceLevel.includes('beginner') ? 'Kısa, motive edici, "neden önemli" içeren' : 'Detaylı, stratejik, profesyonel terimler içeren'}
• Öncelik: Yüksek/Orta/Düşük (yukarıdaki dağılıma göre)
• Etiketler: Konuya uygun 2-3 Türkçe etiket

FORMAT: YALNIZCA JSON DİZİSİ:
[
  {
    "id": "proje_planlama_1",
    "title": "Proje vizyonunu netleştir",
    "description": "Projenin temel amacını 2-3 cümlede açıkla. Bu, tüm ekibin aynı hedefe odaklanmasını sağlar.",
    "status": "todo",
    "priority": "high",
    "tags": ["vizyon", "planlama", "hedef"]
  },
  // ... diğer görevler
]

TÜM GÖREVLER TAMAMEN TÜRKÇE OLMALIDIR.`;
    } else {
        return `PROJECT MANAGEMENT CONSULTANT TASK GENERATION:

USER PROFILE:
• Level: ${analysis.experienceLevel}
• Description: ${analysis.experienceReasoning}
• Key Themes: ${analysis.answerAnalysis.keyThemes.slice(0, 5).join(', ') || 'General project management'}
• Technical Terms: ${Array.from(analysis.answerAnalysis.professionalKeywords).slice(0, 5).join(', ') || 'None'}

USER ANSWERS:
${analysis.qaText.split('\n').slice(0, 30).join('\n')}

INSTRUCTIONS:
1. Create exactly ${MIN_TASKS}-${MAX_TASKS} KANBAN tasks
2. All tasks must be in ENGLISH
3. Incorporate elements from the user's specific answers
4. Create ${analysis.experienceLevel.includes('beginner') ? 'simple, step-by-step, achievable tasks' : 'strategic, detailed, professional tasks'}
5. Priority distribution: 3 HIGH, 5 MEDIUM, ${MIN_TASKS-8} LOW priority
6. Each task must be unique and actionable

TASK TOPICS (customize based on user answers):
${getTaskTopicsEnglish(analysis)}

EXAMPLE TASK STRUCTURE:
• Title: Clear and descriptive English title
• Description: ${analysis.experienceLevel.includes('beginner') ? 'Brief, encouraging, includes "why this matters"' : 'Detailed, strategic, includes professional terms'}
• Priority: High/Medium/Low (according to above distribution)
• Tags: 2-3 relevant English tags

FORMAT: ONLY JSON ARRAY:
[
  {
    "id": "project_planning_1",
    "title": "Clarify project vision",
    "description": "Define the core purpose in 2-3 sentences. This ensures the entire team focuses on the same goal.",
    "status": "todo",
    "priority": "high",
    "tags": ["vision", "planning", "goal"]
  },
  // ... other tasks
]

ALL TASKS MUST BE IN ENGLISH ONLY.`;
    }
}

// Get task topics in Turkish
function getTaskTopicsTurkish(analysis) {
    const baseTopics = [
        "Proje vizyonu ve hedefler",
        "Paydaş yönetimi",
        "Risk analizi ve yönetimi",
        "Zaman planlaması ve takvim",
        "Bütçe ve kaynak planlaması",
        "İletişim planı",
        "Kalite yönetimi",
        "İlerleme takibi",
        "Değerlendirme ve iyileştirme"
    ];
    
    // Add user-specific topics
    const userTopics = analysis.answerAnalysis.keyThemes.map(theme => {
        const themeMap = {
            'planning': 'Detaylı planlama',
            'budget': 'Bütçe optimizasyonu',
            'team': 'Ekip yönetimi',
            'technology': 'Teknoloji altyapısı',
            'marketing': 'Pazarlama stratejisi',
            'quality': 'Kalite kontrol süreçleri'
        };
        return themeMap[theme] || `Özel ${theme} yönetimi`;
    });
    
    return [...new Set([...userTopics, ...baseTopics])].slice(0, 8).join('\n• ');
}

// Get task topics in English
function getTaskTopicsEnglish(analysis) {
    const baseTopics = [
        "Project vision and goals",
        "Stakeholder management",
        "Risk analysis and management",
        "Time planning and scheduling",
        "Budget and resource planning",
        "Communication plan",
        "Quality management",
        "Progress tracking",
        "Evaluation and improvement"
    ];
    
    // Add user-specific topics
    const userTopics = analysis.answerAnalysis.keyThemes.map(theme => {
        const themeMap = {
            'planning': 'Detailed planning',
            'budget': 'Budget optimization',
            'team': 'Team management',
            'technology': 'Technology infrastructure',
            'marketing': 'Marketing strategy',
            'quality': 'Quality control processes'
        };
        return themeMap[theme] || `Specific ${theme} management`;
    });
    
    return [...new Set([...userTopics, ...baseTopics])].slice(0, 8).join('\n• ');
}

// Parse AI tasks
function parseAITasks(text) {
    try {
        const cleanText = text.trim();
        
        // Find JSON array
        const jsonStart = cleanText.indexOf('[');
        const jsonEnd = cleanText.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
            console.log("No JSON array found in response");
            console.log("Response preview:", cleanText.substring(0, 200));
            return [];
        }
        
        const jsonString = cleanText.substring(jsonStart, jsonEnd);
        const tasks = JSON.parse(jsonString);
        
        if (!Array.isArray(tasks)) {
            console.log("Response is not an array");
            return [];
        }
        
        console.log(`✅ Parsed ${tasks.length} tasks from AI response`);
        return tasks;
        
    } catch (e) {
        console.error("Parsing AI tasks failed:", e.message);
        console.log("Response snippet:", text.substring(0, 300));
        return [];
    }
}

// Validate and complete task structure
function validateAndCompleteTasks(tasks, userAnswers, language, analysis) {
    const isTurkish = language === 'tr';
    
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return generateSmartFallbackTasks(userAnswers, language, analysis);
    }
    
    return tasks.map((task, index) => {
        // Ensure Turkish tasks are actually in Turkish
        let title = task.title || '';
        let description = task.description || '';
        
        if (isTurkish) {
            // Check if task is in English, translate key terms
            const englishPattern = /\b(the|and|for|with|this|that|project|task|plan|manage)\b/i;
            if (englishPattern.test(title) && !/\b(proje|görev|plan|yönet)\b/i.test(title)) {
                title = `Görev ${index + 1}: ${title}`;
            }
        }
        
        const validatedTask = {
            id: task.id || `${isTurkish ? 'görev' : 'task'}_${Date.now()}_${index}`,
            title: title || (isTurkish ? `Görev ${index + 1}` : `Task ${index + 1}`),
            description: description || (isTurkish ? 
                'Bu görev projenizin önemli bir parçasıdır. Detayları tamamlayın.' : 
                'This is an important part of your project. Complete the details.'),
            status: ['todo', 'inprogress', 'done'].includes(task.status) ? task.status : 'todo',
            priority: ['critical', 'high', 'medium', 'low'].includes(task.priority?.toLowerCase()) 
                ? task.priority.toLowerCase() 
                : (index < 3 ? 'high' : index < 8 ? 'medium' : 'low'),
            tags: Array.isArray(task.tags) && task.tags.length > 0 
                ? task.tags.slice(0, 3)
                : [isTurkish ? 'proje' : 'project', isTurkish ? 'yönetim' : 'management']
        };
        
        // Personalize based on answers
        if (Object.keys(userAnswers).length > 0 && index === 0) {
            const firstAnswer = Object.values(userAnswers).find(a => 
                a && a !== '[Skipped]' && a !== '[Not Applicable]'
            );
            if (firstAnswer && firstAnswer.length > 10) {
                validatedTask.description += ` ${isTurkish ? 
                    ` (Bu görev "${firstAnswer.substring(0, 40)}..." cevabınıza dayanmaktadır)` : 
                    ` (This task is based on your answer about "${firstAnswer.substring(0, 40)}...")`}`;
            }
        }
        
        return validatedTask;
    });
}

// Ensure minimum 10 tasks
function ensureMinimumTasks(tasks, userAnswers, language, analysis) {
    const MIN_TASKS = 10;
    
    if (tasks.length >= MIN_TASKS) {
        return tasks.slice(0, 15); // Cap at 15 tasks
    }
    
    const additionalNeeded = MIN_TASKS - tasks.length;
    const additionalTasks = generateAdditionalTasks(additionalNeeded, userAnswers, language, analysis);
    
    return [...tasks, ...additionalTasks].slice(0, 15);
}

// Generate additional tasks when needed
function generateAdditionalTasks(count, userAnswers, language, analysis) {
    const additionalTasks = [];
    const isTurkish = language === 'tr';
    
    const taskTemplates = isTurkish ? [
        {
            title: 'Proje kapsam belgesi oluştur',
            description: 'Projenin dahil edilecek ve edilmeyecek öğelerini net bir şekilde tanımlayın',
            priority: 'high',
            tags: ['kapsam', 'belge', 'tanımlama']
        },
        {
            title: 'Risk kayıt defteri başlat',
            description: 'Olası riskleri belirleyip önceliklendirin ve izleme planı oluşturun',
            priority: 'high',
            tags: ['risk', 'kayıt', 'izleme']
        },
        {
            title: 'İletişim matrisi hazırla',
            description: 'Kimin, ne zaman, nasıl iletişim kuracağını gösteren bir matris oluşturun',
            priority: 'medium',
            tags: ['iletişim', 'matris', 'planlama']
        },
        {
            title: 'Başarı kriterlerini belirle',
            description: 'Projenin ne zaman başarılı sayılacağını ölçülebilir kriterlerle tanımlayın',
            priority: 'medium',
            tags: ['başarı', 'kriter', 'ölçüm']
        },
        {
            title: 'Haftalık ilerleme toplantıları planla',
            description: 'Düzenli kontrol noktaları için takvimde haftalık toplantılar ayarlayın',
            priority: 'medium',
            tags: ['toplantı', 'ilerleme', 'takip']
        }
    ] : [
        {
            title: 'Create project scope document',
            description: 'Clearly define what is included and excluded from the project',
            priority: 'high',
            tags: ['scope', 'document', 'definition']
        },
        {
            title: 'Start risk register',
            description: 'Identify and prioritize potential risks, create monitoring plan',
            priority: 'high',
            tags: ['risk', 'register', 'monitoring']
        },
        {
            title: 'Prepare communication matrix',
            description: 'Create a matrix showing who communicates what, when, and how',
            priority: 'medium',
            tags: ['communication', 'matrix', 'planning']
        },
        {
            title: 'Define success criteria',
            description: 'Define measurable criteria for when the project will be considered successful',
            priority: 'medium',
            tags: ['success', 'criteria', 'measurement']
        },
        {
            title: 'Schedule weekly progress meetings',
            description: 'Set up weekly meetings in calendar for regular checkpoints',
            priority: 'medium',
            tags: ['meeting', 'progress', 'tracking']
        }
    ];
    
    for (let i = 0; i < count && i < taskTemplates.length; i++) {
        additionalTasks.push({
            id: `${isTurkish ? 'ek' : 'additional'}_${Date.now()}_${i}`,
            ...taskTemplates[i],
            status: 'todo'
        });
    }
    
    return additionalTasks;
}

// Generate smart fallback tasks
function generateSmartFallbackTasks(answers, language, analysis) {
    const isTurkish = language === 'tr';
    const tasks = [];
    const baseCount = 10;
    
    const answerText = Object.values(answers).join(' ').toLowerCase();
    
    for (let i = 0; i < baseCount; i++) {
        let task;
        
        if (isTurkish) {
            const titles = analysis.experienceLevel.includes('beginner') ? [
                'Proje fikrini kağıda dök',
                'Temel hedefleri yaz',
                'İlk hafta planını yap',
                'İhtiyaç duyacağın kaynakları listele',
                'Bir zaman çizelgesi oluştur',
                'İlerlemeyi nasıl takip edeceğini düşün',
                'İlk geri bildirim için birini bul',
                'Küçük bir test yap',
                'Öğrendiklerini not al',
                'Bir sonraki adımı planla'
            ] : [
                'Stratejik yol haritası oluştur',
                'Paydaş analizi ve haritalama yap',
                'Risk değerlendirme matrisi hazırla',
                'KPI ve metrik çerçevesi kur',
                'Süreç optimizasyon planı geliştir',
                'Kaynak dağılım ve optimizasyonu yap',
                'Kalite güvence süreçleri tasarla',
                'İletişim ve raporlama protokolleri belirle',
                'Performans değerlendirme sistemi kur',
                'Sürdürülebilirlik ve devamlılık planı hazırla'
            ];
            
            task = {
                id: `akıllı_${Date.now()}_${i}`,
                title: titles[i % titles.length],
                description: analysis.experienceLevel.includes('beginner') ?
                    `Bu adım projenizin ${i+1}. temel bileşenidir. Küçük başlayın ve her adımda öğrenin.` :
                    `Profesyonel proje yönetimi metodolojilerine uygun olarak bu stratejik görevi tamamlayın.`,
                status: 'todo',
                priority: i < 3 ? 'high' : i < 7 ? 'medium' : 'low',
                tags: analysis.experienceLevel.includes('beginner') ?
                    [`adım${i+1}`, 'temel', 'başlangıç'] :
                    [`stratejik${i+1}`, 'profesyonel', 'yönetim']
            };
        } else {
            const titles = analysis.experienceLevel.includes('beginner') ? [
                'Write down your project idea',
                'Define basic goals',
                'Plan your first week',
                'List resources you will need',
                'Create a timeline',
                'Think about progress tracking',
                'Find someone for initial feedback',
                'Do a small test',
                'Note what you learn',
                'Plan the next step'
            ] : [
                'Create strategic roadmap',
                'Conduct stakeholder analysis and mapping',
                'Prepare risk assessment matrix',
                'Establish KPI and metric framework',
                'Develop process optimization plan',
                'Optimize resource allocation',
                'Design quality assurance processes',
                'Define communication and reporting protocols',
                'Set up performance evaluation system',
                'Prepare sustainability and continuity plan'
            ];
            
            task = {
                id: `smart_${Date.now()}_${i}`,
                title: titles[i % titles.length],
                description: analysis.experienceLevel.includes('beginner') ?
                    `This is step ${i+1} of your project foundation. Start small and learn with each step.` :
                    `Complete this strategic task following professional project management methodologies.`,
                status: 'todo',
                priority: i < 3 ? 'high' : i < 7 ? 'medium' : 'low',
                tags: analysis.experienceLevel.includes('beginner') ?
                    [`step${i+1}`, 'basic', 'foundation'] :
                    [`strategic${i+1}`, 'professional', 'management']
            };
        }
        
        tasks.push(task);
    }
    
    return tasks;
}

// Generate AI report
async function generateAIReport(answers, questions, tasks, language) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const highPriorityTasks = tasks.filter(t => t.priority === 'high' || t.priority === 'critical').length;
    const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium').length;
    
    const answeredQuestions = Object.values(answers).filter(a => 
        a && a !== '[Skipped]' && a !== '[Not Applicable]'
    ).length;
    
    const reportPrompt = isTurkish ? `
BİR PROJE ANALİZ RAPORU OLUŞTUR:

PROJE VERİLERİ:
• ${totalTasks} toplam görev (${completedTasks} tamamlandı)
• ${highPriorityTasks} yüksek öncelikli görev
• ${mediumPriorityTasks} orta öncelikli görev
• ${answeredQuestions} detaylı yanıtlanmış soru

TEMEL GÖREVLER:
${tasks.slice(0, 5).map((t, i) => `${i+1}. ${t.title} (${t.priority} öncelik)`).join('\n')}

KULLANICI CEVAPLARINDAN ÖRNEKLER:
${Object.entries(answers)
    .filter(([_, a]) => a && a !== '[Skipped]' && a !== '[Not Applicable]')
    .slice(0, 3)
    .map(([i, a]) => `• Soru ${parseInt(i)+1}: ${a.substring(0, 80)}${a.length > 80 ? '...' : ''}`)
    .join('\n')}

RAPOR YAPISI (TÜRKÇE):
1. **Proje Özeti** - Genel bakış ve temel bulgular
2. **Mevcut Durum Analizi** - Güçlü yönler ve gelişim alanları
3. **Risk Değerlendirmesi** - Potansiyel riskler ve azaltma stratejileri
4. **Öncelikli Eylem Planı** - Acil ve orta vadeli eylemler
5. **Öneriler** - Proje yönetimi danışmanı tavsiyeleri
6. **İzleme ve Değerlendirme** - İlerlemeyi takip etme yöntemleri

RAPORU OLUŞTUR (Markdown formatında, profesyonel Türkçe):
` : `
CREATE A PROJECT ANALYSIS REPORT:

PROJECT DATA:
• ${totalTasks} total tasks (${completedTasks} completed)
• ${highPriorityTasks} high-priority tasks
• ${mediumPriorityTasks} medium-priority tasks
• ${answeredQuestions} detailed answers

KEY TASKS:
${tasks.slice(0, 5).map((t, i) => `${i+1}. ${t.title} (${t.priority} priority)`).join('\n')}

SAMPLE USER ANSWERS:
${Object.entries(answers)
    .filter(([_, a]) => a && a !== '[Skipped]' && a !== '[Not Applicable]')
    .slice(0, 3)
    .map(([i, a]) => `• Question ${parseInt(i)+1}: ${a.substring(0, 80)}${a.length > 80 ? '...' : ''}`)
    .join('\n')}

REPORT STRUCTURE (ENGLISH):
1. **Executive Summary** - Overview and key findings
2. **Current State Analysis** - Strengths and areas for improvement
3. **Risk Assessment** - Potential risks and mitigation strategies
4. **Priority Action Plan** - Immediate and mid-term actions
5. **Recommendations** - Project management consultant advice
6. **Monitoring & Evaluation** - Progress tracking methods

CREATE THE REPORT (In markdown format, professional English):
`;
    
    try {
        const reportResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: isTurkish ? 
                        `Sen kıdemli bir proje yönetimi danışmanısın. Kapsamlı, profesyonel bir proje analiz raporu oluştur.
                        Raporu markdown formatında, Türkçe olarak hazırla.
                        Bölüm başlıklarını **kalın** yap.
                        Sadece rapor içeriğini döndür, başka açıklama yapma.` :
                        `You are a senior project management consultant. Create a comprehensive, professional project analysis report.
                        Prepare the report in markdown format, in English.
                        Use **bold** for section headers.
                        Return only the report content, no additional explanations.`
                },
                { role: "user", content: reportPrompt }
            ],
            temperature: 0.6,
            max_tokens: 3000
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            timeout: 40000
        });

        return reportResponse.data.choices[0].message.content;
    } catch (error) {
        console.error('AI Report generation failed:', error.message);
        throw error;
    }
}

// Generate smart report
function generateSmartReport(tasks, answers, language, analysis) {
    const isTurkish = language === 'tr';
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const highPriorityTasks = tasks.filter(t => t.priority === 'high' || t.priority === 'critical').length;
    const answeredQuestions = Object.values(answers).filter(a => 
        a && a !== '[Skipped]' && a !== '[Not Applicable]'
    ).length;
    
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    if (isTurkish) {
        return `**Proje Analiz Raporu**
*Oluşturulma Tarihi: ${new Date().toLocaleDateString('tr-TR')}*

**1. Proje Özeti**
Bu analiz, ${answeredQuestions} soru cevabı ve ${totalTasks} görev üzerine yapılmıştır. Proje ${analysis.experienceLevel} seviyesinde bir kullanıcı tarafından başlatılmıştır. Tamamlanma oranı: %${completionRate}.

**2. Mevcut Durum Analizi**
• **Güçlü Yönler**: ${analysis.answerAnalysis.technicalTerms > 0 ? 'Profesyonel terminoloji kullanımı mevcut' : 'Temel proje kavramları tanımlanmış'}
• **Gelişim Alanları**: ${totalTasks < 5 ? 'Daha fazla detaylandırma gerekiyor' : 'Görev yapısı iyi tanımlanmış'}
• **Öncelik Dağılımı**: ${highPriorityTasks} yüksek öncelikli görev

**3. Risk Değerlendirmesi**
• **Orta Risk**: Kapsam netleştirilmeli ve kaynaklar belirlenmeli
• **Düşük Risk**: Temel yapı kurulmuş, görevler tanımlanmış

**4. Öncelikli Eylem Planı**
1. **Hemen (1-3 gün)**: ${highPriorityTasks} yüksek öncelikli görevi tamamlayın
2. **Kısa Vadeli (1 hafta)**: İletişim planı oluşturun ve paydaşları bilgilendirin
3. **Orta Vadeli (2-4 hafta)**: Detaylı zaman çizelgesi hazırlayın

**5. Öneriler**
${analysis.experienceLevel.includes('beginner') ? 
'• Küçük adımlarla başlayın, her tamamlanan görev motivasyonunuzu artıracaktır' :
'• Profesyonel proje yönetimi araçlarını değerlendirin ve metodolojileri uygulayın'}

**6. İzleme ve Değerlendirme**
• Haftalık ilerleme toplantıları yapın
• Tamamlanan görevleri kutlayın ve öğrenilenleri not alın
• Gerektiğinde planı esnek şekilde güncelleyin

*Bu rapor Intuiva Proje Yöneticisi tarafından otomatik oluşturulmuştur.*`;
    } else {
        return `**Project Analysis Report**
*Generated on: ${new Date().toLocaleDateString('en-US')}*

**1. Executive Summary**
This analysis is based on ${answeredQuestions} question answers and ${totalTasks} tasks. Project initiated by a ${analysis.experienceLevel} level user. Completion rate: ${completionRate}%.

**2. Current State Analysis**
• **Strengths**: ${analysis.answerAnalysis.technicalTerms > 0 ? 'Professional terminology usage present' : 'Basic project concepts defined'}
• **Areas for Improvement**: ${totalTasks < 5 ? 'More detailing needed' : 'Task structure well-defined'}
• **Priority Distribution**: ${highPriorityTasks} high-priority tasks

**3. Risk Assessment**
• **Medium Risk**: Scope needs clarification and resources need identification
• **Low Risk**: Basic structure established, tasks defined

**4. Priority Action Plan**
1. **Immediate (1-3 days)**: Complete ${highPriorityTasks} high-priority tasks
2. **Short-term (1 week)**: Create communication plan and inform stakeholders
3. **Mid-term (2-4 weeks)**: Prepare detailed timeline

**5. Recommendations**
${analysis.experienceLevel.includes('beginner') ? 
'• Start with small steps, each completed task will increase your motivation' :
'• Evaluate professional project management tools and apply methodologies'}

**6. Monitoring & Evaluation**
• Conduct weekly progress meetings
• Celebrate completed tasks and note learnings
• Update plan flexibly as needed

*This report was automatically generated by Intuiva Project Manager.*`;
    }
}

// Get generation note
function getGenerationNote(language, experienceLevel, taskCount) {
    if (language === 'tr') {
        if (experienceLevel.includes('beginner')) {
            return `${taskCount} adet başlangıç dostu görev oluşturuldu. Her adımda size rehberlik edecek şekilde tasarlandı.`;
        } else if (experienceLevel === 'professional' || experienceLevel === 'expert') {
            return `${taskCount} adet profesyonel seviye görev oluşturuldu. Stratejik proje yönetimi yaklaşımları içerir.`;
        } else {
            return `${taskCount} adet uygulanabilir görev oluşturuldu. Cevaplarınıza dayalı özelleştirilmiş içerikler içerir.`;
        }
    } else {
        if (experienceLevel.includes('beginner')) {
            return `Created ${taskCount} beginner-friendly tasks. Designed to guide you through each step.`;
        } else if (experienceLevel === 'professional' || experienceLevel === 'expert') {
            return `Created ${taskCount} professional-level tasks. Includes strategic project management approaches.`;
        } else {
            return `Created ${taskCount} actionable tasks. Contains customized content based on your answers.`;
        }
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: DEEPSEEK_API_KEY ? 'healthy' : 'warning',
        service: 'Intuiva AI Backend',
        version: '2.2.0',
        features: [
            'smart-task-generation', 
            'bilingual-support', 
            'experience-adaptation',
            'minimum-10-tasks',
            'project-manager-style'
        ],
        languageSupport: ['English', 'Turkish (Enhanced)'],
        apiKeyConfigured: !!DEEPSEEK_API_KEY,
        minimumTasks: 10,
        maximumTasks: 15,
        timestamp: new Date().toISOString()
    });
});

// Test endpoint
app.post('/test-prompt', async (req, res) => {
    try {
        const { answers, questions, language } = req.body;
        const analysis = analyzeUserInput(answers || {}, questions || [], language || 'en');
        const prompt = constructProjectManagerPrompt(analysis, answers || {}, questions || [], language || 'en');
        
        res.json({ 
            prompt: prompt,
            analysis: {
                experienceLevel: analysis.experienceLevel,
                wordCount: analysis.answerAnalysis.wordCount,
                technicalTerms: analysis.answerAnalysis.technicalTerms,
                languageProfile: analysis.answerAnalysis.languageProfile
            }
        });
    } catch (error) {
        res.json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Intuiva Backend v2.2 running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 Test prompt: POST http://localhost:${PORT}/test-prompt`);
    console.log(`🤖 DeepSeek API Key: ${DEEPSEEK_API_KEY ? 'Set ✅' : 'Missing ❌'}`);
    console.log(`🌍 Enhanced language support: English & Turkish`);
    console.log(`🎯 Always creates 10-15 tasks, experience-based adaptation`);
    console.log(`👨‍💼 Professional project manager style for all levels`);
});
