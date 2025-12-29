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
            language = 'en', 
            generateReport = false 
        } = req.body;

        // 1. Analyze user input
        const analysis = analyzeUserInput(answers, questions, language);
        console.log(`📊 Analysis: ${analysis.experienceLevel} level, ${analysis.answerCount} answers`);
        
        // 2. Generate tasks
        let tasks = [];
        try {
            tasks = await generateAITasks(answers, questions, language, analysis);
        } catch (aiError) {
            console.log('🤖 AI task generation failed, using fallback:', aiError.message);
            tasks = generateFallbackTasks(language, analysis);
        }
        
        // 3. Ensure minimum tasks
        if (tasks.length < 8) {
            const extraTasks = generateExtraTasks(8 - tasks.length, language, analysis);
            tasks = [...tasks, ...extraTasks];
        }
        
        // 4. Personalize tasks
        const personalizedTasks = personalizeTasks(tasks, answers, questions, language);
        
        // 5. Generate report if requested
        let report = null;
        if (generateReport) {
            try {
                report = await generateAIReport(personalizedTasks, answers, questions, language, analysis);
            } catch (reportError) {
                console.log('📋 AI report failed, using local report:', reportError.message);
                report = generateLocalReport(personalizedTasks, answers, questions, language, analysis);
            }
        }

        // 6. Return success
        res.json({
            success: true,
            tasks: personalizedTasks,
            report: report,
            note: getSuccessNote(language, personalizedTasks.length, analysis.experienceLevel),
            stats: {
                totalTasks: personalizedTasks.length,
                userAnswers: analysis.answerCount,
                experienceLevel: analysis.experienceLevel,
                themes: analysis.themes
            }
        });

    } catch (error) {
        console.log('🔥 Critical error in task generation:', error.message);
        
        // Always return success with fallback
        const { answers = {}, questions = [], language = 'en', generateReport = false } = req.body || {};
        const analysis = analyzeUserInput(answers, questions, language);
        const fallbackTasks = generateFallbackTasks(language, analysis);
        const personalizedTasks = personalizeTasks(fallbackTasks, answers, questions, language);
        
        let report = null;
        if (generateReport) {
            report = generateLocalReport(personalizedTasks, answers, questions, language, analysis);
        }
        
        res.json({
            success: true,
            tasks: personalizedTasks,
            report: report,
            note: language === 'tr' 
                ? 'Güvenilir görevler oluşturuldu' 
                : 'Reliable tasks created',
            fallback: true,
            stats: {
                totalTasks: personalizedTasks.length,
                userAnswers: analysis.answerCount,
                experienceLevel: analysis.experienceLevel
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
            language = 'en' 
        } = req.body;
        
        if (!tasks || tasks.length === 0) {
            return res.json({
                success: true,
                report: generateEmptyReport(language),
                note: language === 'tr' ? 'Görev olmadığı için temel rapor' : 'Basic report as no tasks',
                fallback: true
            });
        }
        
        const analysis = analyzeUserInput(answers, questions, language);
        let report;
        
        try {
            report = await generateAIReport(tasks, answers, questions, language, analysis);
        } catch (aiError) {
            console.log('📋 AI report failed, using local:', aiError.message);
            report = generateLocalReport(tasks, answers, questions, language, analysis);
        }
        
        res.json({
            success: true,
            report: report,
            note: language === 'tr' ? 'Proje raporu oluşturuldu' : 'Project report generated',
            stats: {
                tasksInReport: tasks.length,
                reportLength: report.length
            }
        });
        
    } catch (error) {
        console.log('🔥 Report generation error:', error.message);
        
        const { tasks = [], answers = {}, questions = [], language = 'en' } = req.body || {};
        const analysis = analyzeUserInput(answers, questions, language);
        const report = generateLocalReport(tasks, answers, questions, language, analysis);
        
        res.json({
            success: true,
            report: report,
            note: language === 'tr' ? 'Yerel rapor oluşturuldu' : 'Local report generated',
            fallback: true,
            stats: {
                tasksInReport: tasks.length,
                reportLength: report.length
            }
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

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
    
    // Determine experience level
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
        const question = questions[qIndex]?.text || (language === 'tr' ? `Soru ${qIndex + 1}` : `Question ${qIndex + 1}`);
        qaText += `${language === 'tr' ? 'Soru' : 'Question'}: ${question}\n`;
        qaText += `${language === 'tr' ? 'Cevap' : 'Answer'}: ${answer}\n\n`;
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
        if (text.includes('web') || text.includes('site') || text.includes('internet')) themes.add('web development');
        if (text.includes('mobil') || text.includes('telefon') || text.includes('uygulama')) themes.add('mobile app');
        if (text.includes('iş') || text.includes('şirket') || text.includes('ticaret')) themes.add('business');
        if (text.includes('plan') || text.includes('zaman') || text.includes('takvim')) themes.add('planning');
        if (text.includes('ekip') || text.includes('takım') || text.includes('çalışan')) themes.add('team');
        if (text.includes('bütçe') || text.includes('para') || text.includes('maliyet')) themes.add('budget');
        if (text.includes('e-ticaret') || text.includes('satış') || text.includes('alışveriş')) themes.add('e-commerce');
        if (text.includes('tasarım') || text.includes('görsel') || text.includes('ui')) themes.add('design');
    } else {
        if (text.includes('web') || text.includes('site') || text.includes('internet')) themes.add('web development');
        if (text.includes('mobile') || text.includes('phone') || text.includes('app')) themes.add('mobile app');
        if (text.includes('business') || text.includes('company') || text.includes('commerce')) themes.add('business');
        if (text.includes('plan') || text.includes('time') || text.includes('schedule')) themes.add('planning');
        if (text.includes('team') || text.includes('people') || text.includes('employee')) themes.add('team');
        if (text.includes('budget') || text.includes('money') || text.includes('cost')) themes.add('budget');
        if (text.includes('e-commerce') || text.includes('sales') || text.includes('shop')) themes.add('e-commerce');
        if (text.includes('design') || text.includes('visual') || text.includes('ui')) themes.add('design');
    }
    
    if (themes.size === 0) {
        themes.add(language === 'tr' ? 'genel proje' : 'general project');
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
        max_tokens: 3000
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
        return `Sen çok yardımsever bir proje koçusun. ${experienceLevel} seviyesindeki kullanıcıya özel görevler oluştur.
        
Görev formatı (JSON array):
[
  {
    "title": "Görev başlığı (Türkçe)",
    "description": "Net ve yardımsever açıklama",
    "priority": "high/medium/low"
  }
]

Kurallar:
1. SADECE JSON döndür
2. 8-12 görev oluştur
3. Türkçe kullan
4. ${experienceLevel} seviyesine uygun`;
    }
    
    return `You are a very helpful project coach. Create tasks specifically for ${experienceLevel} level user.
    
Task format (JSON array):
[
  {
    "title": "Task title (English)",
    "description": "Clear and helpful description",
    "priority": "high/medium/low"
  }
]

Rules:
1. Return ONLY JSON
2. Create 8-12 tasks
3. Use English
4. Suitable for ${experienceLevel} level`;
}

function createTaskPrompt(answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    let prompt = isTurkish ?
        `Lütfen ${analysis.experienceLevel} seviyesinde bir kullanıcı için proje yönetimi görevleri oluştur.\n\n` :
        `Please create project management tasks for a ${analysis.experienceLevel} level user.\n\n`;
    
    if (analysis.qaText && analysis.qaText.length > 50) {
        prompt += isTurkish ? "KULLANICI BİLGİLERİ:\n" : "USER INFORMATION:\n";
        prompt += analysis.qaText.substring(0, 1000) + "\n\n";
    }
    
    prompt += isTurkish ?
        `Proje Temaları: ${analysis.themes.join(', ')}\n\n` +
        "8-12 adet basit, anlaşılır, uygulanabilir görev oluştur. " +
        "Görevler JSON formatında olsun. Örnek:\n" +
        `[
  {"title": "Proje fikrini yaz", "description": "Projenin amacını 2-3 cümlede açıkla", "priority": "high"},
  {"title": "İlk adımı planla", "description": "İlk hafta için bir plan yap", "priority": "medium"}
]` :
        `Project Themes: ${analysis.themes.join(', ')}\n\n` +
        "Create 8-12 simple, understandable, actionable tasks. " +
        "Tasks should be in JSON format. Example:\n" +
        `[
  {"title": "Write project idea", "description": "Describe the project purpose in 2-3 sentences", "priority": "high"},
  {"title": "Plan first step", "description": "Make a plan for the first week", "priority": "medium"}
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
            id: `ai_${Date.now()}_${index}`,
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
            'Bu görev projenizin başlangıcı için önemlidir.',
            'Proje ilerlemeniz için temel bir adım.',
            'Bu görev size yol gösterecek ve ilerlemenizi sağlayacak.',
            'Başlamak için mükemmel bir nokta.',
            'Projenizin bir sonraki aşamasına geçiş görevi.',
            'Planlamanızı güçlendirecek önemli bir görev.',
            'Kaynaklarınızı organize etmenize yardımcı olacak.',
            'Zaman yönetimi için kritik bir adım.'
        ];
        return descriptions[index % descriptions.length];
    }
    
    const descriptions = [
        'This task is important for starting your project.',
        'A fundamental step for your project progress.',
        'This task will guide you and help you make progress.',
        'A perfect starting point.',
        'Task to transition to the next phase of your project.',
        'An important task that will strengthen your planning.',
        'Will help you organize your resources.',
        'A critical step for time management.'
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
        { title: 'Proje fikrini yaz', desc: 'Yapmak istediğin projeyi basitçe açıkla. Ne yapmak istiyorsun?' },
        { title: 'Temel hedefleri belirle', desc: 'Projenden ne beklediğini 2-3 maddede yaz. Neyi başarmak istiyorsun?' },
        { title: 'İlk adımları planla', desc: 'İlk hafta neler yapabileceğini düşün ve bir plan oluştur.' },
        { title: 'İhtiyaçları listele', desc: 'Projen için gerekli araçları, kaynakları ve yardımcıları yaz.' },
        { title: 'Zaman çizelgesi oluştur', desc: 'Projen için basit bir zaman planı yap. Her şeyi aynı anda yapmaya çalışma.' },
        { title: 'İlerleme takip yöntemi belirle', desc: 'Nasıl ilerleyeceğini düşün. Haftalık notlar alabilirsin.' },
        { title: 'Geri bildirim al', desc: 'Proje fikrini bir arkadaşına veya aile üyesine anlat ve geri bildirim al.' },
        { title: 'Küçük bir deneme yap', desc: 'Projenden küçük bir parçayı test etmek için bir şeyler yap.' },
        { title: 'Öğrenilenleri not al', desc: 'Yaptıkların ve öğrendiklerin hakkında notlar tut.' },
        { title: 'Sonraki adımı planla', desc: 'Bir sonraki aşamada ne yapacağını planla. Küçük adımlarla ilerle.' }
    ] : [
        { title: 'Write project idea', desc: 'Simply describe the project you want to do. What do you want to create?' },
        { title: 'Define basic goals', desc: 'Write 2-3 things you expect from your project. What do you want to achieve?' },
        { title: 'Plan first steps', desc: 'Think about what you can do in the first week and create a plan.' },
        { title: 'List requirements', desc: 'Write down the tools, resources, and help you will need for your project.' },
        { title: 'Create timeline', desc: 'Make a simple time plan for your project. Don\'t try to do everything at once.' },
        { title: 'Set progress tracking method', desc: 'Think about how you will track progress. You can take weekly notes.' },
        { title: 'Get feedback', desc: 'Explain your project idea to a friend or family member and get feedback.' },
        { title: 'Do a small test', desc: 'Do something to test a small part of your project.' },
        { title: 'Note learnings', desc: 'Take notes about what you do and learn.' },
        { title: 'Plan next step', desc: 'Plan what you will do in the next phase. Take small steps forward.' }
    ];
    
    const template = taskTemplates[index % taskTemplates.length];
    
    return {
        id: `fallback_${Date.now()}_${index}`,
        title: template.title,
        description: template.desc,
        status: 'todo',
        priority: index < 3 ? 'high' : index < 7 ? 'medium' : 'low',
        tags: isTurkish ? ['akıllı', 'temel'] : ['smart', 'basic'],
        estimatedTime: '1-2 hours',
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
                'Projenizi daha da geliştirmek için bu ek görevi tamamlayın.' :
                'Complete this extra task to further develop your project.',
            status: 'todo',
            priority: 'low',
            tags: isTurkish ? ['ek', 'geliştirme'] : ['extra', 'development'],
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
        // Only personalize some tasks
        if (taskIndex < 3 || taskIndex % 4 === 0) {
            const answerIndex = taskIndex % validAnswers.length;
            const [qIndex, answer] = validAnswers[answerIndex];
            const qNumber = parseInt(qIndex);
            const questionText = questions[qNumber]?.text || 
                               (isTurkish ? `Soru ${qNumber + 1}` : `Question ${qNumber + 1}`);
            
            if (answer.length > 20) {
                const note = isTurkish ?
                    `\n\n💡 *Not: Bu görev "${questionText}" hakkındaki düşüncelerinizden esinlenmiştir.*` :
                    `\n\n💡 *Note: This task is inspired by your thoughts about "${questionText}".*`;
                
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

async function generateAIReport(tasks, answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const highPriorityTasks = tasks.filter(t => t.priority === 'high').length;
    const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium').length;
    
    // Prepare user answers for the report
    let userAnswersText = '';
    const validAnswers = Object.entries(answers)
        .filter(([_, answer]) => answer && answer !== '[Skipped]' && answer !== '[Not Applicable]');
    
    if (validAnswers.length > 0) {
        userAnswersText = isTurkish ? '**KULLANICI CEVAPLARI:**\n\n' : '**USER ANSWERS:**\n\n';
        validAnswers.slice(0, 3).forEach(([index, answer]) => {
            const qNumber = parseInt(index);
            const question = questions[qNumber]?.text || (isTurkish ? `Soru ${qNumber + 1}` : `Question ${qNumber + 1}`);
            userAnswersText += `**${question}**\n${answer.substring(0, 150)}${answer.length > 150 ? '...' : ''}\n\n`;
        });
    }
    
    const reportPrompt = isTurkish ? `
BANA PROFESYONEL VE DETAYLI BİR PROJE RAPORU OLUŞTUR:

**PROJE BİLGİLERİ:**
- Toplam Görev: ${totalTasks} (${completedTasks} tamamlanmış, %${completionRate} tamamlanma)
- Yüksek Öncelikli Görevler: ${highPriorityTasks}
- Orta Öncelikli Görevler: ${mediumPriorityTasks}
- Kullanıcı Deneyim Seviyesi: ${analysis.experienceLevel}
- Proje Temaları: ${analysis.themes.join(', ')}

**ÖNEMLİ GÖREVLER:**
${tasks.slice(0, 5).map((t, i) => `${i+1}. **${t.title}** (${t.priority} öncelik)`).join('\n')}

${userAnswersText}

**RAFOR İÇERİĞİ İÇİN TALİMATLAR:**

1. **PROJE ÖZETİ** - Genel durum, temel bulgular ve metrikler
2. **GÖREV ANALİZİ** - Görev durumları, öncelik dağılımı ve tamamlanma oranları
3. **PROJE YOL HARİTASI** - 6 haftalık detaylı ilerleme planı ve zaman çizelgesi
4. **RİSK ANALİZİ** - Potansiyel riskler, zorluklar ve çözüm önerileri (tablo formatında)
5. **${analysis.experienceLevel.toUpperCase()} SEVİYESİ İÇİN TAVSİYELER** - Seviyeye özel pratik öneriler
6. **EYLEM PLANI** - Hemen, kısa vadeli ve orta vadeli eylem adımları
7. **BAŞARI İPUÇLARI** - Motivasyon ve verimlilik için öneriler

**FORMAT:** Markdown formatında, profesyonel ama anlaşılır Türkçe ile yaz.
**UZUNLUK:** En az 1200 kelime (kapsamlı ve detaylı olsun)
**YAPISI:** Başlıklar, alt başlıklar, tablolar ve listeler kullan.

SADECE RAPOR İÇERİĞİNİ DÖNDÜR, BAŞKA AÇIKLAMA YAPMA.
` : `
CREATE A PROFESSIONAL AND DETAILED PROJECT REPORT FOR ME:

**PROJECT INFORMATION:**
- Total Tasks: ${totalTasks} (${completedTasks} completed, ${completionRate}% completion)
- High Priority Tasks: ${highPriorityTasks}
- Medium Priority Tasks: ${mediumPriorityTasks}
- User Experience Level: ${analysis.experienceLevel}
- Project Themes: ${analysis.themes.join(', ')}

**KEY TASKS:**
${tasks.slice(0, 5).map((t, i) => `${i+1}. **${t.title}** (${t.priority} priority)`).join('\n')}

${userAnswersText}

**REPORT CONTENT INSTRUCTIONS:**

1. **PROJECT SUMMARY** - Overall status, key findings and metrics
2. **TASK ANALYSIS** - Task statuses, priority distribution and completion rates
3. **PROJECT ROADMAP** - Detailed 6-week progress plan and timeline
4. **RISK ANALYSIS** - Potential risks, challenges and solution suggestions (in table format)
5. **RECOMMENDATIONS FOR ${analysis.experienceLevel.toUpperCase()} LEVEL** - Level-specific practical advice
6. **ACTION PLAN** - Immediate, short-term and medium-term action steps
7. **SUCCESS TIPS** - Suggestions for motivation and productivity

**FORMAT:** Write in markdown format, using professional but understandable English.
**LENGTH:** At least 1200 words (comprehensive and detailed)
**STRUCTURE:** Use headings, subheadings, tables and lists.

RETURN ONLY THE REPORT CONTENT, NO ADDITIONAL EXPLANATIONS.
`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
        model: "deepseek-chat",
        messages: [
            { 
                role: "system", 
                content: isTurkish ?
                    "Sen üst düzey bir proje yönetimi danışmanısın. Kapsamlı, profesyonel, anlaşılır ve detaylı proje raporları oluştur. Raporları markdown formatında hazırla. Başlıklar, tablolar ve listeler kullan. Sadece rapor içeriğini döndür, başka hiçbir şey yazma." :
                    "You are a senior project management consultant. Create comprehensive, professional, understandable and detailed project reports. Prepare reports in markdown format. Use headings, tables and lists. Return only the report content, nothing else."
            },
            { role: "user", content: reportPrompt }
        ],
        temperature: 0.6,
        max_tokens: 4000
    }, {
        headers: { 
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
            'Content-Type': 'application/json'
        },
        timeout: 45000
    });
    
    if (response.status !== 200 || !response.data.choices?.[0]?.message?.content) {
        throw new Error('AI report generation failed');
    }
    
    return response.data.choices[0].message.content;
}

function generateLocalReport(tasks, answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const highPriorityTasks = tasks.filter(t => t.priority === 'high');
    const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium');
    const lowPriorityTasks = tasks.filter(t => t.priority === 'low');
    
    const currentDate = new Date();
    const formattedDate = currentDate.toLocaleDateString(isTurkish ? 'tr-TR' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    });
    
    let report = isTurkish ? 
        `# 📊 PROJE ANALİZ RAPORU\n\n` :
        `# 📊 PROJECT ANALYSIS REPORT\n\n`;
    
    report += `**${isTurkish ? 'Rapor Tarihi' : 'Report Date'}:** ${formattedDate}\n`;
    report += `**${isTurkish ? 'Proje Kimliği' : 'Project ID'}:** PRJ-${Date.now().toString().slice(-8)}\n`;
    report += `**${isTurkish ? 'Kullanıcı Seviyesi' : 'User Level'}:** ${analysis.experienceLevel}\n\n`;
    
    report += `---\n\n`;
    
    // 1. PROJECT SUMMARY
    report += isTurkish ? 
        `## 1. 📈 PROJE ÖZETİ\n\n` :
        `## 1. 📈 PROJECT SUMMARY\n\n`;
    
    report += isTurkish ?
        `Bu rapor, **${totalTasks} görev** ve kullanıcı girdileri üzerine hazırlanmış kapsamlı bir analizdir. Proje **${analysis.experienceLevel}** seviyesinde bir kullanıcı tarafından yönetiliyor.\n\n` :
        `This report is a comprehensive analysis based on **${totalTasks} tasks** and user inputs. The project is managed by a **${analysis.experienceLevel}** level user.\n\n`;
    
    report += `### ${isTurkish ? 'Temel Metrikler' : 'Key Metrics'}\n\n`;
    report += `| ${isTurkish ? 'Metrik' : 'Metric'} | ${isTurkish ? 'Değer' : 'Value'} |\n`;
    report += `|-------|--------|\n`;
    report += `| ${isTurkish ? 'Toplam Görev' : 'Total Tasks'} | ${totalTasks} |\n`;
    report += `| ${isTurkish ? 'Tamamlanan' : 'Completed'} | ${completedTasks} (${completionRate}%) |\n`;
    report += `| ${isTurkish ? 'Yüksek Öncelikli' : 'High Priority'} | ${highPriorityTasks.length} |\n`;
    report += `| ${isTurkish ? 'Orta Öncelikli' : 'Medium Priority'} | ${mediumPriorityTasks.length} |\n`;
    report += `| ${isTurkish ? 'Düşük Öncelikli' : 'Low Priority'} | ${lowPriorityTasks.length} |\n`;
    report += `| ${isTurkish ? 'Kullanıcı Katılımı' : 'User Engagement'} | ${analysis.answerCount} ${isTurkish ? 'cevap' : 'answers'} |\n\n`;
    
    // 2. TASK ANALYSIS
    report += isTurkish ? 
        `## 2. 📋 GÖREV ANALİZİ\n\n` :
        `## 2. 📋 TASK ANALYSIS\n\n`;
    
    if (highPriorityTasks.length > 0) {
        report += isTurkish ?
            `### 🎯 Yüksek Öncelikli Görevler (Öncelikle Bunları Tamamlayın)\n\n` :
            `### 🎯 High Priority Tasks (Complete These First)\n\n`;
        
        highPriorityTasks.slice(0, 4).forEach((task, index) => {
            report += `**${index + 1}. ${task.title}**\n`;
            report += `> ${task.description.substring(0, 120)}${task.description.length > 120 ? '...' : ''}\n\n`;
        });
    }
    
    // Priority Distribution Chart
    report += isTurkish ?
        `### 📊 Öncelik Dağılımı\n\n` :
        `### 📊 Priority Distribution\n\n`;
    
    const priorityData = [
        { priority: isTurkish ? 'Yüksek' : 'High', count: highPriorityTasks.length, color: '🔴' },
        { priority: isTurkish ? 'Orta' : 'Medium', count: mediumPriorityTasks.length, color: '🟡' },
        { priority: isTurkish ? 'Düşük' : 'Low', count: lowPriorityTasks.length, color: '🟢' }
    ];
    
    priorityData.forEach(item => {
        const percentage = totalTasks > 0 ? Math.round((item.count / totalTasks) * 100) : 0;
        report += `${item.color} **${item.priority}:** ${item.count} görev (${percentage}%)\n`;
    });
    
    report += `\n`;
    
    // 3. PROJECT ROADMAP
    report += isTurkish ? 
        `## 3. 🗺️ PROJE YOL HARİTASI\n\n` :
        `## 3. 🗺️ PROJECT ROADMAP\n\n`;
    
    const roadmap = isTurkish ? [
        { phase: 'Hafta 1-2', title: 'Planlama ve Başlangıç', focus: 'Yüksek öncelikli görevleri tamamla, temel planı oluştur' },
        { phase: 'Hafta 3-4', title: 'Uygulama ve Geliştirme', focus: 'Orta öncelikli görevler, ilk prototip/test' },
        { phase: 'Hafta 5-6', title: 'İyileştirme ve Tamamlama', focus: 'Düşük öncelikli görevler, geri bildirim değerlendirme' },
        { phase: 'Hafta 7+', title: 'Değerlendirme ve Sonraki Adımlar', focus: 'Proje değerlendirmesi, gelecek planları' }
    ] : [
        { phase: 'Week 1-2', title: 'Planning and Initiation', focus: 'Complete high priority tasks, create basic plan' },
        { phase: 'Week 3-4', title: 'Implementation and Development', focus: 'Medium priority tasks, first prototype/test' },
        { phase: 'Week 5-6', title: 'Improvement and Completion', focus: 'Low priority tasks, feedback evaluation' },
        { phase: 'Week 7+', title: 'Evaluation and Next Steps', focus: 'Project evaluation, future plans' }
    ];
    
    roadmap.forEach(item => {
        report += `### ${item.phase}: ${item.title}\n`;
        report += `📌 ${item.focus}\n\n`;
    });
    
    // 4. RISK ASSESSMENT
    report += isTurkish ? 
        `## 4. ⚠️ RİSK DEĞERLENDİRMESİ\n\n` :
        `## 4. ⚠️ RISK ASSESSMENT\n\n`;
    
    const risks = isTurkish ? [
        { risk: 'Kapsam Kayması', level: '🟡 Orta', impact: isTurkish ? 'Proje hedeflerinin değişmesi' : 'Changing project goals', mitigation: isTurkish ? 'Haftalık kapsam gözden geçirmesi yapın' : 'Do weekly scope reviews' },
        { risk: 'Zaman Sıkışması', level: '🔴 Yüksek', impact: isTurkish ? 'Teslim tarihlerinin kaçırılması' : 'Missing deadlines', mitigation: isTurkish ? 'Gerçekçi zaman çizelgeleri oluşturun' : 'Create realistic timelines' },
        { risk: 'Motivasyon Kaybı', level: '🟡 Orta', impact: isTurkish ? 'Proje ilerlemesinin yavaşlaması' : 'Slowed project progress', mitigation: isTurkish ? 'Küçük başarıları kutlayın' : 'Celebrate small wins' },
        { risk: 'Kaynak Yetersizliği', level: '🟢 Düşük', impact: isTurkish ? 'Görevlerin tamamlanamaması' : 'Tasks not completed', mitigation: isTurkish ? 'Ücretsiz araçları keşfedin' : 'Explore free tools' }
    ] : [
        { risk: 'Scope Creep', level: '🟡 Medium', impact: 'Changing project goals', mitigation: 'Do weekly scope reviews' },
        { risk: 'Time Pressure', level: '🔴 High', impact: 'Missing deadlines', mitigation: 'Create realistic timelines' },
        { risk: 'Loss of Motivation', level: '🟡 Medium', impact: 'Slowed project progress', mitigation: 'Celebrate small wins' },
        { risk: 'Resource Limitations', level: '🟢 Low', impact: 'Tasks not completed', mitigation: 'Explore free tools' }
    ];
    
    report += `| ${isTurkish ? 'Risk' : 'Risk'} | ${isTurkish ? 'Seviye' : 'Level'} | ${isTurkish ? 'Etki' : 'Impact'} | ${isTurkish ? 'Azaltma Stratejisi' : 'Mitigation Strategy'} |\n`;
    report += `|------|--------|--------|------------------|\n`;
    
    risks.forEach(item => {
        report += `| ${item.risk} | ${item.level} | ${item.impact} | ${item.mitigation} |\n`;
    });
    
    report += `\n`;
    
    // 5. RECOMMENDATIONS
    report += isTurkish ? 
        `## 5. 💡 ${analysis.experienceLevel.toUpperCase()} SEVİYESİ İÇİN TAVSİYELER\n\n` :
        `## 5. 💡 RECOMMENDATIONS FOR ${analysis.experienceLevel.toUpperCase()} LEVEL\n\n`;
    
    const recommendations = getRecommendationsByLevel(analysis.experienceLevel, language);
    recommendations.forEach((rec, index) => {
        report += `${index + 1}. ${rec}\n`;
    });
    
    report += `\n`;
    
    // 6. ACTION PLAN
    report += isTurkish ? 
        `## 6. 🎯 EYLEM PLANI\n\n` :
        `## 6. 🎯 ACTION PLAN\n\n`;
    
    const actions = isTurkish ? [
        { timeframe: '🚨 Hemen (Bugün)', action: 'İlk yüksek öncelikli görevi başlatın' },
        { timeframe: '📅 Bu Hafta', action: 'En az 3 görevi tamamlayın' },
        { timeframe: '📆 Bu Ay', action: 'Yol haritasının ilk iki aşamasını takip edin' },
        { timeframe: '🔍 İzleme', action: 'Haftalık ilerleme değerlendirmesi yapın' }
    ] : [
        { timeframe: '🚨 Immediately (Today)', action: 'Start the first high priority task' },
        { timeframe: '📅 This Week', action: 'Complete at least 3 tasks' },
        { timeframe: '📆 This Month', action: 'Follow the first two phases of the roadmap' },
        { timeframe: '🔍 Monitoring', action: 'Do weekly progress evaluation' }
    ];
    
    actions.forEach(item => {
        report += `### ${item.timeframe}\n`;
        report += `${item.action}\n\n`;
    });
    
    // 7. SUCCESS TIPS
    report += isTurkish ? 
        `## 7. 🌟 BAŞARI İPUÇLARI\n\n` :
        `## 7. 🌟 SUCCESS TIPS\n\n`;
    
    const tips = isTurkish ? [
        '**Mükemmeliyetçi olmayın:** İlerleme mükemmellikten daha önemlidir.',
        '**Küçük başlayın:** Büyük hedefler küçük adımlarla ulaşılır.',
        '**Tutarlı olun:** Günde 15 dakika bile büyük fark yaratır.',
        '**Esnek kalın:** Planlar değişebilir, uyum sağlamayı öğrenin.',
        '**Kutlayın:** Her başarıyı, ne kadar küçük olursa olsun kutlayın.',
        '**Öğrenin:** Her hata bir öğrenme fırsatıdır.',
        '**Paylaşın:** İlerlemenizi başkalarıyla paylaşın, motive olun.'
    ] : [
        '**Don\'t be perfect:** Progress is more important than perfection.',
        '**Start small:** Big goals are achieved with small steps.',
        '**Be consistent:** Even 15 minutes a day makes a big difference.',
        '**Stay flexible:** Plans can change, learn to adapt.',
        '**Celebrate:** Celebrate every success, no matter how small.',
        '**Learn:** Every mistake is a learning opportunity.',
        '**Share:** Share your progress with others, stay motivated.'
    ];
    
    tips.forEach(tip => {
        report += `✅ ${tip}\n`;
    });
    
    report += `\n---\n\n`;
    
    report += isTurkish ?
        `*Bu rapor Intuiva Proje Yöneticisi tarafından otomatik olarak oluşturulmuştur.*\n` +
        `*Rapor Kodu: RP-${Date.now().toString().slice(-6)}*\n` +
        `*Son güncelleme: ${new Date().toISOString()}*` :
        `*This report was automatically generated by Intuiva Project Manager.*\n` +
        `*Report Code: RP-${Date.now().toString().slice(-6)}*\n` +
        `*Last updated: ${new Date().toISOString()}*`;
    
    return report;
}

function getRecommendationsByLevel(level, language) {
    const isTurkish = language === 'tr';
    
    if (level === 'beginner') {
        return isTurkish ? [
            'Çok hızlı ilerlemeye çalışmayın - küçük adımlarla başlayın',
            'Her gün projenize sadece 15-20 dakika ayırın',
            'Anlamadığınız konularda internetten basit açıklamalar arayın',
            'İlk görevinizi bugün mutlaka tamamlayın',
            'Kendinize karşı sabırlı olun - herkes başlangıçta öğrenir',
            'Basit araçlar kullanın - karmaşık yazılımlarla başlamayın',
            'Her tamamladığınız görevi kutlayın'
        ] : [
            'Don\'t try to go too fast - start with small steps',
            'Dedicate only 15-20 minutes daily to your project',
            'Search for simple explanations online for things you don\'t understand',
            'Definitely complete your first task today',
            'Be patient with yourself - everyone learns at the beginning',
            'Use simple tools - don\'t start with complex software',
            'Celebrate every completed task'
        ];
    } else if (level === 'intermediate') {
        return isTurkish ? [
            'Haftalık hedefler belirleyin ve takip edin',
            'Zaman yönetimi tekniklerini uygulayın (Pomodoro gibi)',
            'Daha ileri araçları kullanmayı öğrenin',
            'Geri bildirim almaya açık olun',
            'Proje dokümantasyonu oluşturun',
            'Risk yönetimi planı yapın',
            'Net ölçülebilir hedefler belirleyin'
        ] : [
            'Set and track weekly goals',
            'Apply time management techniques (like Pomodoro)',
            'Learn to use more advanced tools',
            'Be open to receiving feedback',
            'Create project documentation',
            'Make a risk management plan',
            'Set clear measurable goals'
        ];
    } else {
        return isTurkish ? [
            'Stratejik planlama yapın - uzun vadeli hedefler belirleyin',
            'Kaynak optimizasyonu yapın',
            'Profesyonel proje yönetimi metodolojilerini uygulayın',
            'KPI\'lar ve performans metrikleri belirleyin',
            'Ekip yönetimi ve delegasyon becerilerinizi geliştirin',
            'Sürekli iyileştirme kültürü oluşturun',
            'Mentorluk yaparak bilginizi paylaşın'
        ] : [
            'Do strategic planning - set long-term goals',
            'Optimize resources',
            'Apply professional project management methodologies',
            'Set KPIs and performance metrics',
            'Develop team management and delegation skills',
            'Create a continuous improvement culture',
            'Share your knowledge through mentoring'
        ];
    }
}

function generateEmptyReport(language) {
    const isTurkish = language === 'tr';
    
    return isTurkish ?
        `# 📊 PROJE RAPORU\n\n` +
        `**Henüz görev oluşturulmadı.**\n\n` +
        `Başlamak için:\n` +
        `1. Soruları cevaplayın\n` +
        `2. Görevler oluşturun\n` +
        `3. İlk göreve başlayın\n\n` +
        `*Küçük başla, büyük düşün!* 🚀` :
        `# 📊 PROJECT REPORT\n\n` +
        `**No tasks created yet.**\n\n` +
        `To get started:\n` +
        `1. Answer the questions\n` +
        `2. Generate tasks\n` +
        `3. Start the first task\n\n` +
        `*Start small, think big!* 🚀`;
}

function getSuccessNote(language, taskCount, experienceLevel) {
    if (language === 'tr') {
        return `✅ ${taskCount} görev başarıyla oluşturuldu! (${experienceLevel} seviyesi) 🎯\n` +
               `İlk görevle başlayın ve adım adım ilerleyin. Her adım sizi başarıya yaklaştırır! 🚀`;
    }
    
    return `✅ ${taskCount} tasks successfully created! (${experienceLevel} level) 🎯\n` +
           `Start with the first task and progress step by step. Each step brings you closer to success! 🚀`;
}

// ==================== SERVER SETUP ====================

// Health endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Intuiva Project Manager API',
        version: '3.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            generateTasks: 'POST /api/generate-tasks',
            generateReport: 'POST /api/generate-report'
        },
        features: [
            'intelligent-task-generation',
            'comprehensive-report-generation',
            'bilingual-support',
            'smart-fallbacks',
            'experience-level-adaptation'
        ],
        languageSupport: ['English', 'Turkish'],
        apiKeyConfigured: !!DEEPSEEK_API_KEY
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Intuiva Project Manager API',
        status: 'running',
        version: '3.0.0',
        documentation: {
            generateTasks: 'POST /api/generate-tasks with {answers, questions, language, generateReport}',
            generateReport: 'POST /api/generate-report with {tasks, answers, questions, language}'
        }
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('🚀 Intuiva Backend Server Running!');
    console.log(`📍 Port: ${PORT}`);
    console.log('✅ Task Generation: Active');
    console.log('📊 Report Generation: Active (AI + Local)');
    console.log('🌍 Languages: English & Turkish');
    console.log('🎯 Always works with smart fallbacks');
    console.log(`🔑 API Key: ${DEEPSEEK_API_KEY ? 'Configured ✅' : 'Missing ⚠️'}`);
});
