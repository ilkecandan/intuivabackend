const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for larger responses

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Main task generation endpoint with unlimited token support
app.post('/api/generate-tasks', async (req, res) => {
    try {
        console.log('🚀 Task generation request received');
        console.log('📋 Language:', req.body.language || 'en');
        console.log('📊 Answers count:', Object.keys(req.body.answers || {}).length);
        
        const userAnswers = req.body.answers || {};
        const questions = req.body.questions || [];
        const language = req.body.language || 'en';
        const generateReport = req.body.generateReport || false;
        const extendedMode = req.body.extendedMode || false; // New flag for extended responses

        // 1. Analyze user input with enhanced analysis
        const analysis = analyzeUserInput(userAnswers, questions, language);
        const taskPrompt = constructProjectManagerPrompt(analysis, userAnswers, questions, language, extendedMode);
        
        console.log(`🤖 Calling DeepSeek API (${language}) with extended mode: ${extendedMode}...`);
        console.log(`📝 Prompt length: ${taskPrompt.length} characters`);
        
        // 2. Call DeepSeek API with MAXIMUM token allowance
        const systemPrompt = getSystemPrompt(language, analysis.experienceLevel, extendedMode);
        
        // Use dynamic max_tokens based on extended mode
        const maxTokens = extendedMode ? 16000 : 8000; // Up to 16k tokens for extended mode
        
        const taskResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: systemPrompt
                },
                { role: "user", content: taskPrompt }
            ],
            temperature: extendedMode ? 0.8 : 0.7, // Slightly more creative for extended mode
            max_tokens: maxTokens,
            stream: false
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 120000, // 2 minute timeout for large responses
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: (status) => status < 500
        });

        // 3. Parse tasks with enhanced parsing
        const generatedTasksText = taskResponse.data.choices[0].message.content;
        const tokenUsage = taskResponse.data.usage;
        
        console.log('✅ AI Response received');
        console.log(`📊 Response length: ${generatedTasksText.length} characters`);
        console.log(`🎯 Tokens used: ${tokenUsage?.total_tokens || 'N/A'}`);
        
        const tasks = parseAITasks(generatedTasksText, extendedMode);
        const validatedTasks = validateAndCompleteTasks(tasks, userAnswers, language, analysis, extendedMode);
        
        // 4. Ensure comprehensive task list
        const finalTasks = ensureComprehensiveTasks(validatedTasks, userAnswers, language, analysis, extendedMode);
        
        // 5. Generate comprehensive report if requested
        let report = null;
        if (generateReport) {
            try {
                report = await generateAIReport(userAnswers, questions, finalTasks, language, extendedMode);
            } catch (reportError) {
                console.error('AI Report generation failed:', reportError.message);
                // Generate more comprehensive smart report
                report = generateComprehensiveSmartReport(finalTasks, userAnswers, language, analysis, extendedMode);
            }
        }

        // 6. Send response with extended information
        res.json({ 
            success: true, 
            tasks: finalTasks,
            report: report,
            note: getGenerationNote(language, analysis.experienceLevel, finalTasks.length, extendedMode),
            analysis: {
                experienceLevel: analysis.experienceLevel,
                industry: analysis.primaryIndustry,
                languageProfile: analysis.languageProfile,
                taskCount: finalTasks.length,
                averageTaskLength: calculateAverageTaskLength(finalTasks),
                extendedMode: extendedMode,
                tokenEstimate: tokenUsage?.total_tokens || 'unknown'
            }
        });

    } catch (error) {
        console.error('🔥 DeepSeek API Error:', error.code || error.message);
        console.error('Stack trace:', error.stack);
        
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
            if (error.response.status === 401) {
                console.error('❌ API Key issue - Check DEEPSEEK_API_KEY environment variable');
            }
        }
        
        const language = req.body.language || 'en';
        const userAnswers = req.body.answers || {};
        const questions = req.body.questions || [];
        const extendedMode = req.body.extendedMode || false;
        
        // Generate comprehensive fallback tasks
        const analysis = analyzeUserInput(userAnswers, questions, language);
        const fallbackTasks = generateComprehensiveFallbackTasks(userAnswers, language, analysis, extendedMode);
        
        res.json({ 
            success: true, 
            tasks: fallbackTasks,
            report: generateComprehensiveSmartReport(fallbackTasks, userAnswers, language, analysis, extendedMode),
            note: language === 'tr' 
                ? `AI servisi geçici olarak kullanılamıyor - ${extendedMode ? 'kapsamlı ' : ''}akıllı görevler oluşturuldu` 
                : `AI service temporarily unavailable - created ${extendedMode ? 'comprehensive ' : ''}smart tasks based on your answers`,
            fallback: true,
            analysis: {
                experienceLevel: analysis.experienceLevel,
                taskCount: fallbackTasks.length,
                extendedMode: extendedMode
            }
        });
    }
});

// Separate endpoint for generating comprehensive reports
app.post('/api/generate-report', async (req, res) => {
    try {
        console.log('📊 Comprehensive report generation request received');
        
        const { answers, questions, tasks, language, extendedMode } = req.body;
        const analysis = analyzeUserInput(answers || {}, questions || [], language || 'en');
        
        const report = await generateAIReport(answers || {}, questions || [], tasks || [], language || 'en', extendedMode || false);
        
        res.json({ 
            success: true, 
            report: report,
            note: language === 'tr' 
                ? `AI tarafından oluşturulmuş ${extendedMode ? 'kapsamlı ' : ''}${analysis.experienceLevel} seviyesi proje raporu` 
                : `AI generated ${extendedMode ? 'comprehensive ' : ''}${analysis.experienceLevel}-level project report`,
            analysis: {
                experienceLevel: analysis.experienceLevel,
                extendedMode: extendedMode || false,
                reportLength: report.length
            }
        });

    } catch (error) {
        console.error('Comprehensive report generation failed:', error.message);
        const language = req.body.language || 'en';
        const analysis = analyzeUserInput(req.body.answers || {}, req.body.questions || [], language);
        const extendedMode = req.body.extendedMode || false;
        
        res.json({ 
            success: true, 
            report: generateComprehensiveSmartReport(req.body.tasks || [], req.body.answers || {}, language, analysis, extendedMode),
            note: "Using comprehensive locally generated report",
            fallback: true,
            extendedMode: extendedMode
        });
    }
});

// ===== ENHANCED HELPER FUNCTIONS WITH EXTENDED SUPPORT =====

// Enhanced user input analysis
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
        elaborationScore: 0, // New: measures answer depth
        professionalKeywords: new Set(),
        industryKeywords: new Set(),
        languageProfile: { english: 0, turkish: 0, mixed: 0 },
        answerPatterns: [],
        keyThemes: [],
        projectScopeIndicators: [],
        mentionedTools: [],
        mentionedTimeframes: [],
        mentionedResources: [],
        complexityLevel: 'basic',
        elaborationOpportunities: []
    };
    
    // Enhanced professional indicators
    const turkishProfessionalIndicators = [
        'proje yönetimi', 'stratejik planlama', 'risk yönetimi', 'paydaş analizi',
        'kaynak optimizasyonu', 'zaman yönetimi', 'bütçe planlaması', 'kalite güvence',
        'iletişim stratejisi', 'performans ölçümü', 'süreç iyileştirme', 'değişim yönetimi',
        'çevik metodolojiler', 'scrum master', 'product owner', 'sprint planlama',
        'geri bildirim döngüsü', 'sürekli iyileştirme', 'kpi takibi', 'raporlama sistemi'
    ];
    
    const englishProfessionalIndicators = [
        'project management', 'strategic planning', 'risk management', 'stakeholder analysis',
        'resource optimization', 'time management', 'budget planning', 'quality assurance',
        'communication strategy', 'performance measurement', 'process improvement', 'change management',
        'agile methodologies', 'scrum master', 'product owner', 'sprint planning',
        'feedback loop', 'continuous improvement', 'kpi tracking', 'reporting system'
    ];
    
    // Build comprehensive Q&A text
    Object.entries(answers).forEach(([index, answer]) => {
        const questionIndex = parseInt(index);
        if (questionIndex < questions.length && answer) {
            const question = questions[questionIndex];
            const answerText = answer.trim();
            
            // Build detailed Q&A text
            if (targetLanguage === 'tr') {
                qaText += `SORU ${parseInt(index) + 1} (${question.category || 'Genel'}): ${question.text}\n`;
                qaText += `CEVAP ${parseInt(index) + 1}: ${answer || "(Cevap verilmedi)"}\n`;
                qaText += `CEVAP UZUNLUĞU: ${answerText.length} karakter\n`;
                qaText += `---\n\n`;
            } else {
                qaText += `QUESTION ${parseInt(index) + 1} (${question.category}): ${question.text}\n`;
                qaText += `ANSWER ${parseInt(index) + 1}: ${answer || "(No answer provided)"}\n`;
                qaText += `ANSWER LENGTH: ${answerText.length} characters\n`;
                qaText += `---\n\n`;
            }
            
            if (answerText && answerText !== '[Skipped]' && answerText !== '[Not Applicable]') {
                hasSubstantialAnswers = true;
                
                // Analyze language and content
                analyzeLanguage(answerText, answerAnalysis, targetLanguage);
                
                const words = answerText.split(/\s+/).filter(w => w.length > 0);
                answerAnalysis.wordCount += words.length;
                
                // Check for professional terms
                const indicators = targetLanguage === 'tr' ? turkishProfessionalIndicators : englishProfessionalIndicators;
                indicators.forEach(term => {
                    if (answerText.toLowerCase().includes(term.toLowerCase())) {
                        answerAnalysis.technicalTerms++;
                        answerAnalysis.professionalKeywords.add(term);
                    }
                });
                
                // Extract key themes and opportunities for elaboration
                extractKeyThemes(answerText, answerAnalysis, targetLanguage);
                
                // Check elaboration level
                if (answerText.length > 500) {
                    answerAnalysis.elaborationScore += 3;
                } else if (answerText.length > 200) {
                    answerAnalysis.elaborationScore += 2;
                } else if (answerText.length > 50) {
                    answerAnalysis.elaborationScore += 1;
                }
                
                // Check for structured thinking
                if (answerText.includes('\n') || answerText.includes('•') || answerText.includes('- ')) {
                    answerAnalysis.structuredThinking++;
                }
                
                // Check for specific details
                const detailMatches = answerText.match(/\d+/g);
                if (detailMatches) {
                    answerAnalysis.specificDetails += detailMatches.length;
                }
                
                // Identify elaboration opportunities
                if (answerText.length < 100 && answerText.length > 20) {
                    answerAnalysis.elaborationOpportunities.push({
                        questionIndex,
                        answerPreview: answerText.substring(0, 50) + '...',
                        suggestion: targetLanguage === 'tr' ? 
                            'Bu cevap daha fazla detaylandırılabilir' : 
                            'This answer could be elaborated further'
                    });
                }
            }
        }
    });
    
    // Determine experience level with more granularity
    let experienceLevel = "beginner_new";
    let experienceReasoning = "";
    
    if (answerAnalysis.wordCount > 1000 && answerAnalysis.technicalTerms > 10) {
        experienceLevel = "expert";
        experienceReasoning = targetLanguage === 'tr'
            ? "Uzman seviyesi - ileri düzey proje yönetimi bilgisi ve deneyimi"
            : "Expert level - advanced project management knowledge and experience";
    } else if (answerAnalysis.wordCount > 500 && answerAnalysis.technicalTerms > 5) {
        experienceLevel = "professional";
        experienceReasoning = targetLanguage === 'tr'
            ? "Profesyonel seviye - kapsamlı proje yönetimi bilgisi ve uygulama becerisi"
            : "Professional level - comprehensive project management knowledge and application skills";
    } else if (answerAnalysis.wordCount > 200) {
        experienceLevel = "experienced";
        experienceReasoning = targetLanguage === 'tr'
            ? "Deneyimli kullanıcı - pratik bilgi ve uygulama deneyimi mevcut"
            : "Experienced user - has practical knowledge and application experience";
    } else if (answerAnalysis.wordCount > 50) {
        experienceLevel = "intermediate";
        experienceReasoning = targetLanguage === 'tr'
            ? "Orta seviye - temel kavramları anlıyor, uygulamada rehberlik gerekiyor"
            : "Intermediate - understands basic concepts, needs guidance in application";
    } else {
        experienceReasoning = targetLanguage === 'tr'
            ? "Yeni başlayan - kapsamlı rehberlik ve destek gerekiyor"
            : "New beginner - requires comprehensive guidance and support";
    }
    
    // Determine complexity level
    if (answerAnalysis.technicalTerms > 5 && answerAnalysis.wordCount > 300) {
        answerAnalysis.complexityLevel = 'advanced';
    } else if (answerAnalysis.technicalTerms > 2 || answerAnalysis.wordCount > 150) {
        answerAnalysis.complexityLevel = 'intermediate';
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

// Enhanced system prompts for extended responses
function getSystemPrompt(language, experienceLevel, extendedMode = false) {
    if (language === 'tr') {
        if (extendedMode) {
            return `SEN 20+ YILLIK DENEYİME SAHİP, ALANINDA UZMAN BİR PROJE YÖNETİMİ DANIŞMANISIN.

ÖZELLİKLER:
1. DERİNLEMESİNE ANALİZ YAP - Her görev için kapsamlı açıklamalar oluştur
2. PRATİK ÖRNEKLER VER - Gerçek hayat senaryoları ve uygulanabilir çözümler sun
3. ADIM ADIM REHBERLİK - Her görevi detaylı adımlara böl
4. STRATEJİK DÜŞÜN - Uzun vadeli planlama ve risk yönetimi içer
5. KİŞİSELLEŞTİR - Kullanıcının spesifik cevaplarını görevlere entegre et

GÖREV FORMATI:
{
  "id": "benzersiz_detaylı_id",
  "title": "Açıklayıcı ve kapsamlı Türkçe başlık",
  "description": "DETAYLI AÇIKLAMA (minimum 3-5 cümle): 
     • Görevin amacı ve hedefleri
     • Adım adım uygulama planı
     • Beklenen sonuçlar ve faydalar
     • Olası zorluklar ve çözüm önerileri
     • İlgili kaynaklar ve araç önerileri",
  "status": "todo",
  "priority": "critical/high/medium/low",
  "tags": ["detaylı_etiket1", "detaylı_etiket2", "detaylı_etiket3"],
  "estimatedTime": "X saat/gün",
  "dependencies": ["ilgili_görev_id"],
  "successCriteria": ["ölçülebilir_başarı_kriteri1", "ölçülebilir_başarı_kriteri2"]
}

ÖNEMLİ:
• Her görev için EN AZ 300-500 karakterlik detaylı açıklama oluştur
• Kullanıcının spesifik cevaplarından alıntılar ve referanslar kullan
• Her görevde "NASIL YAPILIR" bölümü ekle
• Gerçek hayat örnekleri ve en iyi uygulamaları paylaş
• Risk yönetimi ve kalite kontrol öğelerini dahil et

SADECE GEÇERLİ JSON DİZİSİ DÖNDÜR, BAŞKA METİN EKLEME.`;
        }
        
        if (experienceLevel.includes('beginner')) {
            return `Sen 15+ yıllık deneyime sahip, sabırlı ve destekleyici bir proje yönetimi koçusun.
Kullanıcı yeni başlıyor, bu yüzden:
1. Çok basit ve anlaşılır Türkçe kullan
2. Her görevde detaylı "Nasıl Yapılır" rehberi ekle
3. Cesaret verici ve motive edici ol
4. Küçük, başarılabilir adımlar öner
5. Kullanıcının cevaplarından öğeleri görevlere dahil et
6. Her görev için en az 150-200 karakter açıklama

Görev formatı:
{
  "id": "benzersiz_id",
  "title": "Türkçe görev başlığı",
  "description": "Detaylı, açıklayıcı ve motive edici açıklama (minimum 150 karakter)",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["etiket1", "etiket2"]
}`;
        } else {
            return `Sen 20+ yıllık deneyime sahip, sektör lideri bir proje yönetimi danışmanısın.
Kullanıcı ${experienceLevel} seviyesinde, bu yüzden:
1. Profesyonel Türkçe proje yönetimi terminolojisi kullan
2. Stratejik ve detaylı görevler oluştur
3. En iyi uygulamaları ve endüstri standartlarını referans al
4. Risk yönetimi, KPI'lar ve optimizasyon öğelerini dahil et
5. Kullanıcının cevaplarından detaylı öğeleri görevlere dahil et
6. Her görev için en az 250-300 karakter açıklama

Görev formatı:
{
  "id": "benzersiz_id",
  "title": "Profesyonel Türkçe görev başlığı",
  "description": "Detaylı ve stratejik açıklama (minimum 250 karakter)",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["profesyonel_etiket1", "profesyonel_etiket2"]
}`;
        }
    } else {
        if (extendedMode) {
            return `YOU ARE A 20+ YEAR EXPERIENCED, EXPERT PROJECT MANAGEMENT CONSULTANT.

FEATURES:
1. PROVIDE IN-DEPTH ANALYSIS - Create comprehensive descriptions for each task
2. GIVE PRACTICAL EXAMPLES - Offer real-life scenarios and actionable solutions
3. STEP-BY-STEP GUIDANCE - Break down each task into detailed steps
4. STRATEGIC THINKING - Include long-term planning and risk management
5. PERSONALIZE - Integrate user's specific answers into tasks

TASK FORMAT:
{
  "id": "unique_detailed_id",
  "title": "Descriptive and comprehensive English title",
  "description": "DETAILED DESCRIPTION (minimum 5-7 sentences):
     • Purpose and objectives of the task
     • Step-by-step implementation plan
     • Expected outcomes and benefits
     • Potential challenges and solution suggestions
     • Relevant resources and tool recommendations",
  "status": "todo",
  "priority": "critical/high/medium/low",
  "tags": ["detailed_tag1", "detailed_tag2", "detailed_tag3"],
  "estimatedTime": "X hours/days",
  "dependencies": ["related_task_id"],
  "successCriteria": ["measurable_success_criterion1", "measurable_success_criterion2"]
}

IMPORTANT:
• Create MINIMUM 500-700 character detailed descriptions for each task
• Use quotes and references from user's specific answers
• Include "HOW TO IMPLEMENT" section for each task
• Share real-life examples and best practices
• Include risk management and quality control elements

RETURN ONLY VALID JSON ARRAY, NO ADDITIONAL TEXT.`;
        }
        
        if (experienceLevel.includes('beginner')) {
            return `You are a senior project management coach with 15+ years experience.
The user is just starting, so:
1. Use very simple and clear English
2. Add detailed "How to Do It" guide for each task
3. Be encouraging and motivational
4. Suggest small, achievable steps
5. Incorporate elements from the user's specific answers
6. Minimum 200-250 character description per task

Task format:
{
  "id": "unique_id",
  "title": "Simple English task title",
  "description": "Detailed, descriptive and encouraging description (minimum 200 characters)",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["tag1", "tag2"]
}`;
        } else {
            return `You are a senior project management consultant with 20+ years global experience.
The user is at ${experienceLevel} level, so:
1. Create professional, detailed, actionable Kanban tasks
2. Include strategic considerations and best practices
3. Reference industry standards where applicable
4. Incorporate specific elements from user's answers
5. Minimum 300-350 character description per task

Task format:
{
  "id": "unique_id",
  "title": "Professional English task title",
  "description": "Detailed and strategic description (minimum 300 characters)",
  "status": "todo",
  "priority": "high/medium/low",
  "tags": ["professional_tag1", "professional_tag2"]
}`;
        }
    }
}

// Construct comprehensive project manager prompt
function constructProjectManagerPrompt(analysis, answers, questions, targetLanguage, extendedMode = false) {
    const MIN_TASKS = extendedMode ? 15 : 10;
    const MAX_TASKS = extendedMode ? 25 : 15;
    
    if (targetLanguage === 'tr') {
        return `ÜST DÜZEY PROJE YÖNETİMİ DANIŞMANI GÖREVLERİ OLUŞTUR:

KULLANICI PROFİLİ ANALİZİ:
• Seviye: ${analysis.experienceLevel}
• Açıklama: ${analysis.experienceReasoning}
• Karmaşıklık Seviyesi: ${analysis.answerAnalysis.complexityLevel}
• Toplam Kelime: ${analysis.answerAnalysis.wordCount} kelime
• Teknik Terimler: ${analysis.answerAnalysis.technicalTerms} terim
• Ana Temalar: ${analysis.answerAnalysis.keyThemes.slice(0, 8).join(', ') || 'Genel proje yönetimi'}
• Profesyonel Anahtar Kelimeler: ${Array.from(analysis.answerAnalysis.professionalKeywords).slice(0, 10).join(', ') || 'Belirlenmedi'}
• Detaylandırma Puanı: ${analysis.answerAnalysis.elaborationScore}/10

KULLANICI CEVAPLARI (TAM METİN):
${analysis.qaText}

DETAYLI TALİMATLAR:
1. Tam olarak ${MIN_TASKS}-${MAX_TASKS} adet DETAYLI KANBAN görevi oluştur
2. ${extendedMode ? 'HER GÖREV EN AZ 300-500 KARAKTER OLMALIDIR' : 'Her görev en az 150-250 karakter olmalıdır'}
3. Tüm görevler TÜRKÇE olmalı ve kullanıcının cevaplarından spesifik referanslar içermeli
4. ${analysis.experienceLevel.includes('beginner') ? 'Adım adım, öğretici, motive edici' : 'Stratejik, kapsamlı, profesyonel'} görevler oluştur
5. Öncelik dağılımı: ${extendedMode ? '4 KRİTİK, 5 YÜKSEK, 6 ORTA, geri kalan DÜŞÜK' : '3 YÜKSEK, 5 ORTA, geri kalan DÜŞÜK'} öncelik
6. Her görevde şu bölümleri ekle:
   • Amaç ve hedefler
   • Uygulama adımları
   • Beklenen sonuçlar
   • İpuçları ve öneriler
   • İlgili kaynaklar

GÖREV KONULARI (kullanıcı cevaplarına göre özelleştir):
${getTaskTopicsTurkish(analysis, extendedMode)}

${extendedMode ? 'EKSTRA DETAYLAR (GENİŞLETİLMİŞ MOD):\n• Her göreve tahmini süre ekle\n• Bağımlılıkları belirt\n• Başarı kriterlerini tanımla\n• Risk yönetimi stratejileri ekle\n• Kalite kontrol noktaları dahil et' : ''}

DETAYLI GÖREV YAPISI ÖRNEĞİ:
{
  "id": "proje_vizyonu_detay_${Date.now()}",
  "title": "Proje vizyonunu ve misyonunu detaylı şekilde tanımla",
  "description": "Bu görev projenizin temel yönünü belirlemek için kritik öneme sahiptir. Öncelikle, projenizin uzun vadeli hedeflerini tanımlayın. Daha sonra, bu hedeflere ulaşmak için gereken misyon ifadesini oluşturun. Her adımda şu soruları yanıtlayın: 1) Bu proje neyi başarmayı hedefliyor? 2) Kimler faydalanacak? 3) Nasıl ölçülecek? 4) Hangi değerleri temsil ediyor? Kullanıcının '${extractUserAnswer(answers, 0, 30)}' cevabını dikkate alarak özelleştirin.",
  "status": "todo",
  "priority": "critical",
  "tags": ["vizyon", "strateji", "planlama", "hedef"]
}

TÜM GÖREVLER TAMAMEN TÜRKÇE, DETAYLI VE KULLANICI ODAKLI OLMALIDIR.
SADECE JSON DİZİSİ DÖNDÜR.`;
    } else {
        return `SENIOR PROJECT MANAGEMENT CONSULTANT TASK GENERATION:

USER PROFILE ANALYSIS:
• Level: ${analysis.experienceLevel}
• Description: ${analysis.experienceReasoning}
• Complexity Level: ${analysis.answerAnalysis.complexityLevel}
• Total Words: ${analysis.answerAnalysis.wordCount} words
• Technical Terms: ${analysis.answerAnalysis.technicalTerms} terms
• Key Themes: ${analysis.answerAnalysis.keyThemes.slice(0, 8).join(', ') || 'General project management'}
• Professional Keywords: ${Array.from(analysis.answerAnalysis.professionalKeywords).slice(0, 10).join(', ') || 'Not identified'}
• Elaboration Score: ${analysis.answerAnalysis.elaborationScore}/10

USER ANSWERS (FULL TEXT):
${analysis.qaText}

DETAILED INSTRUCTIONS:
1. Create exactly ${MIN_TASKS}-${MAX_TASKS} DETAILED KANBAN tasks
2. ${extendedMode ? 'EACH TASK MUST BE AT LEAST 500-700 CHARACTERS' : 'Each task must be at least 200-300 characters'}
3. All tasks must be in ENGLISH and include specific references from user's answers
4. Create ${analysis.experienceLevel.includes('beginner') ? 'step-by-step, educational, motivational' : 'strategic, comprehensive, professional'} tasks
5. Priority distribution: ${extendedMode ? '4 CRITICAL, 5 HIGH, 6 MEDIUM, remaining LOW' : '3 HIGH, 5 MEDIUM, remaining LOW'} priority
6. Include these sections in each task:
   • Purpose and objectives
   • Implementation steps
   • Expected outcomes
   • Tips and recommendations
   • Relevant resources

TASK TOPICS (customize based on user answers):
${getTaskTopicsEnglish(analysis, extendedMode)}

${extendedMode ? 'EXTRA DETAILS (EXTENDED MODE):\n• Add estimated time to each task\n• Specify dependencies\n• Define success criteria\n• Add risk management strategies\n• Include quality checkpoints' : ''}

DETAILED TASK STRUCTURE EXAMPLE:
{
  "id": "project_vision_detail_${Date.now()}",
  "title": "Define project vision and mission in detail",
  "description": "This task is critical for establishing the fundamental direction of your project. First, define the long-term goals of your project. Then, create a mission statement that outlines how you will achieve these goals. Answer these questions at each step: 1) What does this project aim to achieve? 2) Who will benefit? 3) How will it be measured? 4) What values does it represent? Customize based on the user's answer about '${extractUserAnswer(answers, 0, 30)}'.",
  "status": "todo",
  "priority": "critical",
  "tags": ["vision", "strategy", "planning", "goal"]
}

ALL TASKS MUST BE IN ENGLISH, DETAILED, AND USER-CENTRIC.
RETURN ONLY JSON ARRAY.`;
    }
}

// Helper to extract user answer snippets
function extractUserAnswer(answers, index, length = 30) {
    const answerKeys = Object.keys(answers);
    if (index < answerKeys.length) {
        const answer = answers[answerKeys[index]];
        if (answer && answer.length > length) {
            return answer.substring(0, length) + '...';
        }
        return answer || 'project details';
    }
    return 'project details';
}

// Get comprehensive task topics in Turkish
function getTaskTopicsTurkish(analysis, extendedMode = false) {
    const baseTopics = [
        "Stratejik proje vizyonu ve misyon tanımı",
        "Kapsamlı paydaş analizi ve yönetim planı",
        "Detaylı risk değerlendirme ve yönetim stratejileri",
        "Zaman yönetimi ve detaylı proje takvimi",
        "Bütçe planlaması ve finansal yönetim",
        "İletişim stratejisi ve raporlama sistemi",
        "Kalite yönetimi ve sürekli iyileştirme",
        "Kaynak yönetimi ve optimizasyon",
        "Değişim yönetimi ve uyum planı",
        "Performans ölçümü ve KPI takibi",
        "Belge yönetimi ve bilgi paylaşımı",
        "Sürdürülebilirlik ve devamlılık planlaması"
    ];
    
    if (extendedMode) {
        baseTopics.push(
            "Detaylı iş kırılım yapısı (WBS)",
            "Gantt çizelgesi ve kritik yol analizi",
            "Risk matrisi ve önceliklendirme",
            "Kalite kontrol noktaları ve denetimler",
            "Tedarik zinciri ve satınalma yönetimi",
            "İnsan kaynakları planlaması ve ekip geliştirme",
            "Teknoloji altyapısı ve dijital dönüşüm",
            "Veri analizi ve karar destek sistemleri",
            "Kriz yönetimi ve acil durum planları",
            "Proje kapanışı ve ders çıkarılanlar"
        );
    }
    
    // Add user-specific topics
    const userTopics = analysis.answerAnalysis.keyThemes.map(theme => {
        const themeMap = {
            'planning': 'Detaylı planlama ve programlama',
            'budget': 'Bütçe optimizasyonu ve maliyet kontrolü',
            'team': 'Ekip yönetimi ve liderlik geliştirme',
            'technology': 'Teknoloji altyapısı ve sistem entegrasyonu',
            'marketing': 'Pazarlama stratejisi ve müşteri ilişkileri',
            'quality': 'Kalite kontrol süreçleri ve standartlar'
        };
        return themeMap[theme] || `Özel ${theme} yönetimi ve optimizasyonu`;
    });
    
    return [...new Set([...userTopics, ...baseTopics])].slice(0, extendedMode ? 20 : 12).join('\n• ');
}

// Get comprehensive task topics in English
function getTaskTopicsEnglish(analysis, extendedMode = false) {
    const baseTopics = [
        "Strategic project vision and mission definition",
        "Comprehensive stakeholder analysis and management plan",
        "Detailed risk assessment and management strategies",
        "Time management and detailed project schedule",
        "Budget planning and financial management",
        "Communication strategy and reporting system",
        "Quality management and continuous improvement",
        "Resource management and optimization",
        "Change management and adaptation plan",
        "Performance measurement and KPI tracking",
        "Document management and knowledge sharing",
        "Sustainability and continuity planning"
    ];
    
    if (extendedMode) {
        baseTopics.push(
            "Detailed work breakdown structure (WBS)",
            "Gantt chart and critical path analysis",
            "Risk matrix and prioritization",
            "Quality control checkpoints and audits",
            "Supply chain and procurement management",
            "Human resources planning and team development",
            "Technology infrastructure and digital transformation",
            "Data analysis and decision support systems",
            "Crisis management and emergency plans",
            "Project closure and lessons learned"
        );
    }
    
    // Add user-specific topics
    const userTopics = analysis.answerAnalysis.keyThemes.map(theme => {
        const themeMap = {
            'planning': 'Detailed planning and scheduling',
            'budget': 'Budget optimization and cost control',
            'team': 'Team management and leadership development',
            'technology': 'Technology infrastructure and system integration',
            'marketing': 'Marketing strategy and customer relations',
            'quality': 'Quality control processes and standards'
        };
        return themeMap[theme] || `Specific ${theme} management and optimization`;
    });
    
    return [...new Set([...userTopics, ...baseTopics])].slice(0, extendedMode ? 20 : 12).join('\n• ');
}

// Enhanced task parsing for extended responses
function parseAITasks(text, extendedMode = false) {
    try {
        const cleanText = text.trim();
        
        // Try multiple parsing strategies
        let jsonString = '';
        
        // Strategy 1: Find JSON array
        const jsonStart = cleanText.indexOf('[');
        const jsonEnd = cleanText.lastIndexOf(']') + 1;
        
        if (jsonStart !== -1 && jsonEnd !== 0) {
            jsonString = cleanText.substring(jsonStart, jsonEnd);
        } else {
            // Strategy 2: Look for JSON-like structure
            const jsonMatch = cleanText.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (jsonMatch) {
                jsonString = jsonMatch[0];
            } else {
                // Strategy 3: Extract just the tasks
                console.log("No JSON array found, trying to extract tasks manually");
                return extractTasksManually(cleanText, extendedMode);
            }
        }
        
        // Parse and validate JSON
        const tasks = JSON.parse(jsonString);
        
        if (!Array.isArray(tasks)) {
            console.log("Response is not an array, trying manual extraction");
            return extractTasksManually(cleanText, extendedMode);
        }
        
        console.log(`✅ Successfully parsed ${tasks.length} tasks from AI response`);
        
        // Validate task descriptions are long enough
        const validatedTasks = tasks.map(task => {
            if (extendedMode && task.description && task.description.length < 300) {
                task.description = enhanceDescription(task.description, task.title);
            } else if (!extendedMode && task.description && task.description.length < 150) {
                task.description = enhanceDescription(task.description, task.title);
            }
            return task;
        });
        
        return validatedTasks;
        
    } catch (e) {
        console.error("Parsing AI tasks failed:", e.message);
        console.log("Response snippet (first 500 chars):", text.substring(0, 500));
        return extractTasksManually(text, extendedMode);
    }
}

// Manual task extraction fallback
function extractTasksManually(text, extendedMode = false) {
    console.log("Attempting manual task extraction");
    const tasks = [];
    const lines = text.split('\n');
    let currentTask = null;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Look for task indicators
        if (trimmedLine.match(/^\d+[\.\)]/) || 
            trimmedLine.toLowerCase().includes('task') ||
            trimmedLine.toLowerCase().includes('görev') ||
            (trimmedLine.includes('"title"') && trimmedLine.includes(':')) ||
            (trimmedLine.includes('"description"') && trimmedLine.includes(':'))) {
            
            if (currentTask) {
                tasks.push(currentTask);
            }
            
            // Try to extract task from JSON-like line
            if (trimmedLine.includes('"title"')) {
                const titleMatch = trimmedLine.match(/"title"\s*:\s*"([^"]*)"/);
                const descMatch = trimmedLine.match(/"description"\s*:\s*"([^"]*)"/);
                
                if (titleMatch) {
                    currentTask = {
                        id: `manual_${Date.now()}_${tasks.length}`,
                        title: titleMatch[1],
                        description: descMatch ? descMatch[1] : 'Task description',
                        status: 'todo',
                        priority: 'medium',
                        tags: ['manual', 'extracted']
                    };
                }
            } else {
                // Extract from regular text
                currentTask = {
                    id: `manual_${Date.now()}_${tasks.length}`,
                    title: trimmedLine.replace(/^\d+[\.\)]\s*/, '').substring(0, 100),
                    description: 'Task extracted from AI response',
                    status: 'todo',
                    priority: 'medium',
                    tags: ['manual', 'extracted']
                };
            }
        } else if (currentTask && trimmedLine && !trimmedLine.includes('{') && !trimmedLine.includes('}')) {
            // Add to description
            currentTask.description += ' ' + trimmedLine;
        }
    }
    
    if (currentTask) {
        tasks.push(currentTask);
    }
    
    console.log(`Manual extraction yielded ${tasks.length} tasks`);
    return tasks;
}

// Enhance description with more details
function enhanceDescription(description, title) {
    const enhancements = [
        'This task requires careful planning and execution.',
        'Consider breaking this down into smaller, manageable steps.',
        'Regular review and adjustment may be necessary.',
        'Document your progress and challenges along the way.',
        'Seek feedback from stakeholders when appropriate.',
        'Align this task with your overall project goals.',
        'Measure progress using specific, quantifiable metrics.',
        'Prepare contingency plans for potential obstacles.'
    ];
    
    const randomEnhancement = enhancements[Math.floor(Math.random() * enhancements.length)];
    return `${description} ${randomEnhancement}`;
}

// Enhanced task validation
function validateAndCompleteTasks(tasks, userAnswers, language, analysis, extendedMode = false) {
    const isTurkish = language === 'tr';
    
    if (!Array.isArray(tasks) || tasks.length === 0) {
        console.log("No valid tasks found, generating comprehensive fallback");
        return generateComprehensiveFallbackTasks(userAnswers, language, analysis, extendedMode);
    }
    
    return tasks.map((task, index) => {
        // Ensure descriptions are comprehensive
        let description = task.description || '';
        const minLength = extendedMode ? 300 : 150;
        
        if (description.length < minLength) {
            description = enhanceTaskDescription(description, task, userAnswers, language, analysis, extendedMode);
        }
        
        // Ensure title is appropriate
        let title = task.title || '';
        if (title.length < 10) {
            title = generateTaskTitle(index, language, analysis, extendedMode);
        }
        
        // Build comprehensive task object
        const validatedTask = {
            id: task.id || `${isTurkish ? 'detayli_görev' : 'detailed_task'}_${Date.now()}_${index}`,
            title: title,
            description: description,
            status: ['todo', 'inprogress', 'done', 'review'].includes(task.status?.toLowerCase()) 
                ? task.status.toLowerCase() 
                : 'todo',
            priority: ['critical', 'high', 'medium', 'low'].includes(task.priority?.toLowerCase()) 
                ? task.priority.toLowerCase() 
                : determinePriority(index, tasks.length, extendedMode),
            tags: Array.isArray(task.tags) && task.tags.length > 0 
                ? task.tags.slice(0, extendedMode ? 5 : 3)
                : [isTurkish ? 'proje' : 'project', isTurkish ? 'yönetim' : 'management'],
            estimatedTime: task.estimatedTime || estimateTimeForTask(index, analysis, extendedMode),
            dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
            successCriteria: Array.isArray(task.successCriteria) ? task.successCriteria : getDefaultSuccessCriteria(language)
        };
        
        // Add personalized elements
        if (Object.keys(userAnswers).length > 0) {
            const relevantAnswer = findRelevantAnswer(userAnswers, index);
            if (relevantAnswer) {
                validatedTask.description += `\n\n${isTurkish ? 'NOT: ' : 'NOTE: '}${isTurkish ? 
                    'Bu görev "' + relevantAnswer.substring(0, 80) + '..." cevabınıza dayanmaktadır.' :
                    'This task is based on your answer about "' + relevantAnswer.substring(0, 80) + '..."'}`;
            }
        }
        
        return validatedTask;
    });
}

// Enhance task description
function enhanceTaskDescription(baseDesc, task, userAnswers, language, analysis, extendedMode) {
    const isTurkish = language === 'tr';
    
    let enhanced = baseDesc;
    
    if (extendedMode) {
        const sections = isTurkish ? [
            '\n\n**Detaylı Uygulama Adımları:**',
            '\n**Beklenen Sonuçlar:**',
            '\n**Riskler ve Azaltma Stratejileri:**',
            '\n**İpuçları ve Öneriler:**',
            '\n**İlgili Kaynaklar:**'
        ] : [
            '\n\n**Detailed Implementation Steps:**',
            '\n**Expected Outcomes:**',
            '\n**Risks and Mitigation Strategies:**',
            '\n**Tips and Recommendations:**',
            '\n**Relevant Resources:**'
        ];
        
        sections.forEach(section => {
            enhanced += section + ' ' + (isTurkish ? 
                'Bu bölümde görevin spesifik detayları yer alacak.' :
                'This section will contain specific details about the task.');
        });
    } else {
        enhanced += isTurkish ? 
            '\n\n**Önemli Not:** Bu görev projenizin başarısı için kritik öneme sahiptir. Her adımı dikkatlice planlayın ve uygulayın.' :
            '\n\n**Important Note:** This task is critical for your project success. Plan and implement each step carefully.';
    }
    
    return enhanced;
}

// Generate comprehensive fallback tasks
function generateComprehensiveFallbackTasks(answers, language, analysis, extendedMode = false) {
    const isTurkish = language === 'tr';
    const tasks = [];
    const baseCount = extendedMode ? 20 : 15;
    
    for (let i = 0; i < baseCount; i++) {
        const taskNumber = i + 1;
        
        let taskTemplate;
        if (isTurkish) {
            taskTemplate = extendedMode ? getExtendedTurkishTaskTemplate(i, analysis) : 
                                           getStandardTurkishTaskTemplate(i, analysis);
        } else {
            taskTemplate = extendedMode ? getExtendedEnglishTaskTemplate(i, analysis) : 
                                           getStandardEnglishTaskTemplate(i, analysis);
        }
        
        const task = {
            id: `${isTurkish ? 'kapsamlı' : 'comprehensive'}_${Date.now()}_${i}`,
            ...taskTemplate,
            status: 'todo',
            estimatedTime: estimateTimeForTask(i, analysis, extendedMode),
            successCriteria: getDefaultSuccessCriteria(language)
        };
        
        tasks.push(task);
    }
    
    return tasks;
}

// Get standard Turkish task templates
function getStandardTurkishTaskTemplate(index, analysis) {
    const templates = [
        {
            title: 'Proje vizyon ve misyon ifadelerini oluştur',
            description: 'Projenizin uzun vadeli hedeflerini ve temel amacını net bir şekilde tanımlayın. Bu ifadeler tüm proje ekibinin aynı hedefe odaklanmasını sağlayacaktır.',
            priority: 'high',
            tags: ['vizyon', 'misyon', 'strateji']
        },
        {
            title: 'Paydaş analizi ve haritalama yap',
            description: 'Tüm paydaşları belirleyin, ilgi ve etki düzeylerini analiz edin. Her paydaş grubu için uygun iletişim stratejileri geliştirin.',
            priority: 'high',
            tags: ['paydaş', 'analiz', 'iletişim']
        },
        {
            title: 'Detaylı risk değerlendirmesi gerçekleştir',
            description: 'Potansiyel riskleri belirleyin, olasılık ve etki analizi yapın. Her risk için azaltma stratejileri ve acil durum planları hazırlayın.',
            priority: 'high',
            tags: ['risk', 'değerlendirme', 'yönetim']
        }
    ];
    
    return templates[index % templates.length] || templates[0];
}

// Get extended Turkish task templates
function getExtendedTurkishTaskTemplate(index, analysis) {
    const templates = [
        {
            title: 'Kapsamlı proje vizyon ve stratejik hedefler belgesi hazırla',
            description: 'Projenizin uzun vadeli vizyonunu, stratejik hedeflerini ve temel değerlerini detaylı bir şekilde belgeleyin. Bu belge şunları içermelidir: 1) Projenin nihai amacı ve beklenen etkisi, 2) Ölçülebilir stratejik hedefler, 3) Temel değerler ve ilkeler, 4) Başarı kriterleri ve ölçüm metodolojisi, 5) Uzun vadeli sürdürülebilirlik planı.',
            priority: 'critical',
            tags: ['vizyon', 'strateji', 'hedef', 'planlama', 'belgeleme']
        },
        {
            title: 'Detaylı paydaş analizi ve ilişki yönetimi haritası oluştur',
            description: 'Tüm iç ve dış paydaşları kapsamlı bir şekilde belirleyin ve analiz edin. Her paydaş için: 1) İlgi düzeyi ve etki gücü analizi, 2) Beklenti yönetimi planı, 3) Özelleştirilmiş iletişim stratejisi, 4) Katılım ve geri bildirim mekanizmaları, 5) İlişki geliştirme planı hazırlayın. Power/Interest matrisi kullanarak görsel bir harita oluşturun.',
            priority: 'critical',
            tags: ['paydaş', 'analiz', 'haritalama', 'iletişim', 'ilişki']
        }
    ];
    
    return templates[index % templates.length] || templates[0];
}

// Get standard English task templates
function getStandardEnglishTaskTemplate(index, analysis) {
    const templates = [
        {
            title: 'Create project vision and mission statements',
            description: 'Clearly define the long-term goals and core purpose of your project. These statements will ensure all team members focus on the same objectives.',
            priority: 'high',
            tags: ['vision', 'mission', 'strategy']
        },
        {
            title: 'Conduct stakeholder analysis and mapping',
            description: 'Identify all stakeholders, analyze their interest and influence levels. Develop appropriate communication strategies for each stakeholder group.',
            priority: 'high',
            tags: ['stakeholder', 'analysis', 'communication']
        },
        {
            title: 'Perform detailed risk assessment',
            description: 'Identify potential risks, conduct probability and impact analysis. Prepare mitigation strategies and contingency plans for each identified risk.',
            priority: 'high',
            tags: ['risk', 'assessment', 'management']
        }
    ];
    
    return templates[index % templates.length] || templates[0];
}

// Get extended English task templates
function getExtendedEnglishTaskTemplate(index, analysis) {
    const templates = [
        {
            title: 'Prepare comprehensive project vision and strategic objectives document',
            description: 'Document your project\'s long-term vision, strategic goals, and core values in detail. This document should include: 1) Project\'s ultimate purpose and expected impact, 2) Measurable strategic objectives, 3) Core values and principles, 4) Success criteria and measurement methodology, 5) Long-term sustainability plan.',
            priority: 'critical',
            tags: ['vision', 'strategy', 'goals', 'planning', 'documentation']
        },
        {
            title: 'Create detailed stakeholder analysis and relationship management map',
            description: 'Comprehensively identify and analyze all internal and external stakeholders. For each stakeholder: 1) Analyze interest level and influence power, 2) Develop expectation management plan, 3) Create customized communication strategy, 4) Establish participation and feedback mechanisms, 5) Prepare relationship development plan. Create a visual map using Power/Interest matrix.',
            priority: 'critical',
            tags: ['stakeholder', 'analysis', 'mapping', 'communication', 'relationship']
        }
    ];
    
    return templates[index % templates.length] || templates[0];
}

// Generate comprehensive AI report with unlimited tokens
async function generateAIReport(answers, questions, tasks, language, extendedMode = false) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const highPriorityTasks = tasks.filter(t => t.priority === 'high' || t.priority === 'critical').length;
    const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium').length;
    
    const answeredQuestions = Object.values(answers).filter(a => 
        a && a !== '[Skipped]' && a !== '[Not Applicable]'
    ).length;
    
    // Prepare comprehensive report prompt
    const reportPrompt = isTurkish ? `
KAPSAMLI PROJE ANALİZ VE DEĞERLENDİRME RAPORU OLUŞTUR:

PROJE VERİLERİ VE ANALİZ:
• Toplam Görev Sayısı: ${totalTasks} görev
• Tamamlanan Görevler: ${completedTasks} görev (%${completionRate} tamamlanma oranı)
• Öncelik Dağılımı: ${highPriorityTasks} yüksek/kritik öncelikli, ${mediumPriorityTasks} orta öncelikli
• Kullanıcı Katılımı: ${answeredQuestions} detaylı yanıtlanmış soru
• Proje Karmaşıklık Seviyesi: ${extendedMode ? 'İleri düzey' : 'Standart'} analiz

ANA GÖREV ÖZETİ:
${tasks.slice(0, 8).map((t, i) => `${i+1}. **${t.title}** (${t.priority} öncelik)\n   ${t.description.substring(0, 150)}${t.description.length > 150 ? '...' : ''}`).join('\n\n')}

KULLANICI CEVAPLARINDAN ÖNEMLİ ÇIKARIMLAR:
${Object.entries(answers)
    .filter(([_, a]) => a && a !== '[Skipped]' && a !== '[Not Applicable]')
    .slice(0, 5)
    .map(([i, a]) => `**Soru ${parseInt(i)+1}:** ${a.substring(0, 200)}${a.length > 200 ? '...' : ''}`)
    .join('\n\n')}

KAPSAMLI RAPOR YAPISI (${extendedMode ? 'GENİŞLETİLMİŞ' : 'STANDART'}):
1. **YÖNETİCİ ÖZETİ** - Projenin genel durumu ve kritik bulgular
2. **DURUM ANALİZİ** - Mevcut ilerleme, güçlü yönler ve zorluklar
3. **DETAYLI RİSK DEĞERLENDİRMESİ** - Risk matrisi ve azaltma planları
4. **STRATEJİK ÖNERİLER** - Uzun vadeli planlama ve optimizasyon
5. **EYLEM PLANI** - Acil, kısa ve orta vadeli eylem adımları
6. **KAYNAK OPTİMİZASYONU** - Mevcut kaynakların etkin kullanımı
7. **İZLEME VE DEĞERLENDİRME** - Performans metrikleri ve takip sistemi
8. **SONUÇ VE TAVSİYELER** - Genel değerlendirme ve profesyonel tavsiyeler

${extendedMode ? 'EK DETAYLAR (GENİŞLETİLMİŞ MOD):\n• SWOT analizi ekleyin\n• PESTLE analizi dahil edin\n• Detaylı finansal projeksiyonlar ekleyin\n• Organizasyon yapısı analizi yapın\n• Teknoloji altyapı değerlendirmesi ekleyin\n• Sürdürülebilirlik analizi yapın' : ''}

RAPORU OLUŞTUR:
• Markdown formatında hazırlayın
• Her bölüm için detaylı analiz yapın
• Tablo ve listeler kullanın
• Ölçülebilir metrikler ve KPI'lar ekleyin
• Pratik öneriler ve uygulanabilir çözümler sunun
• En az ${extendedMode ? '2000' : '1000'} kelime uzunluğunda olmalı

SADECE RAPOR İÇERİĞİNİ DÖNDÜRÜN, BAŞKA AÇIKLAMA EKLEMEYİN.` : `
CREATE COMPREHENSIVE PROJECT ANALYSIS AND EVALUATION REPORT:

PROJECT DATA AND ANALYSIS:
• Total Tasks: ${totalTasks} tasks
• Completed Tasks: ${completedTasks} tasks (${completionRate}% completion rate)
• Priority Distribution: ${highPriorityTasks} high/critical priority, ${mediumPriorityTasks} medium priority
• User Engagement: ${answeredQuestions} detailed answered questions
• Project Complexity Level: ${extendedMode ? 'Advanced' : 'Standard'} analysis

KEY TASK SUMMARY:
${tasks.slice(0, 8).map((t, i) => `${i+1}. **${t.title}** (${t.priority} priority)\n   ${t.description.substring(0, 150)}${t.description.length > 150 ? '...' : ''}`).join('\n\n')}

KEY INSIGHTS FROM USER ANSWERS:
${Object.entries(answers)
    .filter(([_, a]) => a && a !== '[Skipped]' && a !== '[Not Applicable]')
    .slice(0, 5)
    .map(([i, a]) => `**Question ${parseInt(i)+1}:** ${a.substring(0, 200)}${a.length > 200 ? '...' : ''}`)
    .join('\n\n')}

COMPREHENSIVE REPORT STRUCTURE (${extendedMode ? 'EXTENDED' : 'STANDARD'}):
1. **EXECUTIVE SUMMARY** - Overall project status and critical findings
2. **STATUS ANALYSIS** - Current progress, strengths and challenges
3. **DETAILED RISK ASSESSMENT** - Risk matrix and mitigation plans
4. **STRATEGIC RECOMMENDATIONS** - Long-term planning and optimization
5. **ACTION PLAN** - Immediate, short-term and mid-term action steps
6. **RESOURCE OPTIMIZATION** - Effective utilization of available resources
7. **MONITORING & EVALUATION** - Performance metrics and tracking system
8. **CONCLUSION & ADVICE** - Overall assessment and professional recommendations

${extendedMode ? 'ADDITIONAL DETAILS (EXTENDED MODE):\n• Include SWOT analysis\n• Add PESTLE analysis\n• Include detailed financial projections\n• Conduct organizational structure analysis\n• Add technology infrastructure assessment\n• Perform sustainability analysis' : ''}

CREATE THE REPORT:
• Prepare in markdown format
• Provide detailed analysis for each section
• Use tables and lists
• Add measurable metrics and KPIs
• Offer practical suggestions and actionable solutions
• Minimum ${extendedMode ? '2000' : '1000'} words in length

RETURN ONLY THE REPORT CONTENT, NO ADDITIONAL EXPLANATIONS.`;
    
    try {
        const reportResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: isTurkish ? 
                        `SEN ÜST DÜZEY BİR PROJE YÖNETİMİ DANIŞMANISIN. KAPSAMLI, PROFESYONEL VE DETAYLI BİR PROJE ANALİZ RAPORU OLUŞTUR.
                        
                        RAPOR ÖZELLİKLERİ:
                        1. EN AZ ${extendedMode ? '2500' : '1200'} KELİME UZUNLUĞUNDA OLMALI
                        2. MARKDOWN FORMATINDA HAZIRLANMALI
                        3. HER BÖLÜM İÇİN DETAYLI ANALİZ İÇERMELİ
                        4. TABLOLAR, LİSTELER VE BAŞLIKLAR KULLANILMALI
                        5. ÖLÇÜLEBİLİR METRİKLER VE KPI'LAR EKLENMELİ
                        6. PRATİK ÖNERİLER VE UYGULANABİLİR ÇÖZÜMLER SUNULMALI
                        7. PROFESYONEL DİL VE TERMİNOLOJİ KULLANILMALI
                        
                        SADECE RAPOR İÇERİĞİNİ DÖNDÜR, BAŞKA AÇIKLAMA YAPMA.` :
                        `YOU ARE A SENIOR PROJECT MANAGEMENT CONSULTANT. CREATE A COMPREHENSIVE, PROFESSIONAL, AND DETAILED PROJECT ANALYSIS REPORT.
                        
                        REPORT FEATURES:
                        1. MINIMUM ${extendedMode ? '2500' : '1200'} WORDS IN LENGTH
                        2. PREPARED IN MARKDOWN FORMAT
                        3. CONTAIN DETAILED ANALYSIS FOR EACH SECTION
                        4. USE TABLES, LISTS, AND HEADINGS
                        5. ADD MEASURABLE METRICS AND KPIS
                        6. PROVIDE PRACTICAL RECOMMENDATIONS AND ACTIONABLE SOLUTIONS
                        7. USE PROFESSIONAL LANGUAGE AND TERMINOLOGY
                        
                        RETURN ONLY THE REPORT CONTENT, NO ADDITIONAL EXPLANATIONS.`
                },
                { role: "user", content: reportPrompt }
            ],
            temperature: 0.7,
            max_tokens: extendedMode ? 32000 : 16000, // Maximum tokens for comprehensive report
            top_p: 0.9,
            frequency_penalty: 0.2,
            presence_penalty: 0.1
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            timeout: 180000, // 3 minute timeout for comprehensive reports
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        return reportResponse.data.choices[0].message.content;
    } catch (error) {
        console.error('Comprehensive AI Report generation failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

// Generate comprehensive smart report fallback
function generateComprehensiveSmartReport(tasks, answers, language, analysis, extendedMode = false) {
    const isTurkish = language === 'tr';
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const highPriorityTasks = tasks.filter(t => t.priority === 'high' || t.priority === 'critical').length;
    const answeredQuestions = Object.values(answers).filter(a => 
        a && a !== '[Skipped]' && a !== '[Not Applicable]'
    ).length;
    
    const currentDate = new Date();
    const formattedDate = isTurkish ? 
        currentDate.toLocaleDateString('tr-TR', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            weekday: 'long'
        }) :
        currentDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            weekday: 'long'
        });
    
    if (isTurkish) {
        let report = `# KAPSAMLI PROJE ANALİZ RAPORU\n`;
        report += `*Rapor Tarihi: ${formattedDate}*\n`;
        report += `*Rapor Kimliği: PRJ-${Date.now().toString().slice(-8)}*\n\n`;
        
        report += `## 1. YÖNETİCİ ÖZETİ\n\n`;
        report += `Bu rapor, ${totalTasks} görev ve ${answeredQuestions} kullanıcı cevabı üzerine yapılan kapsamlı analizi içermektedir.\n\n`;
        report += `**Temel Bulgular:**\n`;
        report += `- Proje tamamlanma oranı: **%${completionRate}**\n`;
        report += `- ${highPriorityTasks} adet yüksek öncelikli görev belirlenmiştir\n`;
        report += `- Kullanıcı deneyim seviyesi: **${analysis.experienceLevel}**\n`;
        report += `- Analiz karmaşıklık seviyesi: **${extendedMode ? 'İleri Düzey' : 'Standart'}**\n\n`;
        
        report += `## 2. DURUM ANALİZİ\n\n`;
        report += `### 2.1 Mevcut İlerleme\n`;
        report += `- **Tamamlanan Görevler:** ${completedTasks}/${totalTasks}\n`;
        report += `- **Aktif Görevler:** ${tasks.filter(t => t.status === 'inprogress').length}\n`;
        report += `- **Bekleyen Görevler:** ${tasks.filter(t => t.status === 'todo').length}\n\n`;
        
        report += `### 2.2 Güçlü Yönler\n`;
        report += `1. **Kullanıcı Katılımı:** ${answeredQuestions} soru detaylı cevaplanmış\n`;
        report += `2. **Görev Yapısı:** ${totalTasks} adet kapsamlı görev tanımlanmış\n`;
        report += `3. **Planlama:** Önceliklendirme ve zamanlama belirlenmiş\n\n`;
        
        report += `### 2.3 Gelişim Alanları\n`;
        report += `1. Tamamlanma oranının artırılması\n`;
        report += `2. Risk yönetimi süreçlerinin güçlendirilmesi\n`;
        report += `3. Kaynak optimizasyonunun iyileştirilmesi\n\n`;
        
        report += `## 3. RİSK DEĞERLENDİRMESİ\n\n`;
        report += `### 3.1 Risk Matrisi\n\n`;
        report += `| Risk Tipi | Olasılık | Etki | Azaltma Stratejisi |\n`;
        report += `|-----------|----------|------|---------------------|\n`;
        report += `| Kapsam Kayması | Orta | Yüksek | Düzenli paydaş görüşmeleri ve değişiklik kontrol süreçleri |\n`;
        report += `| Zaman Sıkışması | Yüksek | Orta | Kritik yol analizi ve tampon süreler |\n`;
        report += `| Bütçe Aşımı | Orta | Yüksek | Maliyet takibi ve düzenli bütçe revizyonları |\n`;
        report += `| Kaynak Yetersizliği | Düşük | Yüksek | Alternatif kaynak planlaması ve yetenek geliştirme |\n\n`;
        
        if (extendedMode) {
            report += `## 4. STRATEJİK ANALİZ\n\n`;
            report += `### 4.1 SWOT Analizi\n\n`;
            report += `**Güçlü Yönler (Strengths):**\n`;
            report += `- Detaylı görev yapılandırması\n`;
            report += `- Kullanıcı odaklı yaklaşım\n`;
            report += `- Ölçeklenebilir çerçeve\n\n`;
            
            report += `**Zayıf Yönler (Weaknesses):**\n`;
            report += `- Başlangıç aşamasında deneyim eksikliği\n`;
            report += `- Sınırlı kaynak bilgisi\n`;
            report += `- Uzun vadeli planlama gereksinimi\n\n`;
            
            report += `**Fırsatlar (Opportunities):**\n`;
            report += `- Dijital dönüşüm trendleri\n`;
            report += `- Uzaktan çalışma modelleri\n`;
            report += `- Otomasyon araçları entegrasyonu\n\n`;
            
            report += `**Tehditler (Threats):**\n`;
            report += `- Pazar değişkenliği\n`;
            report += `- Teknoloji hızlı değişimi\n`;
            report += `- Rekabet baskısı\n\n`;
        }
        
        report += `## ${extendedMode ? '5' : '4'}. EYLEM PLANI\n\n`;
        report += `### ${extendedMode ? '5.1' : '4.1'} Acil Eylemler (1-3 Gün)\n`;
        report += `1. **${highPriorityTasks} yüksek öncelikli görevi tamamla** - Kritik öneme sahip görevler\n`;
        report += `2. **Paydaş iletişimini başlat** - Temel paydaşlarla iletişim kur\n`;
        report += `3. **Risk kayıt defteri oluştur** - Riskleri belgelemeye başla\n\n`;
        
        report += `### ${extendedMode ? '5.2' : '4.2'} Kısa Vadeli Eylemler (1 Hafta)\n`;
        report += `1. **İletişim planını tamamla** - Düzenli iletişim mekanizmalarını kur\n`;
        report += `2. **İlerleme takip sistemini kur** - Haftalık kontrol noktaları belirle\n`;
        report += `3. **Kaynak envanteri çıkar** - Mevcut kaynakları belgele\n\n`;
        
        report += `### ${extendedMode ? '5.3' : '4.3'} Orta Vadeli Eylemler (2-4 Hafta)\n`;
        report += `1. **Detaylı proje takvimi hazırla** - Gantt çizelgesi oluştur\n`;
        report += `2. **Kalite kontrol sistemini kur** - Kalite standartlarını tanımla\n`;
        report += `3. **Performans metriklerini belirle** - Ölçülebilir KPI'lar tanımla\n\n`;
        
        report += `## ${extendedMode ? '6' : '5'}. ÖNERİLER VE TAVSİYELER\n\n`;
        report += `### ${extendedMode ? '6.1' : '5.1'} Proje Yönetimi Önerileri\n`;
        report += `1. **Düzenli İletişim:** Haftalık durum toplantıları düzenleyin\n`;
        report += `2. **Esneklik:** Değişen koşullara uyum sağlayacak esnek planlar oluşturun\n`;
        report += `3. **Dokümantasyon:** Tüm karar ve değişiklikleri düzenli olarak belgeleyin\n`;
        report += `4. **Ekip Katılımı:** Tüm ekip üyelerini karar süreçlerine dahil edin\n\n`;
        
        report += `### ${extendedMode ? '6.2' : '5.2'} Teknik Öneriler\n`;
        report += `1. **Araç Entegrasyonu:** Proje yönetimi araçlarını etkin kullanın\n`;
        report += `2. **Otomasyon:** Tekrarlayan görevler için otomasyon sistemleri kurun\n`;
        report += `3. **Veri Analizi:** Karar destek için veri analizi araçları kullanın\n\n`;
        
        report += `## ${extendedMode ? '7' : '6'}. İZLEME VE DEĞERLENDİRME\n\n`;
        report += `### ${extendedMode ? '7.1' : '6.1'} Performans Metrikleri\n`;
        report += `- **Zaman Çizelgesi Uyumu:** %95+\n`;
        report += `- **Bütçe Performansı:** ±%10 tolerans\n`;
        report += `- **Kalite Standartları:** %100 uyum\n`;
        report += `- **Paydaş Memnuniyeti:** %90+\n\n`;
        
        report += `### ${extendedMode ? '7.2' : '6.2'} Takip Mekanizmaları\n`;
        report += `1. **Haftalık İlerleme Raporları:** Her Cuma\n`;
        report += `2. **Aylık Performans Değerlendirmeleri:** Ay sonu\n`;
        report += `3. **Çeyreklik Strateji Gözden Geçirmeleri:** Her çeyrek\n`;
        report += `4. **Risk Değerlendirme Toplantıları:** İki haftada bir\n\n`;
        
        report += `## ${extendedMode ? '8' : '7'}. SONUÇ\n\n`;
        report += `Bu analiz, projenizin mevcut durumunu kapsamlı bir şekilde değerlendirmektedir. ${extendedMode ? 'Detaylı stratejik analizler ve' : ''} önerilen eylem planları ile proje başarı şansınızı önemli ölçüde artırabilirsiniz. Düzenli izleme ve esnek yaklaşım, değişen koşullara uyum sağlamanıza yardımcı olacaktır.\n\n`;
        
        report += `*Bu rapor Intuiva Proje Yöneticisi tarafından ${extendedMode ? 'genişletilmiş modda' : 'standart modda'} otomatik olarak oluşturulmuştur.*\n`;
        report += `*Rapor Uzunluğu: Yaklaşık ${Math.round(report.length / 50)} kelime*\n`;
        report += `*Son Güncelleme: ${new Date().toISOString()}*`;
        
        return report;
    } else {
        // English version (similar structure)
        // [English content would follow similar structure]
        return generateSmartReport(tasks, answers, language, analysis);
    }
}

// Helper functions
function determinePriority(index, totalTasks, extendedMode = false) {
    if (extendedMode) {
        if (index < 4) return 'critical';
        if (index < 9) return 'high';
        if (index < 15) return 'medium';
        return 'low';
    } else {
        if (index < 3) return 'high';
        if (index < 8) return 'medium';
        return 'low';
    }
}

function estimateTimeForTask(index, analysis, extendedMode = false) {
    const baseTime = extendedMode ? 8 : 4; // hours
    const complexityMultiplier = analysis.answerAnalysis.complexityLevel === 'advanced' ? 1.5 : 1;
    const experienceMultiplier = analysis.experienceLevel.includes('beginner') ? 2 : 1;
    
    const estimatedHours = Math.round(baseTime * complexityMultiplier * experienceMultiplier);
    return `${estimatedHours} hours`;
}

function getDefaultSuccessCriteria(language) {
    const isTurkish = language === 'tr';
    return isTurkish ? 
        ['Görev tamamlandı', 'Kalite standartları sağlandı', 'Paydaş onayı alındı'] :
        ['Task completed', 'Quality standards met', 'Stakeholder approval received'];
}

function findRelevantAnswer(answers, taskIndex) {
    const answerKeys = Object.keys(answers);
    if (answerKeys.length === 0) return null;
    
    const answerIndex = taskIndex % answerKeys.length;
    const answerKey = answerKeys[answerIndex];
    const answer = answers[answerKey];
    
    if (answer && answer !== '[Skipped]' && answer !== '[Not Applicable]') {
        return answer;
    }
    
    return null;
}

function generateTaskTitle(index, language, analysis, extendedMode = false) {
    const isTurkish = language === 'tr';
    const titles = isTurkish ? [
        'Proje vizyonu ve stratejik hedeflerin tanımlanması',
        'Paydaş analizi ve yönetim planı oluşturma',
        'Risk değerlendirmesi ve yönetim stratejileri',
        'Zaman yönetimi ve proje takvimi hazırlama',
        'Bütçe planlaması ve finansal kontroller',
        'İletişim stratejisi ve raporlama sistemi kurma',
        'Kalite yönetimi ve sürekli iyileştirme planı',
        'Kaynak optimizasyonu ve dağıtım planı'
    ] : [
        'Project vision and strategic objectives definition',
        'Stakeholder analysis and management plan creation',
        'Risk assessment and management strategies',
        'Time management and project schedule preparation',
        'Budget planning and financial controls',
        'Communication strategy and reporting system setup',
        'Quality management and continuous improvement plan',
        'Resource optimization and allocation plan'
    ];
    
    return titles[index % titles.length];
}

function calculateAverageTaskLength(tasks) {
    if (tasks.length === 0) return 0;
    const totalLength = tasks.reduce((sum, task) => sum + (task.description?.length || 0), 0);
    return Math.round(totalLength / tasks.length);
}

function ensureComprehensiveTasks(tasks, userAnswers, language, analysis, extendedMode = false) {
    const MIN_TASKS = extendedMode ? 15 : 10;
    const MAX_TASKS = extendedMode ? 25 : 15;
    
    if (tasks.length >= MIN_TASKS) {
        return tasks.slice(0, MAX_TASKS);
    }
    
    const additionalNeeded = MIN_TASKS - tasks.length;
    const additionalTasks = generateAdditionalTasks(additionalNeeded, userAnswers, language, analysis, extendedMode);
    
    return [...tasks, ...additionalTasks].slice(0, MAX_TASKS);
}

function generateAdditionalTasks(count, userAnswers, language, analysis, extendedMode = false) {
    const additionalTasks = [];
    const isTurkish = language === 'tr';
    
    const taskTemplates = isTurkish ? [
        {
            title: 'Proje kapsam belgesini detaylandır',
            description: 'Projenin kapsamını, dahil edilecek ve edilmeyecek öğeleri, kısıtları ve varsayımları detaylı şekilde belgeleyin.',
            priority: 'high',
            tags: ['kapsam', 'belgeleme', 'planlama']
        },
        {
            title: 'Risk yönetim planını genişlet',
            description: 'Riskleri kategorilere ayırın, önceliklendirin ve her risk için detaylı azaltma planları hazırlayın.',
            priority: 'high',
            tags: ['risk', 'yönetim', 'planlama']
        }
    ] : [
        {
            title: 'Elaborate project scope document',
            description: 'Document project scope, included/excluded items, constraints, and assumptions in detail.',
            priority: 'high',
            tags: ['scope', 'documentation', 'planning']
        },
        {
            title: 'Expand risk management plan',
            description: 'Categorize risks, prioritize them, and prepare detailed mitigation plans for each risk.',
            priority: 'high',
            tags: ['risk', 'management', 'planning']
        }
    ];
    
    for (let i = 0; i < count && i < taskTemplates.length; i++) {
        const template = taskTemplates[i];
        const enhancedDescription = extendedMode ? 
            template.description + ' ' + (isTurkish ? 
                'Bu görev için detaylı uygulama adımları, beklenen sonuçlar ve ölçüm kriterleri belirleyin.' :
                'Define detailed implementation steps, expected outcomes, and measurement criteria for this task.') :
            template.description;
            
        additionalTasks.push({
            id: `${isTurkish ? 'ek' : 'additional'}_${Date.now()}_${i}`,
            title: template.title,
            description: enhancedDescription,
            status: 'todo',
            priority: template.priority,
            tags: template.tags,
            estimatedTime: estimateTimeForTask(i, analysis, extendedMode)
        });
    }
    
    return additionalTasks;
}

function getGenerationNote(language, experienceLevel, taskCount, extendedMode = false) {
    if (language === 'tr') {
        if (extendedMode) {
            return `${taskCount} adet kapsamlı ve detaylı görev oluşturuldu. Her görev uzun açıklamalar, stratejik öneriler ve pratik rehberlik içerir.`;
        } else if (experienceLevel.includes('beginner')) {
            return `${taskCount} adet başlangıç dostu görev oluşturuldu. Her adımda size rehberlik edecek şekilde detaylandırıldı.`;
        } else if (experienceLevel === 'professional' || experienceLevel === 'expert') {
            return `${taskCount} adet profesyonel seviye görev oluşturuldu. Stratejik proje yönetimi yaklaşımları ve detaylı analizler içerir.`;
        } else {
            return `${taskCount} adet uygulanabilir görev oluşturuldu. Cevaplarınıza dayalı özelleştirilmiş içerikler ve detaylı açıklamalar içerir.`;
        }
    } else {
        if (extendedMode) {
            return `Created ${taskCount} comprehensive and detailed tasks. Each task includes lengthy descriptions, strategic recommendations, and practical guidance.`;
        } else if (experienceLevel.includes('beginner')) {
            return `Created ${taskCount} beginner-friendly tasks. Detailed to guide you through each step.`;
        } else if (experienceLevel === 'professional' || experienceLevel === 'expert') {
            return `Created ${taskCount} professional-level tasks. Includes strategic project management approaches and detailed analysis.`;
        } else {
            return `Created ${taskCount} actionable tasks. Contains customized content based on your answers with detailed explanations.`;
        }
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: DEEPSEEK_API_KEY ? 'healthy' : 'warning',
        service: 'Intuiva AI Backend - Extended Mode',
        version: '3.0.0',
        features: [
            'extended-task-generation', 
            'comprehensive-reports', 
            'bilingual-support-enhanced',
            'experience-adaptation-pro',
            'minimum-10-25-tasks',
            'project-manager-style-pro'
        ],
        languageSupport: ['English (Enhanced)', 'Turkish (Enhanced)'],
        apiKeyConfigured: !!DEEPSEEK_API_KEY,
        tokenLimits: 'Extended (up to 32k tokens)',
        timeoutSettings: 'Extended (up to 3 minutes)',
        minimumTasks: '10-25 depending on mode',
        timestamp: new Date().toISOString(),
        endpoints: [
            '/api/generate-tasks (POST)',
            '/api/generate-report (POST)',
            '/test-prompt (POST)',
            '/health (GET)'
        ]
    });
});

// Test endpoint with extended mode
app.post('/test-prompt', async (req, res) => {
    try {
        const { answers, questions, language, extendedMode } = req.body;
        const analysis = analyzeUserInput(answers || {}, questions || [], language || 'en');
        const prompt = constructProjectManagerPrompt(analysis, answers || {}, questions || [], language || 'en', extendedMode || false);
        
        res.json({ 
            prompt: prompt,
            promptLength: prompt.length,
            analysis: {
                experienceLevel: analysis.experienceLevel,
                wordCount: analysis.answerAnalysis.wordCount,
                technicalTerms: analysis.answerAnalysis.technicalTerms,
                languageProfile: analysis.answerAnalysis.languageProfile,
                complexityLevel: analysis.answerAnalysis.complexityLevel,
                elaborationScore: analysis.answerAnalysis.elaborationScore
            },
            extendedMode: extendedMode || false
        });
    } catch (error) {
        res.json({ error: error.message, stack: error.stack });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Intuiva Backend v3.0 (Extended Mode) running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 Test prompt: POST http://localhost:${PORT}/test-prompt`);
    console.log(`🤖 DeepSeek API Key: ${DEEPSEEK_API_KEY ? 'Set ✅' : 'Missing ❌'}`);
    console.log(`🌍 Enhanced language support: English & Turkish (Extended)`);
    console.log(`🎯 Task generation: 10-25 tasks with extended mode support`);
    console.log(`📊 Reports: Comprehensive analysis with up to 32k tokens`);
    console.log(`⏱️  Timeouts: Extended to 3 minutes for comprehensive responses`);
    console.log(`💾 Memory: Increased payload limits for large responses`);
});
