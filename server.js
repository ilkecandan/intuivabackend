const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// ==================== MAIN ENDPOINTS ====================

// Task generation endpoint
app.post('/api/generate-tasks', async (req, res) => {
    console.log('🚀 Task generation request received');
    
    try {
        const { 
            answers = {}, 
            questions = [], 
            language = 'auto', // auto-detect language
            generateReport = false 
        } = req.body;

        // Auto-detect language from answers
        const detectedLanguage = detectLanguageFromAnswers(answers, questions);
        const finalLanguage = language === 'auto' ? detectedLanguage : language;
        
        // 1. Analyze user input
        const analysis = analyzeUserInput(answers, questions, finalLanguage);
        console.log(`📊 Analysis: ${analysis.experienceLevel} level, ${analysis.answerCount} answers, Language: ${finalLanguage}`);
        
        // 2. Generate tasks
        let tasks = [];
        try {
            tasks = await generateAITasks(answers, questions, finalLanguage, analysis);
            console.log(`🤖 AI generated ${tasks.length} tasks`);
        } catch (aiError) {
            console.log('🤖 AI task generation failed, using fallback:', aiError.message);
            tasks = generateFallbackTasks(finalLanguage, analysis);
        }
        
        // 3. Ensure minimum tasks
        if (tasks.length < 8) {
            const extraTasks = generateExtraTasks(8 - tasks.length, finalLanguage, analysis);
            tasks = [...tasks, ...extraTasks];
        }
        
        // 4. Personalize tasks
        const personalizedTasks = personalizeTasks(tasks, answers, questions, finalLanguage);
        
        // 5. Generate report if requested
        let report = null;
        if (generateReport) {
            try {
                report = await generateAIReport(personalizedTasks, answers, questions, finalLanguage, analysis);
                console.log('📋 AI report generated successfully');
            } catch (reportError) {
                console.log('📋 AI report failed, using local report:', reportError.message);
                report = generateLocalReport(personalizedTasks, answers, questions, finalLanguage, analysis);
            }
        }

        // 6. Return success
        res.json({
            success: true,
            tasks: personalizedTasks,
            report: report,
            note: getSuccessNote(finalLanguage, personalizedTasks.length, analysis.experienceLevel),
            stats: {
                totalTasks: personalizedTasks.length,
                userAnswers: analysis.answerCount,
                experienceLevel: analysis.experienceLevel,
                language: finalLanguage
            }
        });

    } catch (error) {
        console.log('🔥 Critical error in task generation:', error.message);
        
        // Always return success with fallback
        const { answers = {}, questions = [], language = 'auto', generateReport = false } = req.body || {};
        const detectedLanguage = detectLanguageFromAnswers(answers, questions);
        const finalLanguage = language === 'auto' ? detectedLanguage : language;
        const analysis = analyzeUserInput(answers, questions, finalLanguage);
        const fallbackTasks = generateFallbackTasks(finalLanguage, analysis);
        const personalizedTasks = personalizeTasks(fallbackTasks, answers, questions, finalLanguage);
        
        let report = null;
        if (generateReport) {
            report = generateLocalReport(personalizedTasks, answers, questions, finalLanguage, analysis);
        }
        
        res.json({
            success: true,
            tasks: personalizedTasks,
            report: report,
            note: finalLanguage === 'tr' 
                ? 'Güvenilir görevler oluşturuldu' 
                : 'Reliable tasks created',
            fallback: true,
            stats: {
                totalTasks: personalizedTasks.length,
                userAnswers: analysis.answerCount,
                experienceLevel: analysis.experienceLevel,
                language: finalLanguage
            }
        });
    }
});

// Separate report generation endpoint
app.post('/api/generate-report', async (req, res) => {
    console.log('📊 Report generation request received');
    
    try {
        const { 
            tasks = [], 
            answers = {}, 
            questions = [], 
            language = 'auto'
        } = req.body;
        
        // Auto-detect language from answers or tasks
        const detectedLanguage = detectLanguageFromAnswers(answers, questions) || 
                               detectLanguageFromTasks(tasks) || 
                               'en';
        const finalLanguage = language === 'auto' ? detectedLanguage : language;
        
        if (!tasks || tasks.length === 0) {
            return res.json({
                success: true,
                report: generateEmptyReport(finalLanguage),
                note: finalLanguage === 'tr' ? 'Görev olmadığı için temel rapor' : 'Basic report as no tasks',
                fallback: true
            });
        }
        
        const analysis = analyzeUserInput(answers, questions, finalLanguage);
        let report;
        
        try {
            // Try AI report with shorter timeout first
            report = await generateAIReportWithShortTimeout(tasks, answers, questions, finalLanguage, analysis);
            console.log('📋 AI report generated successfully');
        } catch (aiError) {
            console.log('📋 AI report failed, using local report:', aiError.message);
            report = generateProfessionalLocalReport(tasks, answers, questions, finalLanguage, analysis);
        }
        
        res.json({
            success: true,
            report: report,
            note: finalLanguage === 'tr' ? 'Proje raporu oluşturuldu' : 'Project report generated',
            stats: {
                tasksInReport: tasks.length,
                reportLength: report.length,
                language: finalLanguage
            }
        });
        
    } catch (error) {
        console.log('🔥 Report generation error:', error.message);
        
        const { tasks = [], answers = {}, questions = [], language = 'auto' } = req.body || {};
        const detectedLanguage = detectLanguageFromAnswers(answers, questions) || 'en';
        const finalLanguage = language === 'auto' ? detectedLanguage : language;
        const analysis = analyzeUserInput(answers, questions, finalLanguage);
        const report = generateProfessionalLocalReport(tasks, answers, questions, finalLanguage, analysis);
        
        res.json({
            success: true,
            report: report,
            note: finalLanguage === 'tr' ? 'Profesyonel yerel rapor oluşturuldu' : 'Professional local report generated',
            fallback: true,
            stats: {
                tasksInReport: tasks.length,
                reportLength: report.length,
                language: finalLanguage
            }
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

function detectLanguageFromAnswers(answers, questions) {
    // Analyze text to detect language
    const allText = Object.values(answers).join(' ') + 
                   questions.map(q => q.text).join(' ');
    
    // Count Turkish specific characters
    const turkishChars = (allText.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
    const englishChars = (allText.match(/[a-zA-Z]/g) || []).length;
    
    if (turkishChars > 5 || (turkishChars > 0 && turkishChars > englishChars / 10)) {
        return 'tr';
    }
    
    return 'en'; // default to English
}

function detectLanguageFromTasks(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) return null;
    
    const sampleText = tasks.slice(0, 3)
        .map(t => `${t.title} ${t.description}`)
        .join(' ');
    
    const turkishChars = (sampleText.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
    const englishChars = (sampleText.match(/[a-zA-Z]/g) || []).length;
    
    if (turkishChars > 3) return 'tr';
    return 'en';
}

function analyzeUserInput(answers, questions, language) {
    const answerEntries = Object.entries(answers);
    const validAnswers = answerEntries.filter(([_, answer]) => 
        answer && 
        typeof answer === 'string' &&
        answer.trim().length > 0 &&
        answer !== '[Skipped]' && 
        answer !== '[Not Applicable]'
    );
    
    const answerCount = validAnswers.length;
    
    // Determine experience level based on answer length and complexity
    let experienceLevel = "beginner";
    if (answerCount > 10) experienceLevel = "expert";
    else if (answerCount > 6) experienceLevel = "experienced";
    else if (answerCount > 3) experienceLevel = "intermediate";
    
    // Extract themes from answers
    const themes = extractThemesFromAnswers(validAnswers.map(([_, a]) => a), language);
    
    // Create Q&A text
    let qaText = "";
    validAnswers.forEach(([index, answer]) => {
        const qIndex = parseInt(index);
        const question = questions[qIndex]?.text || 
                        (language === 'tr' ? `Soru ${qIndex + 1}` : `Question ${qIndex + 1}`);
        qaText += `${language === 'tr' ? 'Soru' : 'Question'}: ${question}\n`;
        qaText += `${language === 'tr' ? 'Cevap' : 'Answer'}: ${answer.substring(0, 500)}\n\n`;
    });
    
    if (qaText.length === 0) {
        qaText = language === 'tr' 
            ? "Kullanıcı henüz detaylı cevap vermedi." 
            : "User hasn't provided detailed answers yet.";
    }
    
    return {
        answerCount,
        experienceLevel,
        themes,
        qaText,
        language
    };
}

function extractThemesFromAnswers(answers, language) {
    const text = answers.join(' ').toLowerCase();
    const themes = new Set();
    
    if (language === 'tr') {
        if (text.includes('web') || text.includes('site') || text.includes('internet')) themes.add('Web Geliştirme');
        if (text.includes('mobil') || text.includes('telefon') || text.includes('uygulama')) themes.add('Mobil Uygulama');
        if (text.includes('iş') || text.includes('şirket') || text.includes('ticaret')) themes.add('İş/Şirket');
        if (text.includes('plan') || text.includes('zaman') || text.includes('takvim')) themes.add('Planlama');
        if (text.includes('ekip') || text.includes('takım') || text.includes('çalışan')) themes.add('Ekip Yönetimi');
        if (text.includes('bütçe') || text.includes('para') || text.includes('maliyet')) themes.add('Bütçe');
        if (text.includes('e-ticaret') || text.includes('satış') || text.includes('alışveriş')) themes.add('E-Ticaret');
        if (text.includes('tasarım') || text.includes('görsel') || text.includes('ui')) themes.add('Tasarım');
        if (text.includes('yazılım') || text.includes('kod') || text.includes('program')) themes.add('Yazılım');
        if (text.includes('eğitim') || text.includes('öğren') || text.includes('kurs')) themes.add('Eğitim');
    } else {
        if (text.includes('web') || text.includes('site') || text.includes('internet')) themes.add('Web Development');
        if (text.includes('mobile') || text.includes('phone') || text.includes('app')) themes.add('Mobile App');
        if (text.includes('business') || text.includes('company') || text.includes('commerce')) themes.add('Business');
        if (text.includes('plan') || text.includes('time') || text.includes('schedule')) themes.add('Planning');
        if (text.includes('team') || text.includes('people') || text.includes('employee')) themes.add('Team Management');
        if (text.includes('budget') || text.includes('money') || text.includes('cost')) themes.add('Budget');
        if (text.includes('e-commerce') || text.includes('sales') || text.includes('shop')) themes.add('E-commerce');
        if (text.includes('design') || text.includes('visual') || text.includes('ui')) themes.add('Design');
        if (text.includes('software') || text.includes('code') || text.includes('program')) themes.add('Software');
        if (text.includes('education') || text.includes('learn') || text.includes('course')) themes.add('Education');
    }
    
    if (themes.size === 0) {
        themes.add(language === 'tr' ? 'Genel Proje' : 'General Project');
    }
    
    return Array.from(themes);
}

async function generateAITasks(answers, questions, language, analysis) {
    const prompt = createTaskPrompt(answers, questions, language, analysis);
    
    const response = await axios.post(DEEPSEEK_API_URL, {
        model: "deepseek-chat",
        messages: [
            { 
                role: "system", 
                content: getTaskSystemPrompt(language, analysis.experienceLevel)
            },
            { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        stream: false
    }, {
        headers: { 
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });
    
    if (response.status !== 200 || !response.data.choices?.[0]?.message?.content) {
        throw new Error('AI API returned invalid response');
    }
    
    return parseAITasks(response.data.choices[0].message.content, language);
}

function getTaskSystemPrompt(language, experienceLevel) {
    if (language === 'tr') {
        return `Sen deneyimli bir proje koçusun. ${experienceLevel} seviyesindeki kullanıcıya özel, pratik ve uygulanabilir görevler oluştur.
        
Görev formatı (JSON array):
[
  {
    "title": "Kısa ve net Türkçe başlık",
    "description": "Açıklayıcı ve motive edici açıklama (minimum 2 cümle)",
    "priority": "high/medium/low",
    "estimatedTime": "X saat/gün"
  }
]

Kurallar:
1. SADECE JSON döndür, başka hiçbir şey yazma
2. 8-12 görev oluştur
3. Tüm içerik Türkçe olsun
4. ${experienceLevel} seviyesine uygun, pratik görevler yap
5. Her görev için tahmini süre ekle
6. Açıklamalar motive edici ve yardımsever olsun`;
    }
    
    return `You are an experienced project coach. Create practical and actionable tasks specifically for ${experienceLevel} level user.
    
Task format (JSON array):
[
  {
    "title": "Short and clear English title",
    "description": "Descriptive and motivational description (minimum 2 sentences)",
    "priority": "high/medium/low",
    "estimatedTime": "X hours/days"
  }
]

Rules:
1. Return ONLY JSON, nothing else
2. Create 8-12 tasks
3. All content in English
4. Make tasks suitable for ${experienceLevel} level, practical
5. Add estimated time for each task
6. Descriptions should be motivational and helpful`;
}

function createTaskPrompt(answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    let prompt = isTurkish ?
        `${analysis.experienceLevel} seviyesinde bir kullanıcı için proje yönetimi görevleri oluştur.\n\n` :
        `Create project management tasks for a ${analysis.experienceLevel} level user.\n\n`;
    
    if (analysis.qaText && analysis.qaText.length > 50) {
        prompt += isTurkish ? "KULLANICI BİLGİLERİ:\n" : "USER INFORMATION:\n";
        prompt += analysis.qaText.substring(0, 800) + "\n\n";
    }
    
    prompt += isTurkish ?
        `**Kullanıcı Seviyesi:** ${analysis.experienceLevel}\n` +
        `**Proje Temaları:** ${analysis.themes.join(', ')}\n\n` +
        "Lütfen 8-12 adet pratik, uygulanabilir ve motive edici görev oluştur. " +
        "Görevler JSON formatında olsun. Her görev için:\n" +
        "- Net bir başlık\n" +
        "- Detaylı açıklama (en az 2 cümle)\n" +
        "- Öncelik seviyesi (high/medium/low)\n" +
        "- Tahmini tamamlanma süresi\n\n" +
        "Örnek format:\n" +
        `[
  {
    "title": "Proje vizyonunu tanımla",
    "description": "Projenin temel amacını ve hedeflerini 2-3 cümlede açıkla. Bu, tüm ekibin aynı hedefe odaklanmasını sağlar.",
    "priority": "high",
    "estimatedTime": "2 saat"
  }
]` :
        `**User Level:** ${analysis.experienceLevel}\n` +
        `**Project Themes:** ${analysis.themes.join(', ')}\n\n` +
        "Please create 8-12 practical, actionable and motivational tasks. " +
        "Tasks should be in JSON format. For each task include:\n" +
        "- Clear title\n" +
        "- Detailed description (at least 2 sentences)\n" +
        "- Priority level (high/medium/low)\n" +
        "- Estimated completion time\n\n" +
        "Example format:\n" +
        `[
  {
    "title": "Define project vision",
    "description": "Describe the core purpose and goals of your project in 2-3 sentences. This ensures the entire team focuses on the same goal.",
    "priority": "high",
    "estimatedTime": "2 hours"
  }
]`;
    
    return prompt;
}

function parseAITasks(aiResponse, language) {
    try {
        const cleanResponse = aiResponse.trim();
        
        // Try to find JSON array
        const jsonStart = cleanResponse.indexOf('[');
        const jsonEnd = cleanResponse.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
            console.log('No JSON array found in AI response');
            return [];
        }
        
        const jsonString = cleanResponse.substring(jsonStart, jsonEnd);
        const tasks = JSON.parse(jsonString);
        
        if (!Array.isArray(tasks)) {
            console.log('AI response is not an array');
            return [];
        }
        
        return tasks.map((task, index) => ({
            id: `task_${Date.now()}_${index}`,
            title: task.title || (language === 'tr' ? `Görev ${index + 1}` : `Task ${index + 1}`),
            description: task.description || getDefaultTaskDescription(language, index),
            status: 'todo',
            priority: validatePriority(task.priority) || getDefaultPriority(index),
            tags: Array.isArray(task.tags) ? task.tags : [language === 'tr' ? 'proje' : 'project'],
            estimatedTime: task.estimatedTime || '1-2 hours',
            createdAt: new Date().toISOString()
        }));
        
    } catch (error) {
        console.log('AI task parsing error:', error.message);
        return [];
    }
}

function validatePriority(priority) {
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    if (priority && validPriorities.includes(priority.toLowerCase())) {
        return priority.toLowerCase();
    }
    return null;
}

function getDefaultTaskDescription(language, index) {
    if (language === 'tr') {
        const descriptions = [
            'Bu görev projenizin başlangıcı için önemli bir adımdır. Küçük başlayın ve adım adım ilerleyin.',
            'Proje ilerlemeniz için temel bir görev. Her adım sizi hedefinize yaklaştırır.',
            'Bu görev size yol gösterecek ve projenizi bir sonraki seviyeye taşıyacak.',
            'Başlamak için mükemmel bir nokta. Bu görevi tamamlayarak momentum kazanın.',
            'Projenizin gelişimi için kritik bir adım. Dikkatle planlayın ve uygulayın.',
            'Planlamanızı güçlendirecek önemli bir görev. Detaylara özen gösterin.',
            'Kaynaklarınızı organize etmenize yardımcı olacak pratik bir görev.',
            'Zaman yönetimi için önemli bir adım. Gerçekçi hedefler belirleyin.'
        ];
        return descriptions[index % descriptions.length];
    }
    
    const descriptions = [
        'This task is an important step for starting your project. Start small and progress step by step.',
        'A fundamental task for your project progress. Each step brings you closer to your goal.',
        'This task will guide you and take your project to the next level.',
        'A perfect starting point. Complete this task to gain momentum.',
        'A critical step for your project development. Plan carefully and implement.',
        'An important task that will strengthen your planning. Pay attention to details.',
        'A practical task that will help you organize your resources.',
        'An important step for time management. Set realistic goals.'
    ];
    return descriptions[index % descriptions.length];
}

function getDefaultPriority(index) {
    if (index < 3) return 'high';
    if (index < 7) return 'medium';
    return 'low';
}

function generateFallbackTasks(language, analysis) {
    const isTurkish = language === 'tr';
    const tasks = [];
    const baseCount = 10;
    
    for (let i = 0; i < baseCount; i++) {
        const task = createFallbackTask(i, language, analysis);
        tasks.push(task);
    }
    
    return tasks;
}

function createFallbackTask(index, language, analysis) {
    const isTurkish = language === 'tr';
    
    const taskTemplates = isTurkish ? [
        { 
            title: 'Proje fikrini yaz', 
            desc: 'Yapmak istediğin projeyi basit ve net bir şekilde açıkla. Ne yapmak istiyorsun ve neden önemli?',
            estimatedTime: '30 dakika'
        },
        { 
            title: 'Temel hedefleri belirle', 
            desc: 'Projenden ne beklediğini 3 ana maddede yaz. Neyi başarmak istiyorsun ve nasıl ölçeceksin?',
            estimatedTime: '45 dakika'
        },
        { 
            title: 'İlk adımları planla', 
            desc: 'İlk hafta neler yapabileceğini düşün ve gerçekçi bir plan oluştur. Küçük başla, büyük düşün.',
            estimatedTime: '1 saat'
        },
        { 
            title: 'İhtiyaçları listele', 
            desc: 'Projen için gerekli araçları, kaynakları, becerileri ve yardımcıları detaylı şekilde yaz.',
            estimatedTime: '1 saat'
        },
        { 
            title: 'Zaman çizelgesi oluştur', 
            desc: 'Projen için gerçekçi bir zaman planı yap. Her şeyi aynı anda yapmaya çalışma, öncelikleri belirle.',
            estimatedTime: '1.5 saat'
        },
        { 
            title: 'İlerleme takip sistemi kur', 
            desc: 'Nasıl ilerleyeceğini düşün ve bir takip yöntemi belirle. Haftalık değerlendirmeler yap.',
            estimatedTime: '45 dakika'
        },
        { 
            title: 'Geri bildirim al', 
            desc: 'Proje fikrini birkaç kişiyle paylaş ve geri bildirim al. Farklı perspektifler faydalı olacaktır.',
            estimatedTime: '1 saat'
        },
        { 
            title: 'Küçük bir prototip/test yap', 
            desc: 'Projenden küçük bir parçayı test etmek için basit bir deneme yap. Öğrenerek ilerle.',
            estimatedTime: '2 saat'
        },
        { 
            title: 'Öğrenilenleri belgele', 
            desc: 'Yaptıkların ve öğrendiklerin hakkında notlar tut. Bu notlar gelecekte çok değerli olacak.',
            estimatedTime: '30 dakika'
        },
        { 
            title: 'Sonraki aşamayı planla', 
            desc: 'Bir sonraki aşamada ne yapacağını detaylı şekilde planla. Her adımı düşünerek ilerle.',
            estimatedTime: '1 saat'
        }
    ] : [
        { 
            title: 'Write project idea', 
            desc: 'Simply and clearly describe the project you want to do. What do you want to create and why is it important?',
            estimatedTime: '30 minutes'
        },
        { 
            title: 'Define basic goals', 
            desc: 'Write 3 main things you expect from your project. What do you want to achieve and how will you measure it?',
            estimatedTime: '45 minutes'
        },
        { 
            title: 'Plan first steps', 
            desc: 'Think about what you can do in the first week and create a realistic plan. Start small, think big.',
            estimatedTime: '1 hour'
        },
        { 
            title: 'List requirements', 
            desc: 'Write down in detail the tools, resources, skills, and help you will need for your project.',
            estimatedTime: '1 hour'
        },
        { 
            title: 'Create timeline', 
            desc: 'Make a realistic time plan for your project. Don\'t try to do everything at once, set priorities.',
            estimatedTime: '1.5 hours'
        },
        { 
            title: 'Set up progress tracking system', 
            desc: 'Think about how you will track progress and choose a tracking method. Do weekly evaluations.',
            estimatedTime: '45 minutes'
        },
        { 
            title: 'Get feedback', 
            desc: 'Share your project idea with a few people and get feedback. Different perspectives will be helpful.',
            estimatedTime: '1 hour'
        },
        { 
            title: 'Do a small prototype/test', 
            desc: 'Do a simple trial to test a small part of your project. Progress by learning.',
            estimatedTime: '2 hours'
        },
        { 
            title: 'Document learnings', 
            desc: 'Take notes about what you do and learn. These notes will be very valuable in the future.',
            estimatedTime: '30 minutes'
        },
        { 
            title: 'Plan next phase', 
            desc: 'Plan in detail what you will do in the next phase. Think through each step as you progress.',
            estimatedTime: '1 hour'
        }
    ];
    
    const template = taskTemplates[index % taskTemplates.length];
    
    return {
        id: `fallback_${Date.now()}_${index}`,
        title: template.title,
        description: template.desc,
        status: 'todo',
        priority: index < 3 ? 'high' : index < 7 ? 'medium' : 'low',
        tags: isTurkish ? ['akıllı', 'temel', 'proje'] : ['smart', 'basic', 'project'],
        estimatedTime: template.estimatedTime,
        createdAt: new Date().toISOString(),
        isFallback: true
    };
}

function generateExtraTasks(count, language, analysis) {
    const isTurkish = language === 'tr';
    const tasks = [];
    
    for (let i = 0; i < count; i++) {
        tasks.push({
            id: `extra_${Date.now()}_${i}`,
            title: isTurkish ? `Ek Görev ${i + 1}` : `Extra Task ${i + 1}`,
            description: isTurkish ? 
                'Projenizi daha da geliştirmek için bu ek görevi tamamlayın. Bu görev, projenizin kapsamını genişletmenize yardımcı olacaktır.' :
                'Complete this extra task to further develop your project. This task will help you expand the scope of your project.',
            status: 'todo',
            priority: 'low',
            tags: isTurkish ? ['ek', 'geliştirme', 'ilerleme'] : ['extra', 'development', 'progress'],
            estimatedTime: '1-2 hours',
            createdAt: new Date().toISOString()
        });
    }
    
    return tasks;
}

function personalizeTasks(tasks, answers, questions, language) {
    const isTurkish = language === 'tr';
    
    // Find valid answers for personalization
    const validAnswers = Object.entries(answers)
        .filter(([_, answer]) => 
            answer && 
            typeof answer === 'string' &&
            answer.trim().length > 10 &&
            answer !== '[Skipped]' && 
            answer !== '[Not Applicable]'
        );
    
    if (validAnswers.length === 0) {
        return tasks; // No personalization possible
    }
    
    return tasks.map((task, taskIndex) => {
        // Only personalize some tasks (every 2nd or 3rd task)
        if (taskIndex < 3 || taskIndex % 3 === 0) {
            const answerIndex = taskIndex % validAnswers.length;
            const [qIndex, answer] = validAnswers[answerIndex];
            const qNumber = parseInt(qIndex);
            const questionText = questions[qNumber]?.text || 
                               (isTurkish ? `Soru ${qNumber + 1}` : `Question ${qNumber + 1}`);
            
            if (answer.length > 20) {
                const note = isTurkish ?
                    `\n\n💡 **Kişiselleştirilmiş Not:** Bu görev "${questionText}" hakkındaki cevabınızdan esinlenmiştir.` :
                    `\n\n💡 **Personalized Note:** This task is inspired by your answer about "${questionText}".`;
                
                return {
                    ...task,
                    description: task.description + note,
                    personalized: true
                };
            }
        }
        
        return task;
    });
}

async function generateAIReportWithShortTimeout(tasks, answers, questions, language, analysis) {
    // First try with shorter timeout
    try {
        return await generateAIReport(tasks, answers, questions, language, analysis, 25000); // 25 seconds
    } catch (error) {
        console.log('First AI report attempt failed, trying with even shorter prompt');
        // Try with simpler prompt
        return await generateSimpleAIReport(tasks, answers, questions, language, analysis);
    }
}

async function generateAIReport(tasks, answers, questions, language, analysis, timeout = 25000) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const highPriorityTasks = tasks.filter(t => t.priority === 'high');
    const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium');
    
    // Prepare user answers for the report
    let userAnswersText = '';
    const validAnswers = Object.entries(answers)
        .filter(([_, answer]) => answer && answer !== '[Skipped]' && answer !== '[Not Applicable]');
    
    if (validAnswers.length > 0) {
        userAnswersText = isTurkish ? '**KULLANICI GİRDİLERİ:**\n\n' : '**USER INPUTS:**\n\n';
        validAnswers.slice(0, 3).forEach(([index, answer]) => {
            const qNumber = parseInt(index);
            const question = questions[qNumber]?.text || (isTurkish ? `Soru ${qNumber + 1}` : `Question ${qNumber + 1}`);
            const shortAnswer = answer.length > 100 ? answer.substring(0, 100) + '...' : answer;
            userAnswersText += `**${question}**\n${shortAnswer}\n\n`;
        });
    }
    
    const reportPrompt = isTurkish ? `
BANA PROFESYONEL BİR PROJE RAPORU OLUŞTUR:

**PROJE ÖZETİ:**
- Toplam Görev: ${totalTasks} (${completedTasks} tamamlanmış, %${completionRate} tamamlanma)
- Yüksek Öncelikli Görevler: ${highPriorityTasks.length}
- Orta Öncelikli Görevler: ${mediumPriorityTasks.length}
- Kullanıcı Seviyesi: ${analysis.experienceLevel}
- Proje Temaları: ${analysis.themes.join(', ')}

**ÖNEMLİ GÖREVLER:**
${tasks.slice(0, 5).map((t, i) => `${i+1}. ${t.title} (${t.priority} öncelik)`).join('\n')}

${userAnswersText}

**RAFOR İÇERİĞİ İÇİN TALİMATLAR:**
1. **Proje Özeti** - Genel durum ve temel metrikler
2. **Görev Analizi** - Öncelik dağılımı ve tamamlanma durumu
3. **İlerleme Planı** - Önerilen zaman çizelgesi
4. **Risk Değerlendirmesi** - Olası zorluklar ve çözümler
5. **Tavsiyeler** - ${analysis.experienceLevel} seviyesi için öneriler
6. **Sonraki Adımlar** - Eylem planı

**FORMAT:** Markdown formatında, profesyonel Türkçe.
**UZUNLUK:** Yaklaşık 800-1000 kelime.
**YAPISI:** Başlıklar, madde işaretleri ve net açıklamalar.

SADECE RAPOR İÇERİĞİNİ DÖNDÜR.
` : `
CREATE A PROFESSIONAL PROJECT REPORT FOR ME:

**PROJECT SUMMARY:**
- Total Tasks: ${totalTasks} (${completedTasks} completed, ${completionRate}% completion)
- High Priority Tasks: ${highPriorityTasks.length}
- Medium Priority Tasks: ${mediumPriorityTasks.length}
- User Level: ${analysis.experienceLevel}
- Project Themes: ${analysis.themes.join(', ')}

**KEY TASKS:**
${tasks.slice(0, 5).map((t, i) => `${i+1}. ${t.title} (${t.priority} priority)`).join('\n')}

${userAnswersText}

**REPORT CONTENT INSTRUCTIONS:**
1. **Project Summary** - Overall status and key metrics
2. **Task Analysis** - Priority distribution and completion status
3. **Progress Plan** - Recommended timeline
4. **Risk Assessment** - Potential challenges and solutions
5. **Recommendations** - Advice for ${analysis.experienceLevel} level
6. **Next Steps** - Action plan

**FORMAT:** In markdown format, professional English.
**LENGTH:** Approximately 800-1000 words.
**STRUCTURE:** Headings, bullet points, clear explanations.

RETURN ONLY THE REPORT CONTENT.
`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
        model: "deepseek-chat",
        messages: [
            { 
                role: "system", 
                content: isTurkish ?
                    "Sen profesyonel bir proje yönetimi danışmanısın. Net, anlaşılır ve profesyonel proje raporları oluştur. Markdown formatında yaz. Sadece rapor içeriğini döndür." :
                    "You are a professional project management consultant. Create clear, understandable, and professional project reports. Write in markdown format. Return only the report content."
            },
            { role: "user", content: reportPrompt }
        ],
        temperature: 0.6,
        max_tokens: 2000
    }, {
        headers: { 
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
            'Content-Type': 'application/json'
        },
        timeout: timeout
    });
    
    if (response.status !== 200 || !response.data.choices?.[0]?.message?.content) {
        throw new Error('AI report generation failed');
    }
    
    return response.data.choices[0].message.content;
}

async function generateSimpleAIReport(tasks, answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const reportPrompt = isTurkish ? 
        `${analysis.experienceLevel} seviyesi proje raporu oluştur. ${totalTasks} görev, ${completionRate}% tamamlanma. Markdown formatında, sadece rapor içeriği.` :
        `Create ${analysis.experienceLevel} level project report. ${totalTasks} tasks, ${completionRate}% completion. In markdown format, only report content.`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
        model: "deepseek-chat",
        messages: [
            { 
                role: "system", 
                content: isTurkish ?
                    "Kısa ve öz proje raporları oluştur. Markdown formatında yaz. Sadece rapor içeriği." :
                    "Create short and concise project reports. Write in markdown format. Only report content."
                },
            { role: "user", content: reportPrompt }
        ],
        temperature: 0.6,
        max_tokens: 1500
    }, {
        headers: { 
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
            'Content-Type': 'application/json'
        },
        timeout: 15000
    });
    
    if (response.status !== 200 || !response.data.choices?.[0]?.message?.content) {
        throw new Error('Simple AI report generation failed');
    }
    
    return response.data.choices[0].message.content;
}

function generateProfessionalLocalReport(tasks, answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const highPriorityTasks = tasks.filter(t => t.priority === 'high');
    const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium');
    const lowPriorityTasks = tasks.filter(t => t.priority === 'low');
    
    const now = new Date();
    const formattedDate = now.toLocaleDateString(isTurkish ? 'tr-TR' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const formattedTime = now.toLocaleTimeString(isTurkish ? 'tr-TR' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    let report = isTurkish ? 
        `# 📋 PROJE DURUM RAPORU\n\n` :
        `# 📋 PROJECT STATUS REPORT\n\n`;
    
    // Header Section
    report += `## 📊 ${isTurkish ? 'PROJE ÖZETİ' : 'PROJECT SUMMARY'}\n\n`;
    
    report += `**${isTurkish ? 'Rapor Tarihi' : 'Report Date'}:** ${formattedDate} | ${formattedTime}\n`;
    report += `**${isTurkish ? 'Proje Kimliği' : 'Project ID'}:** PRJ-${now.getTime().toString().slice(-6)}\n`;
    report += `**${isTurkish ? 'Kullanıcı Seviyesi' : 'User Level'}:** ${analysis.experienceLevel}\n`;
    report += `**${isTurkish ? 'Proje Temaları' : 'Project Themes'}:** ${analysis.themes.join(', ')}\n\n`;
    
    // Key Metrics
    report += `### ${isTurkish ? 'Ana Metrikler' : 'Key Metrics'}\n\n`;
    
    const metrics = [
        { label: isTurkish ? 'Toplam Görev' : 'Total Tasks', value: totalTasks, icon: '📋' },
        { label: isTurkish ? 'Tamamlanan' : 'Completed', value: `${completedTasks} (${completionRate}%)`, icon: '✅' },
        { label: isTurkish ? 'Yüksek Öncelikli' : 'High Priority', value: highPriorityTasks.length, icon: '🔴' },
        { label: isTurkish ? 'Orta Öncelikli' : 'Medium Priority', value: mediumPriorityTasks.length, icon: '🟡' },
        { label: isTurkish ? 'Düşük Öncelikli' : 'Low Priority', value: lowPriorityTasks.length, icon: '🟢' },
        { label: isTurkish ? 'Cevaplanan Sorular' : 'Questions Answered', value: analysis.answerCount, icon: '💬' }
    ];
    
    metrics.forEach(metric => {
        report += `${metric.icon} **${metric.label}:** ${metric.value}\n`;
    });
    
    report += `\n`;
    
    // Task Analysis
    report += `## 📈 ${isTurkish ? 'GÖREV ANALİZİ' : 'TASK ANALYSIS'}\n\n`;
    
    if (highPriorityTasks.length > 0) {
        report += `### ${isTurkish ? '🎯 ÖNCELİKLİ GÖREVLER' : '🎯 PRIORITY TASKS'}\n\n`;
        
        highPriorityTasks.slice(0, 3).forEach((task, index) => {
            const shortDesc = task.description.length > 80 ? 
                task.description.substring(0, 80) + '...' : 
                task.description;
            report += `${index + 1}. **${task.title}**\n`;
            report += `   📝 ${shortDesc}\n`;
            report += `   ⏱️ ${task.estimatedTime || '1-2 saat'}\n\n`;
        });
    }
    
    // Progress Status
    report += `### ${isTurkish ? '📊 İLERLEME DURUMU' : '📊 PROGRESS STATUS'}\n\n`;
    
    const progressBarLength = 20;
    const completedBars = Math.round((completedTasks / totalTasks) * progressBarLength);
    const progressBar = '█'.repeat(completedBars) + '░'.repeat(progressBarLength - completedBars);
    
    report += `${progressBar} ${completionRate}%\n\n`;
    report += `**${isTurkish ? 'Tamamlanma Oranı:' : 'Completion Rate:'}** ${completionRate}%\n`;
    report += `**${isTurkish ? 'Kalan Görevler:' : 'Remaining Tasks:'}** ${totalTasks - completedTasks}\n\n`;
    
    // Priority Distribution
    report += `### ${isTurkish ? '🎯 ÖNCELİK DAĞILIMI' : '🎯 PRIORITY DISTRIBUTION'}\n\n`;
    
    const priorities = [
        { level: isTurkish ? 'Yüksek' : 'High', count: highPriorityTasks.length, color: '🔴' },
        { level: isTurkish ? 'Orta' : 'Medium', count: mediumPriorityTasks.length, color: '🟡' },
        { level: isTurkish ? 'Düşük' : 'Low', count: lowPriorityTasks.length, color: '🟢' }
    ];
    
    priorities.forEach(p => {
        const percentage = totalTasks > 0 ? Math.round((p.count / totalTasks) * 100) : 0;
        report += `${p.color} **${p.level} ${isTurkish ? 'Öncelik' : 'Priority'}:** ${p.count} ${isTurkish ? 'görev' : 'tasks'} (${percentage}%)\n`;
    });
    
    report += `\n`;
    
    // Project Roadmap
    report += `## 🗺️ ${isTurkish ? 'PROJE YOL HARİTASI' : 'PROJECT ROADMAP'}\n\n`;
    
    const roadmap = isTurkish ? [
        { phase: 'Hafta 1', focus: 'Planlama ve Başlangıç', tasks: 'Yüksek öncelikli görevler' },
        { phase: 'Hafta 2-3', focus: 'Uygulama', tasks: 'Orta öncelikli görevler' },
        { phase: 'Hafta 4-6', focus: 'Geliştirme ve Test', tasks: 'Düşük öncelikli görevler' },
        { phase: 'Hafta 7+', focus: 'Değerlendirme', tasks: 'Geri bildirim ve iyileştirme' }
    ] : [
        { phase: 'Week 1', focus: 'Planning and Initiation', tasks: 'High priority tasks' },
        { phase: 'Week 2-3', focus: 'Implementation', tasks: 'Medium priority tasks' },
        { phase: 'Week 4-6', focus: 'Development and Testing', tasks: 'Low priority tasks' },
        { phase: 'Week 7+', focus: 'Evaluation', tasks: 'Feedback and improvement' }
    ];
    
    roadmap.forEach(item => {
        report += `### ${item.phase}: ${item.focus}\n`;
        report += `📌 ${item.tasks}\n\n`;
    });
    
    // Recommendations
    report += `## 💡 ${isTurkish ? 'TAVSİYELER' : 'RECOMMENDATIONS'}\n\n`;
    
    const recommendations = getRecommendationsByLevel(analysis.experienceLevel, language);
    recommendations.forEach((rec, index) => {
        report += `${index + 1}. ${rec}\n`;
    });
    
    report += `\n`;
    
    // Action Plan
    report += `## 🎯 ${isTurkish ? 'EYLEM PLANI' : 'ACTION PLAN'}\n\n`;
    
    const actions = isTurkish ? [
        { icon: '🚀', action: 'İlk yüksek öncelikli görevi bugün başlat' },
        { icon: '📅', action: 'Haftalık hedefler belirle (3-5 görev)' },
        { icon: '✅', action: 'Tamamlanan her görevi işaretle' },
        { icon: '🔄', action: 'Haftalık ilerleme değerlendirmesi yap' },
        { icon: '📝', action: 'Öğrenilenleri ve notları belgele' }
    ] : [
        { icon: '🚀', action: 'Start the first high priority task today' },
        { icon: '📅', action: 'Set weekly goals (3-5 tasks)' },
        { icon: '✅', action: 'Mark every completed task' },
        { icon: '🔄', action: 'Do weekly progress evaluation' },
        { icon: '📝', action: 'Document learnings and notes' }
    ];
    
    actions.forEach(item => {
        report += `${item.icon} ${item.action}\n`;
    });
    
    report += `\n`;
    
    // Success Tips
    report += `## 🌟 ${isTurkish ? 'BAŞARI İPUÇLARI' : 'SUCCESS TIPS'}\n\n`;
    
    const tips = isTurkish ? [
        '**Küçük başlayın:** Her gün küçük bir adım atın',
        '**Tutarlı olun:** Düzenli çalışma alışkanlığı edinin',
        '**Esnek kalın:** Planlar değişebilir, uyum sağlayın',
        '**Kutlayın:** Her başarıyı, ne kadar küçük olursa olsun kutlayın',
        '**Öğrenin:** Her deneyimden bir şeyler öğrenin',
        '**Paylaşın:** İlerlemenizi başkalarıyla paylaşın'
    ] : [
        '**Start small:** Take one small step every day',
        '**Be consistent:** Develop regular work habits',
        '**Stay flexible:** Plans can change, adapt',
        '**Celebrate:** Celebrate every success, no matter how small',
        '**Learn:** Learn something from every experience',
        '**Share:** Share your progress with others'
    ];
    
    tips.forEach(tip => {
        report += `✨ ${tip}\n`;
    });
    
    report += `\n---\n\n`;
    
    // Footer
    report += isTurkish ?
        `*Bu rapor Intuiva Proje Yöneticisi tarafından otomatik oluşturulmuştur.*\n` +
        `*Rapor Kimliği: RP-${now.getTime().toString().slice(-8)}*\n` +
        `*Oluşturulma: ${now.toISOString()}*` :
        `*This report was automatically generated by Intuiva Project Manager.*\n` +
        `*Report ID: RP-${now.getTime().toString().slice(-8)}*\n` +
        `*Generated: ${now.toISOString()}*`;
    
    return report;
}

function getRecommendationsByLevel(level, language) {
    const isTurkish = language === 'tr';
    
    if (level === 'beginner') {
        return isTurkish ? [
            'Günde sadece 15-20 dakika ayırarak başlayın',
            'İlk görevinizi bugün mutlaka tamamlayın',
            'Anlamadığınızda basit kaynaklardan yardım alın',
            'Kendinize karşı sabırlı ve anlayışlı olun',
            'Her tamamladığınız görev için kendinizi tebrik edin',
            'Küçük hedefler belirleyin ve bunlara odaklanın',
            'Progresinizi görsel olarak takip edin (liste yapın)'
        ] : [
            'Start by dedicating only 15-20 minutes daily',
            'Definitely complete your first task today',
            'Get help from simple resources when you don\'t understand',
            'Be patient and understanding with yourself',
            'Congratulate yourself for every completed task',
            'Set small goals and focus on them',
            'Track your progress visually (make a list)'
        ];
    } else if (level === 'intermediate') {
        return isTurkish ? [
            'Haftalık hedef listeleri oluşturun',
            'Zaman blokları kullanarak çalışın',
            'Daha gelişmiş araçları öğrenmeye başlayın',
            'Geri bildirim almak için projenizi paylaşın',
            'Dokümantasyon oluşturma alışkanlığı edinin',
            'Risk yönetimi planı yapın',
            'Ölçülebilir hedefler belirleyin'
        ] : [
            'Create weekly goal lists',
            'Work using time blocks',
            'Start learning more advanced tools',
            'Share your project to get feedback',
            'Develop documentation habits',
            'Make a risk management plan',
            'Set measurable goals'
        ];
    } else {
        return isTurkish ? [
            'Stratejik planlama yapın (3-6 ay)',
            'Kaynak optimizasyonu üzerine odaklanın',
            'Profesyonel metodolojiler uygulayın',
            'KPI\'lar ve performans metrikleri belirleyin',
            'Ekip yönetimi becerilerinizi geliştirin',
            'Sürekli iyileştirme kültürü oluşturun',
            'Mentorluk yaparak deneyimlerinizi paylaşın'
        ] : [
            'Do strategic planning (3-6 months)',
            'Focus on resource optimization',
            'Apply professional methodologies',
            'Set KPIs and performance metrics',
            'Develop your team management skills',
            'Create a continuous improvement culture',
            'Share your experiences through mentoring'
        ];
    }
}

function generateEmptyReport(language) {
    const isTurkish = language === 'tr';
    
    return isTurkish ?
        `# 📋 PROJE RAPORU\n\n` +
        `## Merhaba! 👋\n\n` +
        `Henüz görev oluşturulmadığı için detaylı bir rapor hazırlanamıyor.\n\n` +
        `### 🚀 Başlamak İçin:\n\n` +
        `1. Soruları cevaplayarak projenizi tanımlayın\n` +
        `2. "Görev Oluştur" butonuna tıklayın\n` +
        `3. Oluşturulan görevlerle çalışmaya başlayın\n` +
        `4. İlerledikçe detaylı raporlar alın\n\n` +
        `### 💡 İpucu:\n` +
        `Ne kadar çok soruyu detaylı cevaplarsanız, o kadar kişiselleştirilmiş ve faydalı görevler alırsınız!\n\n` +
        `---\n` +
        `*Intuiva Proje Yöneticisi - Her seviyede proje desteği*` :
        `# 📋 PROJECT REPORT\n\n` +
        `## Hello! 👋\n\n` +
        `A detailed report cannot be prepared yet as no tasks have been created.\n\n` +
        `### 🚀 To Get Started:\n\n` +
        `1. Define your project by answering the questions\n` +
        `2. Click the "Generate Tasks" button\n` +
        `3. Start working with the created tasks\n` +
        `4. Get detailed reports as you progress\n\n` +
        `### 💡 Tip:\n` +
        `The more questions you answer in detail, the more personalized and useful tasks you'll receive!\n\n` +
        `---\n` +
        `*Intuiva Project Manager - Project support at every level*`;
}

function getSuccessNote(language, taskCount, experienceLevel) {
    if (language === 'tr') {
        return `✨ ${taskCount} görev başarıyla oluşturuldu! (${experienceLevel} seviyesi)\n` +
               `İlk görevle başlayın ve her adımda ilerleyin. Başarınızı kutlamayı unutmayın! 🎉`;
    }
    
    return `✨ ${taskCount} tasks successfully created! (${experienceLevel} level)\n` +
           `Start with the first task and progress with each step. Don't forget to celebrate your success! 🎉`;
}

// ==================== SERVER SETUP ====================

// Health endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Intuiva Project Manager API',
        version: '4.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            generateTasks: 'POST /api/generate-tasks',
            generateReport: 'POST /api/generate-report'
        },
        features: [
            'auto-language-detection',
            'intelligent-task-generation',
            'professional-report-generation',
            'bilingual-support',
            'smart-timeout-handling'
        ],
        languageSupport: ['Auto-detect', 'English', 'Turkish'],
        apiKeyConfigured: !!DEEPSEEK_API_KEY,
        note: 'AI report timeout set to 25s with fallback to local professional reports'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Intuiva Project Manager API',
        status: 'running',
        version: '4.0.0',
        features: [
            'Auto language detection from user answers',
            'Professional task generation',
            'Comprehensive report generation (AI + Local)',
            'Smart timeout handling',
            'Beginner to expert support'
        ]
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('🚀 Intuiva Backend Server Running!');
    console.log(`📍 Port: ${PORT}`);
    console.log('✅ Task Generation: Active');
    console.log('📊 Report Generation: Active (with smart timeouts)');
    console.log('🌍 Languages: Auto-detect, English & Turkish');
    console.log('⏱️ AI Timeout: 25s with fallback to local reports');
    console.log(`🔑 API Key: ${DEEPSEEK_API_KEY ? 'Configured ✅' : 'Missing ⚠️'}`);
});
