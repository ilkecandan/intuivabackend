const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Main task generation endpoint
app.post('/api/generate-tasks', async (req, res) => {
    console.log('🚀 Task generation request received');
    
    try {
        const { answers = {}, questions = [], language = 'en', generateReport = false } = req.body;

        // 1. Analyze user input
        const analysis = analyzeUserInput(answers, questions, language);
        
        // 2. Create tasks using AI
        const taskPrompt = createTaskPrompt(answers, questions, language, analysis);
        
        const taskResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: getTaskSystemPrompt(language, analysis.experienceLevel)
                },
                { role: "user", content: taskPrompt }
            ],
            temperature: 0.7,
            max_tokens: 4000,
            stream: false
        }, {
            headers: { 
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        // 3. Parse tasks from AI response
        let tasks = [];
        if (taskResponse.status === 200 && taskResponse.data.choices?.[0]?.message?.content) {
            tasks = parseTasksFromAI(taskResponse.data.choices[0].message.content, language);
        }
        
        // 4. Ensure minimum tasks
        if (tasks.length < 8) {
            const extraTasks = generateExtraTasks(8 - tasks.length, language, analysis);
            tasks = [...tasks, ...extraTasks];
        }
        
        // 5. Personalize tasks
        const personalizedTasks = personalizeTasks(tasks, answers, questions, language);

        // 6. Generate report if requested
        let report = null;
        if (generateReport) {
            report = await generateReportWithRetry(personalizedTasks, answers, questions, language, analysis);
        }

        // 7. Return success
        res.json({
            success: true,
            tasks: personalizedTasks,
            report: report,
            note: getSuccessNote(language, personalizedTasks.length),
            stats: {
                totalTasks: personalizedTasks.length,
                userAnswers: Object.keys(answers).length,
                experienceLevel: analysis.experienceLevel
            }
        });

    } catch (error) {
        console.log('⚠️ Task generation error (using fallback):', error.message);
        
        const { answers = {}, questions = [], language = 'en', generateReport = false } = req.body || {};
        const analysis = analyzeUserInput(answers, questions, language);
        const fallbackTasks = generateSmartFallbackTasks(answers, questions, language, analysis);
        const personalizedTasks = personalizeTasks(fallbackTasks, answers, questions, language);
        
        let report = null;
        if (generateReport) {
            report = generateLocalReport(personalizedTasks, answers, questions, language, analysis);
        }
        
        res.json({
            success: true,
            tasks: personalizedTasks,
            report: report,
            note: language === 'tr' ? 'Akıllı görevler oluşturuldu' : 'Smart tasks created',
            fallback: true,
            stats: {
                totalTasks: personalizedTasks.length,
                userAnswers: Object.keys(answers).length,
                experienceLevel: analysis.experienceLevel
            }
        });
    }
});

// NEW: Separate report generation endpoint
app.post('/api/generate-report', async (req, res) => {
    console.log('📊 Report generation request received');
    
    try {
        const { tasks = [], answers = {}, questions = [], language = 'en' } = req.body;
        
        if (!tasks || tasks.length === 0) {
            throw new Error('No tasks provided for report');
        }
        
        const analysis = analyzeUserInput(answers, questions, language);
        const report = await generateReportWithRetry(tasks, answers, questions, language, analysis);
        
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
        console.log('⚠️ Report generation error:', error.message);
        
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

// ===== HELPER FUNCTIONS =====

function analyzeUserInput(answers, questions, language) {
    const answerEntries = Object.entries(answers);
    const validAnswers = answerEntries.filter(([_, answer]) => 
        answer && answer.trim() && answer !== '[Skipped]' && answer !== '[Not Applicable]'
    );
    
    const answerCount = validAnswers.length;
    let experienceLevel = "beginner";
    
    // Simple experience detection
    if (answerCount > 8) experienceLevel = "expert";
    else if (answerCount > 5) experienceLevel = "experienced";
    else if (answerCount > 2) experienceLevel = "intermediate";
    
    // Collect answer text
    let answerText = "";
    validAnswers.forEach(([index, answer]) => {
        const qIndex = parseInt(index);
        const question = questions[qIndex]?.text || `Q${qIndex + 1}`;
        answerText += `Q: ${question}\nA: ${answer}\n\n`;
    });
    
    // Extract key themes
    const themes = extractKeyThemes(validAnswers.map(([_, a]) => a), language);
    
    return {
        answerCount,
        experienceLevel,
        answerText: answerText || (language === 'tr' ? 'Detaylı cevap yok' : 'No detailed answers'),
        themes,
        language
    };
}

function extractKeyThemes(answers, language) {
    const text = answers.join(' ').toLowerCase();
    const themes = [];
    
    if (language === 'tr') {
        if (text.includes('web') || text.includes('site')) themes.push('web development');
        if (text.includes('mobil') || text.includes('app')) themes.push('mobile app');
        if (text.includes('iş') || text.includes('şirket')) themes.push('business');
        if (text.includes('plan') || text.includes('zaman')) themes.push('planning');
        if (text.includes('ekip') || text.includes('takım')) themes.push('team');
        if (text.includes('bütçe') || text.includes('para')) themes.push('budget');
    } else {
        if (text.includes('web') || text.includes('site')) themes.push('web development');
        if (text.includes('mobile') || text.includes('app')) themes.push('mobile app');
        if (text.includes('business') || text.includes('company')) themes.push('business');
        if (text.includes('plan') || text.includes('time')) themes.push('planning');
        if (text.includes('team') || text.includes('people')) themes.push('team');
        if (text.includes('budget') || text.includes('money')) themes.push('budget');
    }
    
    return themes.length > 0 ? themes : ['general project'];
}

function getTaskSystemPrompt(language, experienceLevel) {
    if (language === 'tr') {
        return `Sen sabırlı ve yardımsever bir proje koçusun. 
Her seviyedeki kullanıcıya uygun görevler oluştur.
SADECE JSON formatında görevler döndür.
Örnek format:
[
  {
    "title": "Görev başlığı",
    "description": "Açıklama",
    "priority": "high/medium/low"
  }
]`;
    }
    
    return `You are a patient and helpful project coach.
Create tasks suitable for users of all experience levels.
Return ONLY tasks in JSON format.
Example format:
[
  {
    "title": "Task title",
    "description": "Description",
    "priority": "high/medium/low"
  }
]`;
}

function createTaskPrompt(answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    let prompt = isTurkish ? 
        "8-12 adet proje yönetimi görevi oluştur:\n\n" :
        "Create 8-12 project management tasks:\n\n";
    
    if (analysis.answerText && analysis.answerText.length > 50) {
        prompt += isTurkish ? "KULLANICI BİLGİLERİ:\n" : "USER INFORMATION:\n";
        prompt += analysis.answerText.substring(0, 800) + "\n\n";
    }
    
    prompt += isTurkish ?
        `Kullanıcı seviyesi: ${analysis.experienceLevel}\n` +
        `Temalar: ${analysis.themes.join(', ')}\n\n` +
        "Lütfen 8-12 adet basit, anlaşılır görev oluştur. " +
        "Görevler JSON formatında olsun." :
        `User level: ${analysis.experienceLevel}\n` +
        `Themes: ${analysis.themes.join(', ')}\n\n` +
        "Please create 8-12 simple, understandable tasks. " +
        "Tasks should be in JSON format.";
    
    return prompt;
}

function parseTasksFromAI(aiResponse, language) {
    try {
        // Clean the response
        const cleanResponse = aiResponse.trim();
        
        // Find JSON array
        const jsonStart = cleanResponse.indexOf('[');
        const jsonEnd = cleanResponse.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
            throw new Error('No JSON array found');
        }
        
        const jsonString = cleanResponse.substring(jsonStart, jsonEnd);
        const tasks = JSON.parse(jsonString);
        
        if (!Array.isArray(tasks)) {
            throw new Error('Response is not an array');
        }
        
        return tasks.map((task, index) => ({
            id: `task_${Date.now()}_${index}`,
            title: task.title || (language === 'tr' ? `Görev ${index + 1}` : `Task ${index + 1}`),
            description: task.description || getDefaultDescription(language, index),
            status: 'todo',
            priority: task.priority || getDefaultPriority(index),
            tags: task.tags || [language === 'tr' ? 'proje' : 'project'],
            estimatedTime: task.estimatedTime || '1-2 hours'
        }));
        
    } catch (error) {
        console.log('AI task parsing failed:', error.message);
        return [];
    }
}

function getDefaultDescription(language, index) {
    const descriptions = language === 'tr' ? [
        'Bu görev projenizin başlangıcı için önemlidir.',
        'Proje ilerlemeniz için temel bir adım.',
        'Bu görev size yol gösterecektir.',
        'Başlamak için iyi bir nokta.',
        'Projenizin bir sonraki aşaması.',
        'Planlamanızı güçlendirecek bir görev.',
        'Kaynaklarınızı organize etmenize yardımcı olacak.',
        'Zaman yönetimi için önemli bir adım.'
    ] : [
        'This task is important for starting your project.',
        'A fundamental step for your project progress.',
        'This task will guide you forward.',
        'A good starting point.',
        'The next phase of your project.',
        'A task that will strengthen your planning.',
        'Will help you organize your resources.',
        'An important step for time management.'
    ];
    
    return descriptions[index % descriptions.length];
}

function getDefaultPriority(index) {
    if (index < 3) return 'high';
    if (index < 7) return 'medium';
    return 'low';
}

function generateExtraTasks(count, language, analysis) {
    const isTurkish = language === 'tr';
    const tasks = [];
    
    for (let i = 0; i < count; i++) {
        tasks.push({
            id: `extra_${Date.now()}_${i}`,
            title: isTurkish ? `Ek Görev ${i + 1}` : `Extra Task ${i + 1}`,
            description: isTurkish ? 
                'Projenizi geliştirmek için bu ek görevi tamamlayın.' :
                'Complete this extra task to develop your project.',
            status: 'todo',
            priority: i < 2 ? 'high' : i < 5 ? 'medium' : 'low',
            tags: isTurkish ? ['ek', 'gelişim'] : ['extra', 'development'],
            estimatedTime: '1-3 hours'
        });
    }
    
    return tasks;
}

function personalizeTasks(tasks, answers, questions, language) {
    const isTurkish = language === 'tr';
    const validAnswers = Object.entries(answers)
        .filter(([_, answer]) => answer && answer !== '[Skipped]' && answer !== '[Not Applicable]');
    
    if (validAnswers.length === 0) {
        return tasks;
    }
    
    return tasks.map((task, index) => {
        const personalizedTask = { ...task };
        
        // Personalize some tasks
        if (index < 3 || index % 4 === 0) {
            const answerIndex = index % validAnswers.length;
            const [qIndex, answer] = validAnswers[answerIndex];
            const questionText = questions[parseInt(qIndex)]?.text || 
                               (isTurkish ? `Soru ${parseInt(qIndex) + 1}` : `Question ${parseInt(qIndex) + 1}`);
            
            if (answer.length > 20) {
                const note = isTurkish ?
                    `\n\n(Not: Bu görev "${questionText}" hakkındaki düşüncelerinizden esinlenmiştir.)` :
                    `\n\n(Note: This task is inspired by your thoughts about "${questionText}")`;
                
                personalizedTask.description += note;
            }
        }
        
        return personalizedTask;
    });
}

function generateSmartFallbackTasks(answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    const tasks = [];
    const baseCount = 10;
    
    const taskTemplates = isTurkish ? [
        { title: 'Proje fikrini yaz', desc: 'Yapmak istediğin projeyi basitçe açıkla.' },
        { title: 'Temel hedefleri belirle', desc: 'Projenden ne beklediğini 2-3 maddede yaz.' },
        { title: 'İlk adımları planla', desc: 'İlk hafta neler yapabileceğini düşün.' },
        { title: 'İhtiyaçları listele', desc: 'Projen için gerekli kaynakları yaz.' },
        { title: 'Zaman çizelgesi oluştur', desc: 'Basit bir zaman planı yap.' },
        { title: 'İlerleme takip yöntemi belirle', desc: 'Nasıl ilerleyeceğini düşün.' },
        { title: 'Geri bildirim al', desc: 'Birinden fikirlerini dinle.' },
        { title: 'Küçük bir deneme yap', desc: 'Projenden küçük bir parçayı test et.' },
        { title: 'Öğrenilenleri not al', desc: 'Yaptıkların hakkında notlar tut.' },
        { title: 'Sonraki adımı planla', desc: 'Bir sonraki aşamayı düşün.' }
    ] : [
        { title: 'Write project idea', desc: 'Simply describe the project you want to do.' },
        { title: 'Define basic goals', desc: 'Write 2-3 things you expect from your project.' },
        { title: 'Plan first steps', desc: 'Think about what you can do in the first week.' },
        { title: 'List requirements', desc: 'Write down resources needed for your project.' },
        { title: 'Create timeline', desc: 'Make a simple time plan.' },
        { title: 'Set progress tracking method', desc: 'Think about how you will track progress.' },
        { title: 'Get feedback', desc: 'Listen to ideas from someone.' },
        { title: 'Do a small test', desc: 'Test a small part of your project.' },
        { title: 'Note learnings', desc: 'Take notes about what you do.' },
        { title: 'Plan next step', desc: 'Think about the next phase.' }
    ];
    
    for (let i = 0; i < baseCount; i++) {
        tasks.push({
            id: `smart_${Date.now()}_${i}`,
            title: taskTemplates[i].title,
            description: taskTemplates[i].desc,
            status: 'todo',
            priority: i < 3 ? 'high' : i < 7 ? 'medium' : 'low',
            tags: isTurkish ? ['akıllı', 'temel'] : ['smart', 'basic'],
            estimatedTime: '1-2 hours'
        });
    }
    
    return tasks;
}

// ===== REPORT GENERATION FUNCTIONS =====

async function generateReportWithRetry(tasks, answers, questions, language, analysis) {
    try {
        return await generateAIReport(tasks, answers, questions, language, analysis);
    } catch (error) {
        console.log('AI report failed, trying local report:', error.message);
        return generateLocalReport(tasks, answers, questions, language, analysis);
    }
}

async function generateAIReport(tasks, answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const highPriorityTasks = tasks.filter(t => t.priority === 'high').length;
    const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium').length;
    
    // Create a comprehensive report prompt
    const reportPrompt = isTurkish ? `
BANA PROFESYONEL BİR PROJE RAPORU OLUŞTUR:

PROJE BİLGİLERİ:
• Toplam Görev: ${totalTasks} (${completedTasks} tamamlanmış, %${completionRate})
• Yüksek Öncelikli: ${highPriorityTasks} görev
• Orta Öncelikli: ${mediumPriorityTasks} görev
• Kullanıcı Deneyimi: ${analysis.experienceLevel} seviye
• Proje Temaları: ${analysis.themes.join(', ')}

ÖNEMLİ GÖREVLER:
${tasks.slice(0, 5).map((t, i) => `${i+1}. ${t.title} (${t.priority} öncelik)`).join('\n')}

KULLANICI GİRDİLERİ:
${analysis.answerText.substring(0, 500)}

RAFOR İÇERİĞİ (MARKDOWN FORMATINDA):
1. **PROJE ÖZETİ** - Genel durum ve temel bulgular
2. **GÖREV ANALİZİ** - Görevlerin durumu ve öncelikleri
3. **PROJE YOL HARİTASI** - İlerleme planı ve zaman çizelgesi
4. **RISK DEĞERLENDİRMESİ** - Potansiyel zorluklar ve çözüm önerileri
5. **TAVSİYELER** - ${analysis.experienceLevel} seviyesi için özel tavsiyeler
6. **SONRAKI ADIMLAR** - Hemen yapılacaklar ve uzun vadeli plan

RAFORU OLUŞTURURKEN:
• Profesyonel ama anlaşılır dil kullan
• Pratik öneriler ve uygulanabilir çözümler sun
• ${analysis.experienceLevel} seviyesine uygun tavsiyeler ver
• Tablolar ve listeler kullan (markdown formatında)
• En az 1000 kelime uzunluğunda olsun

SADECE RAPOR İÇERİĞİNİ DÖNDÜR, BAŞKA ŞEY YAZMA.
` : `
CREATE A PROFESSIONAL PROJECT REPORT FOR ME:

PROJECT INFORMATION:
• Total Tasks: ${totalTasks} (${completedTasks} completed, ${completionRate}%)
• High Priority: ${highPriorityTasks} tasks
• Medium Priority: ${mediumPriorityTasks} tasks
• User Experience: ${analysis.experienceLevel} level
• Project Themes: ${analysis.themes.join(', ')}

KEY TASKS:
${tasks.slice(0, 5).map((t, i) => `${i+1}. ${t.title} (${t.priority} priority)`).join('\n')}

USER INPUTS:
${analysis.answerText.substring(0, 500)}

REPORT CONTENT (IN MARKDOWN FORMAT):
1. **PROJECT SUMMARY** - Overall status and key findings
2. **TASK ANALYSIS** - Task status and priorities
3. **PROJECT ROADMAP** - Progress plan and timeline
4. **RISK ASSESSMENT** - Potential challenges and solutions
5. **RECOMMENDATIONS** - Special advice for ${analysis.experienceLevel} level
6. **NEXT STEPS** - Immediate actions and long-term plan

WHILE CREATING THE REPORT:
• Use professional but understandable language
• Provide practical suggestions and actionable solutions
• Give advice appropriate for ${analysis.experienceLevel} level
• Use tables and lists (in markdown format)
• Make it at least 1000 words long

RETURN ONLY THE REPORT CONTENT, NOTHING ELSE.
`;
    
    const reportResponse = await axios.post(DEEPSEEK_API_URL, {
        model: "deepseek-chat",
        messages: [
            { 
                role: "system", 
                content: isTurkish ? 
                    "Sen üst düzey bir proje yönetimi danışmanısın. Kapsamlı, profesyonel ve anlaşılır proje raporları oluştur. Raporları markdown formatında hazırla. Sadece rapor içeriğini döndür, başka açıklama yapma." :
                    "You are a senior project management consultant. Create comprehensive, professional, and understandable project reports. Prepare reports in markdown format. Return only the report content, no additional explanations."
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
        timeout: 60000
    });

    return reportResponse.data.choices[0].message.content;
}

function generateLocalReport(tasks, answers, questions, language, analysis) {
    const isTurkish = language === 'tr';
    
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const totalTasks = tasks.length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    const highPriorityTasks = tasks.filter(t => t.priority === 'high');
    const mediumPriorityTasks = tasks.filter(t => t.priority === 'medium');
    
    const currentDate = new Date().toLocaleDateString(isTurkish ? 'tr-TR' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    });
    
    let report = isTurkish ? 
        `# 📊 PROJE ANALİZ RAPORU\n\n` :
        `# 📊 PROJECT ANALYSIS REPORT\n\n`;
    
    report += isTurkish ?
        `**Rapor Tarihi:** ${currentDate}\n` :
        `**Report Date:** ${currentDate}\n`;
    
    report += isTurkish ?
        `**Proje Kimliği:** PRJ-${Date.now().toString().slice(-6)}\n\n` :
        `**Project ID:** PRJ-${Date.now().toString().slice(-6)}\n\n`;
    
    report += `---\n\n`;
    
    // 1. PROJECT SUMMARY
    report += isTurkish ?
        `## 1. PROJE ÖZETİ\n\n` :
        `## 1. PROJECT SUMMARY\n\n`;
    
    report += isTurkish ?
        `Bu rapor, **${totalTasks} görev** ve kullanıcı girdileri üzerine hazırlanmıştır. Proje **${analysis.experienceLevel}** seviyesinde bir kullanıcı tarafından yönetiliyor.\n\n` :
        `This report is based on **${totalTasks} tasks** and user inputs. The project is managed by a **${analysis.experienceLevel}** level user.\n\n`;
    
    report += isTurkish ?
        `### 📈 Temel Metrikler\n\n` :
        `### 📈 Key Metrics\n\n`;
    
    report += isTurkish ?
        `| Metrik | Değer |\n|--------|-------|\n` :
        `| Metric | Value |\n|--------|-------|\n`;
    
    report += isTurkish ?
        `| Toplam Görev | ${totalTasks} |\n` :
        `| Total Tasks | ${totalTasks} |\n`;
    
    report += isTurkish ?
        `| Tamamlanan | ${completedTasks} (%${completionRate}) |\n` :
        `| Completed | ${completedTasks} (${completionRate}%) |\n`;
    
    report += isTurkish ?
        `| Yüksek Öncelikli | ${highPriorityTasks.length} |\n` :
        `| High Priority | ${highPriorityTasks.length} |\n`;
    
    report += isTurkish ?
        `| Kullanıcı Katılımı | ${analysis.answerCount} cevap |\n\n` :
        `| User Engagement | ${analysis.answerCount} answers |\n\n`;
    
    // 2. TASK ANALYSIS
    report += isTurkish ?
        `## 2. GÖREV ANALİZİ\n\n` :
        `## 2. TASK ANALYSIS\n\n`;
    
    report += isTurkish ?
        `### 🎯 Yüksek Öncelikli Görevler\n\n` :
        `### 🎯 High Priority Tasks\n\n`;
    
    highPriorityTasks.slice(0, 3).forEach((task, index) => {
        report += isTurkish ?
            `**${index + 1}. ${task.title}**\n` +
            `${task.description.substring(0, 100)}...\n\n` :
            `**${index + 1}. ${task.title}**\n` +
            `${task.description.substring(0, 100)}...\n\n`;
    });
    
    if (highPriorityTasks.length === 0) {
        report += isTurkish ?
            `⚠️ Yüksek öncelikli görev bulunmuyor. İlk 3 görevi yüksek öncelik olarak işaretleyin.\n\n` :
            `⚠️ No high priority tasks. Mark the first 3 tasks as high priority.\n\n`;
    }
    
    report += isTurkish ?
        `### 📋 Öncelik Dağılımı\n\n` :
        `### 📋 Priority Distribution\n\n`;
    
    report += isTurkish ?
        `| Öncelik | Görev Sayısı | Yüzde |\n|---------|--------------|-------|\n` :
        `| Priority | Task Count | Percentage |\n|---------|------------|------------|\n`;
    
    ['high', 'medium', 'low'].forEach(priority => {
        const count = tasks.filter(t => t.priority === priority).length;
        const percentage = Math.round((count / totalTasks) * 100);
        report += isTurkish ?
            `| ${priority === 'high' ? 'Yüksek' : priority === 'medium' ? 'Orta' : 'Düşük'} | ${count} | %${percentage} |\n` :
            `| ${priority.charAt(0).toUpperCase() + priority.slice(1)} | ${count} | ${percentage}% |\n`;
    });
    
    report += `\n`;
    
    // 3. PROJECT ROADMAP
    report += isTurkish ?
        `## 3. PROJE YOL HARİTASI\n\n` :
        `## 3. PROJECT ROADMAP\n\n`;
    
    report += isTurkish ?
        `### 🗓️ Önerilen Zaman Çizelgesi\n\n` :
        `### 🗓️ Recommended Timeline\n\n`;
    
    const roadmap = isTurkish ? [
        { phase: 'Hafta 1-2', focus: 'Planlama ve başlangıç', tasks: 'İlk 3 yüksek öncelikli görev' },
        { phase: 'Hafta 3-4', focus: 'Uygulama ve test', tasks: 'Orta öncelikli görevler' },
        { phase: 'Hafta 5-6', focus: 'Değerlendirme ve iyileştirme', tasks: 'Düşük öncelikli ve ek görevler' }
    ] : [
        { phase: 'Week 1-2', focus: 'Planning and initiation', tasks: 'First 3 high priority tasks' },
        { phase: 'Week 3-4', focus: 'Implementation and testing', tasks: 'Medium priority tasks' },
        { phase: 'Week 5-6', focus: 'Evaluation and improvement', tasks: 'Low priority and extra tasks' }
    ];
    
    roadmap.forEach(item => {
        report += isTurkish ?
            `**${item.phase}**: ${item.focus}\n` +
            `*Odak:* ${item.tasks}\n\n` :
            `**${item.phase}**: ${item.focus}\n` +
            `*Focus:* ${item.tasks}\n\n`;
    });
    
    // 4. RISK ASSESSMENT
    report += isTurkish ?
        `## 4. RİSK DEĞERLENDİRMESİ\n\n` :
        `## 4. RISK ASSESSMENT\n\n`;
    
    const risks = isTurkish ? [
        { risk: 'Kapsam belirsizliği', level: 'Orta', mitigation: 'Görevleri küçük parçalara bölün' },
        { risk: 'Zaman yönetimi', level: 'Yüksek', mitigation: 'Haftalık hedefler belirleyin' },
        { risk: 'Motivasyon kaybı', level: 'Orta', mitigation: 'Küçük başarıları kutlayın' },
        { risk: 'Kaynak yetersizliği', level: 'Düşük', mitigation: 'Ücretsiz araçları keşfedin' }
    ] : [
        { risk: 'Scope uncertainty', level: 'Medium', mitigation: 'Break tasks into smaller parts' },
        { risk: 'Time management', level: 'High', mitigation: 'Set weekly goals' },
        { risk: 'Loss of motivation', level: 'Medium', mitigation: 'Celebrate small wins' },
        { risk: 'Resource limitations', level: 'Low', mitigation: 'Explore free tools' }
    ];
    
    report += isTurkish ?
        `| Risk | Seviye | Azaltma Stratejisi |\n|------|--------|-------------------|\n` :
        `| Risk | Level | Mitigation Strategy |\n|------|-------|-------------------|\n`;
    
    risks.forEach(item => {
        report += `| ${item.risk} | ${item.level} | ${item.mitigation} |\n`;
    });
    
    report += `\n`;
    
    // 5. RECOMMENDATIONS
    report += isTurkish ?
        `## 5. TAVSİYELER\n\n` :
        `## 5. RECOMMENDATIONS\n\n`;
    
    const recommendations = isTurkish ? [
        '**Başlangıç için:** İlk görevi bugün tamamlayın, ne kadar küçük olursa olsun.',
        '**Planlama:** Her gün 15 dakika projenize ayırın.',
        '**İlerleme:** Tamamladığınız her görevi işaretleyin.',
        '**Esneklik:** Planınızı haftalık olarak gözden geçirin ve güncelleyin.',
        '**Destek:** Zorlandığınızda birinden yardım isteyin.'
    ] : [
        '**To start:** Complete the first task today, no matter how small.',
        '**Planning:** Dedicate 15 minutes daily to your project.',
        '**Progress:** Mark every completed task.',
        '**Flexibility:** Review and update your plan weekly.',
        '**Support:** Ask for help when you feel stuck.'
    ];
    
    recommendations.forEach((rec, index) => {
        report += `${index + 1}. ${rec}\n`;
    });
    
    report += `\n`;
    
    // 6. NEXT STEPS
    report += isTurkish ?
        `## 6. SONRAKİ ADIMLAR\n\n` :
        `## 6. NEXT STEPS\n\n`;
    
    const nextSteps = isTurkish ? [
        { action: 'Hemen', task: 'İlk yüksek öncelikli görevi başlatın' },
        { action: 'Bu hafta', task: '3 görevi tamamlayın' },
        { action: 'Bu ay', task: 'Proje yol haritasını takip edin' },
        { action: 'İzleme', task: 'Haftalık ilerlemenizi değerlendirin' }
    ] : [
        { action: 'Immediately', task: 'Start the first high priority task' },
        { action: 'This week', task: 'Complete 3 tasks' },
        { action: 'This month', task: 'Follow the project roadmap' },
        { action: 'Monitoring', task: 'Evaluate your weekly progress' }
    ];
    
    nextSteps.forEach(step => {
        report += isTurkish ?
            `▶️ **${step.action}:** ${step.task}\n` :
            `▶️ **${step.action}:** ${step.task}\n`;
    });
    
    report += `\n---\n\n`;
    
    report += isTurkish ?
        `## 🎯 BAŞARI İPUÇLARI\n\n` :
        `## 🎯 SUCCESS TIPS\n\n`;
    
    const tips = isTurkish ? [
        'Mükemmeliyetçi olmayın - ilerleme mükemmellikten daha önemlidir',
        'Küçük adımlarla başlayın - büyük hedefler küçük adımlarla ulaşılır',
        'Tutarlı olun - düzenli çalışma büyük fark yaratır',
        'Öğrenmeye açık olun - her hata bir öğrenme fırsatıdır',
        'Kendinize karşı nazik olun - herkes başlangıçta öğrenir'
    ] : [
        'Don\'t be perfect - progress is more important than perfection',
        'Start with small steps - big goals are achieved with small steps',
        'Be consistent - regular work makes a big difference',
        'Be open to learning - every mistake is a learning opportunity',
        'Be kind to yourself - everyone learns at the beginning'
    ];
    
    tips.forEach((tip, index) => {
        report += `💡 ${tip}\n`;
    });
    
    report += `\n---\n\n`;
    
    report += isTurkish ?
        `*Bu rapor Intuiva Proje Yöneticisi tarafından otomatik oluşturulmuştur.*\n` +
        `*Rapor Kimliği: RP-${Date.now().toString().slice(-8)}*\n` +
        `*Son güncelleme: ${new Date().toISOString()}*` :
        `*This report was automatically generated by Intuiva Project Manager.*\n` +
        `*Report ID: RP-${Date.now().toString().slice(-8)}*\n` +
        `*Last updated: ${new Date().toISOString()}*`;
    
    return report;
}

function getSuccessNote(language, taskCount) {
    if (language === 'tr') {
        return `✅ ${taskCount} görev başarıyla oluşturuldu! İlk görevle başlayın ve adım adım ilerleyin. 🚀`;
    }
    return `✅ ${taskCount} tasks successfully created! Start with the first task and progress step by step. 🚀`;
}

// Health endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Intuiva Project Manager API',
        version: '2.0.0',
        endpoints: {
            generateTasks: 'POST /api/generate-tasks',
            generateReport: 'POST /api/generate-report',
            health: 'GET /health'
        },
        features: [
            'task-generation',
            'report-generation',
            'bilingual-support',
            'smart-fallbacks',
            'beginner-friendly'
        ],
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log('🚀 Intuiva Backend Server Running!');
    console.log(`📍 Port: ${PORT}`);
    console.log('✅ Task Generation: Active');
    console.log('📊 Report Generation: Active (Both AI and Local)');
    console.log('🌍 Languages: English & Turkish');
    console.log('🎯 Always works with fallbacks');
});
