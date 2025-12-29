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
        const userAnswers = req.body.answers || {};
        const questions = req.body.questions || [];
        const language = req.body.language || 'en';
        const generateReport = req.body.generateReport || false;

        // 1. Construct the AI Prompt for tasks using the enhanced system
        const taskPrompt = constructEnhancedProjectManagerPrompt(userAnswers, questions, language);
        
        // 2. Call DeepSeek API for tasks
        const taskResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: `You are a senior project manager with 15+ years of experience across industries.
                    Your expertise: Turning vague ideas into actionable plans, identifying risks early, and creating structured workflows.
                    Your style: Professional yet approachable, data-driven but pragmatic.
                    Your goal: Create immediately usable Kanban tasks that reflect real-world project management best practices.
                    
                    CRITICAL: Return ONLY a valid JSON array of tasks. No explanations, no additional text.
                    Each task MUST have: id, title, description, status ("todo"), priority ("high"/"medium"/"low"), tags array.` 
                },
                { role: "user", content: taskPrompt }
            ],
            temperature: 0.7,
            max_tokens: 3000
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            timeout: 40000
        });

        // 3. Parse tasks
        const generatedTasksText = taskResponse.data.choices[0].message.content;
        const tasks = parseAITasks(generatedTasksText);
        const validatedTasks = validateAndCompleteTasks(tasks, userAnswers, language);

        // 4. Generate report if requested
        let report = null;
        if (generateReport) {
            try {
                report = await generateAIReport(userAnswers, questions, validatedTasks, language);
            } catch (reportError) {
                console.error('Report generation failed:', reportError.message);
                report = generateDefaultReport(validatedTasks, userAnswers, language);
            }
        }

        // 5. Send response
        res.json({ 
            success: true, 
            tasks: validatedTasks,
            report: report,
            note: validatedTasks.length > 0 ? "AI generated tasks based on your input" : "Using recommended tasks"
        });

    } catch (error) {
        console.error('DeepSeek API Error:', error.response?.data || error.message);
        // Return default tasks as fallback
        const language = req.body.language || 'en';
        res.json({ 
            success: true, 
            tasks: generateDefaultTasks(language),
            report: generateDefaultReport([], {}, language),
            note: "AI service temporarily unavailable - using recommended starter tasks"
        });
    }
});

// Separate endpoint for generating reports only
app.post('/api/generate-report', async (req, res) => {
    try {
        const { answers, questions, tasks, language } = req.body;
        
        const report = await generateAIReport(answers || {}, questions || [], tasks || [], language || 'en');
        
        res.json({ 
            success: true, 
            report: report,
            note: "AI generated project report"
        });

    } catch (error) {
        console.error('Report generation failed:', error.message);
        const language = req.body.language || 'en';
        res.json({ 
            success: true, 
            report: generateDefaultReport(req.body.tasks || [], req.body.answers || {}, language),
            note: "Using locally generated report"
        });
    }
});

// Enhanced prompt construction with the sophisticated analysis from your original
function constructEnhancedProjectManagerPrompt(answers, questions, language) {
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
        answerAnalysis,
        language
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

// Helper Functions (all the original helper functions)
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

function buildEnhancedPrompt(experienceLevel, experienceReasoning, primaryLanguage, primaryIndustry, languageGuidance, industryAdjustments, qaText, analysis, targetLanguage) {
    // Task count based on experience
    const taskCount = experienceLevel.includes('beginner') ? 6 : 
                     experienceLevel === 'intermediate' ? 8 :
                     experienceLevel === 'experienced' ? 10 : 12;
    
    // Tone based on experience
    const tone = experienceLevel.includes('beginner') ? 
                "warm, encouraging, and patient" : 
                "professional, respectful, and collaborative";
    
    const isTurkish = targetLanguage === 'tr';
    
    if (isTurkish) {
        return `ROLE: Küresel deneyime sahip, çok dilli bir proje yönetimi danışmanısınız.
CONTEXT: Gelişmiş analize göre, kullanıcı "${experienceLevel}" seviyesinde.
REASONING: ${experienceReasoning}
INDUSTRY CONTEXT: ${primaryIndustry}
LANGUAGE: TÜRKÇE

${languageGuidance}

ENDÜSTRİYE ÖZEL YÖNLENDİRME:
• ${industryAdjustments}
• ${primaryIndustry}-özgü zorlukları ve fırsatları düşünün
• Endüstriye uygun araç ve metodolojiler önerin

DENEYİME GÖRE AYARLANMIŞ TALİMATLAR:
1. Tam olarak ${taskCount} uygulanabilir Kanban görevi oluşturun
2. Görev karmaşıklığını şuna uydurun: ${experienceLevel.replace('_', ' ')}
3. Görev açıklamalarında ${tone} ton kullanın
4. Yeni başlayanlar için: Güven oluşturmak için "hızlı kazanç" görevleri ekleyin
5. Uzmanlar için: Stratejik ve optimizasyon görevleri ekleyin
6. Anlamlı olduğunda özgün cevaplarına atıfta bulunun

GÖREV YAPISI GEREKSİNİMLERİ:
• Durum: Her zaman 'todo' (henüz başlamadılar)
• Öncelik: Yüksek (1-2), orta (3-4), düşük (geri kalan) karışımı
• Etiketler: Deneyim seviyesine uygun etiketler ekleyin
• Açıklamalar: ${experienceLevel.includes('beginner') ? 'Kısa "bu neden önemli" açıklamaları ekleyin' : 'Profesyonel bağlamı varsayın'}

ÖZEL DÜŞÜNCELER:
${analysis.answerPatterns.includes('seeking_guidance') ? '• Kullanıcı sorular sordu - bunları ilgili görevlerde doğrudan ele alın' : ''}
${analysis.answerPatterns.includes('requesting_examples') ? '• Kullanıcı örnekler istiyor - görev açıklamalarında somut senaryolar sağlayın' : ''}
${primaryLanguage === 'mixed' ? '• Kullanıcı dilleri karıştırıyor - faydalı olduğunda Türkçe terimlerle net, basit İngilizce ile yanıt verin' : ''}

KRİTİK FORMAT GEREKSİNİMLERİ:
• SADECE geçerli bir JSON dizisi döndürün
• Ek metin, açıklama veya markdown yok
• Her görev: {"id": "tanımlayıcı_id", "title": "Görev", "description": "...", "status": "todo", "priority": "high/medium/low", "tags": ["etiket1", "etiket2"]}
• ID'ler küçük harfli_alt_çizgili olmalı

KULLANICININ S&C (orijinal dili koruyun):
${qaText}

CEVABINIZ (SADECE JSON dizisi):`;
    } else {
        return `ROLE: You are an adaptive, multilingual project management consultant with global experience.
CONTEXT: Based on sophisticated analysis, user is at "${experienceLevel}" level.
REASONING: ${experienceReasoning}
INDUSTRY CONTEXT: ${primaryIndustry}
LANGUAGE: ENGLISH

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
}

// Generate AI report
async function generateAIReport(answers, questions, tasks, language) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const highPriorityTasks = tasks.filter(t => t.priority === 'high' || t.priority === 'critical').length;
    
    const answeredQuestions = Object.values(answers).filter(a => 
        a && a !== '[Skipped]' && a !== '[Not Applicable]'
    ).length;
    
    const reportPrompt = isTurkish ? `
BİR PROJE RAPORU OLUŞTUR:

PROJE VERİLERİ:
• ${totalTasks} toplam görev (${completedTasks} tamamlandı)
• ${highPriorityTasks} yüksek öncelikli görev
• ${answeredQuestions} detaylı yanıtlanmış soru

RAPOR YAPISI:
1. **Proje Özeti** - Genel bakış ve temel bulgular
2. **Analiz ve Değerlendirme** - Güçlü yönler ve gelişim alanları
3. **Risk Değerlendirmesi** - Potansiyel riskler ve azaltma stratejileri
4. **Öneriler** - Eylem odaklı tavsiyeler
5. **Sonraki Adımlar** - Acil ve orta vadeli eylemler

GÖREVLER:
${tasks.map((t, i) => `${i+1}. ${t.title} (${t.priority} öncelik)`).join('\n')}

DETAYLI YANITLARDAN ÖRNEKLER:
${Object.entries(answers)
    .filter(([_, a]) => a && a !== '[Skipped]' && a !== '[Not Applicable]')
    .slice(0, 3)
    .map(([i, a]) => `• Soru ${parseInt(i)+1}: ${a.substring(0, 100)}...`)
    .join('\n')}

RAPORU OLUŞTUR (Markdown formatında, Türkçe):
` : `
CREATE A PROJECT REPORT:

PROJECT DATA:
• ${totalTasks} total tasks (${completedTasks} completed)
• ${highPriorityTasks} high-priority tasks
• ${answeredQuestions} detailed answers

REPORT STRUCTURE:
1. **Executive Summary** - Overview and key findings
2. **Analysis & Assessment** - Strengths and areas for improvement
3. **Risk Assessment** - Potential risks and mitigation strategies
4. **Recommendations** - Actionable advice
5. **Next Steps** - Immediate and mid-term actions

TASKS:
${tasks.map((t, i) => `${i+1}. ${t.title} (${t.priority} priority)`).join('\n')}

SAMPLE ANSWERS:
${Object.entries(answers)
    .filter(([_, a]) => a && a !== '[Skipped]' && a !== '[Not Applicable]')
    .slice(0, 3)
    .map(([i, a]) => `• Question ${parseInt(i)+1}: ${a.substring(0, 100)}...`)
    .join('\n')}

CREATE THE REPORT (In markdown format, English):
`;
    
    const reportResponse = await axios.post(DEEPSEEK_API_URL, {
        model: "deepseek-chat",
        messages: [
            { 
                role: "system", 
                content: `You are a senior management consultant creating executive project reports.
                Create a comprehensive one-page project report with these sections:
                1. Executive Summary
                2. Project Analysis
                3. Risk Assessment
                4. Recommendations
                5. Next Steps
                
                Be specific, data-driven, and actionable. Use markdown formatting with **bold** for section headers.
                Return only the report content, no additional text.` 
            },
            { role: "user", content: reportPrompt }
        ],
        temperature: 0.6,
        max_tokens: 2500
    }, {
        headers: { 
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
            'Content-Type': 'application/json' 
        },
        timeout: 30000
    });

    return reportResponse.data.choices[0].message.content;
}

// Parse AI tasks with better error handling
function parseAITasks(text) {
    try {
        const cleanText = text.trim();
        const jsonStart = cleanText.indexOf('[');
        const jsonEnd = cleanText.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
            console.log("No JSON array found");
            return [];
        }
        
        const jsonString = cleanText.substring(jsonStart, jsonEnd);
        const tasks = JSON.parse(jsonString);
        
        if (!Array.isArray(tasks)) {
            console.log("Response is not an array");
            return [];
        }
        
        return tasks;
        
    } catch (e) {
        console.error("Parsing AI tasks failed:", e.message);
        console.log("Response snippet:", text.substring(0, 300));
        return [];
    }
}

// Validate and complete task structure
function validateAndCompleteTasks(tasks, userAnswers, language) {
    const isTurkish = language === 'tr';
    
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return generateDefaultTasks(language);
    }
    
    return tasks.map((task, index) => {
        const validatedTask = {
            id: task.id || `task_${Date.now()}_${index}`,
            title: task.title || (isTurkish ? `Görev ${index + 1}` : `Task ${index + 1}`),
            description: task.description || (isTurkish ? 'Açıklama eklenecek' : 'Description to be added'),
            status: ['todo', 'inprogress', 'done'].includes(task.status) ? task.status : 'todo',
            priority: ['critical', 'high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
            tags: Array.isArray(task.tags) ? task.tags : [isTurkish ? 'proje' : 'project']
        };
        
        // Personalize based on answers if possible
        if (Object.keys(userAnswers).length > 0) {
            const firstAnswer = Object.values(userAnswers).find(a => 
                a && a !== '[Skipped]' && a !== '[Not Applicable]'
            );
            if (firstAnswer && firstAnswer.length > 10) {
                // Add personal touch to first task
                if (index === 0) {
                    validatedTask.description += ` ${isTurkish ? 
                        `"${firstAnswer.substring(0, 50)}..." yanıtınıza dayanarak` : 
                        `Based on your answer about "${firstAnswer.substring(0, 50)}..."`}`;
                }
            }
        }
        
        return validatedTask;
    }).slice(0, 15); // Limit to 15 tasks max
}

// Generate sensible default tasks
function generateDefaultTasks(language = 'en') {
    const isTurkish = language === 'tr';
    
    return [
        {
            id: `default_${Date.now()}_1`,
            title: isTurkish ? 'Proje vizyonunu netleştir' : 'Clarify project vision',
            description: isTurkish ? 
                'Projenin temel amacını ve hedeflerini 2-3 cümlede açıkla' :
                'Define the core purpose and objectives in 2-3 sentences',
            status: "todo",
            priority: "high",
            tags: isTurkish ? ['vizyon', 'planlama'] : ['vision', 'planning']
        },
        {
            id: `default_${Date.now()}_2`,
            title: isTurkish ? 'Ana paydaşları belirle' : 'Identify key stakeholders',
            description: isTurkish ? 
                'Projeden etkilenecek kişi ve grupları listeleyerek iletişim planı oluştur' :
                'List people and groups affected by the project and create a communication plan',
            status: "todo",
            priority: "high",
            tags: isTurkish ? ['paydaşlar', 'iletişim'] : ['stakeholders', 'communication']
        },
        {
            id: `default_${Date.now()}_3`,
            title: isTurkish ? 'Başarı metriklerini tanımla' : 'Define success metrics',
            description: isTurkish ? 
                'Projenin başarısını nasıl ölçeceğini belirleyerek somut KPI\'lar oluştur' :
                'Determine how to measure project success with concrete KPIs',
            status: "todo",
            priority: "medium",
            tags: isTurkish ? ['metrikler', 'ölçüm'] : ['metrics', 'measurement']
        },
        {
            id: `default_${Date.now()}_4`,
            title: isTurkish ? 'İlk 3 adımı belirle' : 'Identify first 3 steps',
            description: isTurkish ? 
                'Hemen başlayabileceğin en küçük, en kolay 3 şey nedir?' :
                'What are the 3 smallest, easiest things you could do right away?',
            status: "todo",
            priority: "medium",
            tags: isTurkish ? ['eylem', 'başlangıç'] : ['action', 'start']
        }
    ];
}

// Generate default report
function generateDefaultReport(tasks, answers, language) {
    const isTurkish = language === 'tr';
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const answeredQuestions = Object.values(answers).filter(a => 
        a && a !== '[Skipped]' && a !== '[Not Applicable]'
    ).length;
    
    return isTurkish ? `
**Proje Özeti**
Bu rapor, ${answeredQuestions} soru yanıtına ve ${totalTasks} göreve dayanarak oluşturulmuştur. Proje yapısı temel düzeyde tanımlanmış olup daha fazla detaylandırılması gerekmektedir.

**Analiz ve Değerlendirme**
• **Mevcut Durum**: Proje başlangıç aşamasında, temel çerçeve oluşturulmuş
• **Güçlü Yönler**: Proje kapsamı netleştirilmiş, temel görevler tanımlanmış
• **Gelişim Alanları**: Risk analizi, zaman çizelgesi ve kaynak planlaması gerekiyor

**Risk Değerlendirmesi**
• **Orta Risk**: Kapsam belirsizliği ve kaynak tahsisi ihtiyacı
• **Düşük Risk**: Temel yapı sağlam, görevler net tanımlanmış

**Öneriler**
1. **Hemen**: Kapsamı netleştir, kaynakları belirle
2. **Kısa Vadeli**: Detaylı zaman çizelgesi oluştur
3. **Orta Vadeli**: Risk yönetim planı geliştir

**Sonraki Adımlar**
1. Proje kapsam belgesini tamamla
2. Görev zamanlamalarını belirle
3. Haftalık ilerleme takibi başlat

*Bu otomatik oluşturulmuş bir rapordur. Detaylar proje ilerledikçe güncellenmelidir.*
` : `
**Executive Summary**
This report is based on ${answeredQuestions} answered questions and ${totalTasks} defined tasks. The project structure is defined at a basic level and requires further detailing.

**Analysis & Assessment**
• **Current Status**: Project in initial phase, basic framework established
• **Strengths**: Clear project scope, well-defined core tasks
• **Areas for Improvement**: Need for risk analysis, timeline, and resource planning

**Risk Assessment**
• **Medium Risk**: Scope uncertainty and resource allocation needs
• **Low Risk**: Solid foundation, clearly defined tasks

**Recommendations**
1. **Immediate**: Clarify scope, identify resources
2. **Short-term**: Create detailed timeline
3. **Mid-term**: Develop risk management plan

**Next Steps**
1. Complete project scope document
2. Define task schedules
3. Initiate weekly progress tracking

*This is an automatically generated report. Details should be updated as the project progresses.*
`;
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Intuiva AI Backend',
        version: '2.0.0',
        features: ['task-generation', 'project-reports', 'multilingual', 'experience-analysis'],
        timestamp: new Date().toISOString()
    });
});

// Test endpoint
app.post('/test-prompt', (req, res) => {
    const { answers, questions, language } = req.body;
    const prompt = constructEnhancedProjectManagerPrompt(answers || {}, questions || [], language || 'en');
    res.json({ prompt: prompt });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Intuiva Backend v2.0 running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 DeepSeek API Key: ${DEEPSEEK_API_KEY ? 'Set ✅' : 'Missing ❌'}`);
    console.log(`🌍 Features: Enhanced task generation + Project reports`);
});
