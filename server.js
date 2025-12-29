const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Intuiva AI Backend',
        version: '2.1.0',
        timestamp: new Date().toISOString(),
        features: ['task-generation', 'project-reports', 'multilingual']
    });
});

// Enhanced task generation with better error handling
app.post('/api/generate-tasks', async (req, res) => {
    console.log('📨 Received task generation request');
    
    try {
        const { answers = {}, questions = [], language = 'en', generateReport = false } = req.body;
        
        // Validate input
        if (!answers || typeof answers !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Invalid answers format'
            });
        }
        
        // Check if we have valid answers
        const validAnswers = Object.values(answers).filter(answer => 
            answer && answer !== '[Skipped]' && answer !== '[Not Applicable]'
        );
        
        if (validAnswers.length === 0) {
            console.log('No valid answers, returning default tasks');
            return res.json({
                success: true,
                tasks: generateDefaultTasks(language),
                report: generateDefaultReport([], answers, language),
                note: "No detailed answers provided - using recommended starter tasks"
            });
        }
        
        // 1. Construct the AI Prompt
        const taskPrompt = constructEnhancedProjectManagerPrompt(answers, questions, language);
        
        console.log('🤖 Calling DeepSeek API...');
        
        // 2. Call DeepSeek API for tasks
        const taskResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: `You are a senior project manager with 15+ years of experience.
                    Your goal: Create actionable Kanban tasks that reflect real-world project management.
                    
                    IMPORTANT: Return ONLY a valid JSON array of tasks. No explanations, no additional text.
                    Each task MUST have: title, description, status ("todo"), priority ("high"/"medium"/"low"), tags array.
                    Use simple IDs like "task_1", "task_2", etc.` 
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
            timeout: 30000
        });

        // 3. Parse tasks
        const generatedTasksText = taskResponse.data.choices[0].message.content;
        console.log('📝 Raw AI response:', generatedTasksText.substring(0, 200) + '...');
        
        const tasks = parseAITasks(generatedTasksText);
        const validatedTasks = validateAndCompleteTasks(tasks, answers, language);

        // 4. Generate report if requested
        let report = null;
        if (generateReport && validatedTasks.length > 0) {
            try {
                report = await generateAIReport(answers, questions, validatedTasks, language);
            } catch (reportError) {
                console.error('Report generation failed:', reportError.message);
                report = generateDefaultReport(validatedTasks, answers, language);
            }
        }

        // 5. Send response
        res.json({ 
            success: true, 
            tasks: validatedTasks,
            report: report,
            note: `Generated ${validatedTasks.length} tasks based on ${validAnswers.length} detailed answers`
        });

    } catch (error) {
        console.error('❌ DeepSeek API Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
        
        const language = req.body?.language || 'en';
        res.json({ 
            success: true, 
            tasks: generateDefaultTasks(language),
            report: generateDefaultReport([], req.body?.answers || {}, language),
            note: "AI service temporarily unavailable - using recommended starter tasks"
        });
    }
});

// Separate endpoint for generating reports only
app.post('/api/generate-report', async (req, res) => {
    try {
        const { answers = {}, questions = [], tasks = [], language = 'en' } = req.body;
        
        const report = await generateAIReport(answers, questions, tasks, language);
        
        res.json({ 
            success: true, 
            report: report,
            note: "AI generated project report"
        });

    } catch (error) {
        console.error('Report generation failed:', error.message);
        const language = req.body?.language || 'en';
        res.json({ 
            success: true, 
            report: generateDefaultReport(req.body?.tasks || [], req.body?.answers || {}, language),
            note: "Using locally generated report"
        });
    }
});

// Test endpoint
app.post('/test-prompt', (req, res) => {
    const { answers, questions, language } = req.body;
    const prompt = constructEnhancedProjectManagerPrompt(answers || {}, questions || [], language || 'en');
    res.json({ prompt: prompt });
});

// Helper Functions
function constructEnhancedProjectManagerPrompt(answers, questions, language) {
    const isTurkish = language === 'tr';
    
    let qaText = "";
    let answerCount = 0;
    
    // Build Q&A text
    Object.entries(answers).forEach(([index, answer]) => {
        const questionIndex = parseInt(index);
        if (questionIndex < questions.length && answer) {
            const question = questions[questionIndex];
            const answerText = answer.trim();
            
            if (answerText && 
                answerText !== '[Skipped]' && 
                answerText !== '[Not Applicable]') {
                answerCount++;
            }
            
            qaText += `Q${parseInt(index) + 1} (${question.category || 'General'}): ${question.text}\n`;
            qaText += `A${parseInt(index) + 1}: ${answer || "(No answer provided)"}\n\n`;
        }
    });
    
    if (isTurkish) {
        return `
PROJE YÖNETİCİSİ OLARAK:
Kullanıcı ${answerCount} soruya detaylı cevap vermiş. Bu cevaplara dayanarak hemen uygulanabilir Kanban görevleri oluştur.

TALİMATLAR:
1. Tam olarak ${Math.max(4, Math.min(answerCount * 2, 12))} uygulanabilir görev oluştur
2. Görevler gerçekçi, adım adım ilerleyen ve proje yönetimi prensiplerine uygun olsun
3. Her görevde: başlık, açıklama, durum ("todo"), öncelik ("high"/"medium"/"low"), etiketler
4. Kullanıcının cevaplarındaki önemli noktalara gönderme yap
5. Türkçe terimler kullan, yerel bağlamı düşün

GÖREV YAPISI:
{
  "id": "görev_1",
  "title": "Görev başlığı",
  "description": "Detaylı açıklama...",
  "status": "todo",
  "priority": "high",
  "tags": ["etiket1", "etiket2"]
}

KULLANICI SORU-CEVAPLARI:
${qaText}

SADECE JSON dizisi döndür, başka hiçbir şey yazma:
`;
    } else {
        return `
AS A PROJECT MANAGER:
User provided ${answerCount} detailed answers. Based on these, create actionable Kanban tasks.

INSTRUCTIONS:
1. Create exactly ${Math.max(4, Math.min(answerCount * 2, 12))} actionable tasks
2. Tasks should be realistic, step-by-step, and follow project management principles
3. Each task must have: title, description, status ("todo"), priority ("high"/"medium"/"low"), tags
4. Reference important points from user's answers
5. Use professional terminology

TASK STRUCTURE:
{
  "id": "task_1",
  "title": "Task title",
  "description": "Detailed description...",
  "status": "todo",
  "priority": "high",
  "tags": ["tag1", "tag2"]
}

USER Q&A:
${qaText}

Return ONLY JSON array, nothing else:
`;
    }
}

// Parse AI tasks with robust error handling
function parseAITasks(text) {
    try {
        const cleanText = text.trim();
        
        // Find JSON array
        const jsonStart = cleanText.indexOf('[');
        const jsonEnd = cleanText.lastIndexOf(']') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
            console.log("No JSON array found in response");
            return [];
        }
        
        const jsonString = cleanText.substring(jsonStart, jsonEnd);
        const tasks = JSON.parse(jsonString);
        
        if (!Array.isArray(tasks)) {
            console.log("Response is not an array");
            return [];
        }
        
        console.log(`✅ Successfully parsed ${tasks.length} tasks`);
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
    
    return tasks.slice(0, 15).map((task, index) => {
        // Ensure task has required fields
        const validatedTask = {
            id: task.id || `task_${Date.now()}_${index}`,
            title: task.title || (isTurkish ? `Görev ${index + 1}` : `Task ${index + 1}`),
            description: task.description || (isTurkish ? 
                'Bu görevin detaylarını ekleyin' : 
                'Add details for this task'),
            status: ['todo', 'inprogress', 'done'].includes(task.status) ? task.status : 'todo',
            priority: ['critical', 'high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
            tags: Array.isArray(task.tags) ? task.tags : [isTurkish ? 'proje' : 'project']
        };
        
        return validatedTask;
    });
}

// Generate sensible default tasks
function generateDefaultTasks(language = 'en') {
    const isTurkish = language === 'tr';
    
    const tasks = [
        {
            id: `default_${Date.now()}_1`,
            title: isTurkish ? 'Proje kapsamını tanımla' : 'Define project scope',
            description: isTurkish ? 
                'Projenin neyi kapsayıp neyi kapsamayacağını netleştir' :
                'Clarify what the project will and will not include',
            status: "todo",
            priority: "high",
            tags: isTurkish ? ['planlama', 'kapsam'] : ['planning', 'scope']
        },
        {
            id: `default_${Date.now()}_2`,
            title: isTurkish ? 'Paydaşları belirle' : 'Identify stakeholders',
            description: isTurkish ? 
                'Projeden etkilenecek kişi ve grupları listeleyerek iletişim planı oluştur' :
                'List people and groups affected by the project and create a communication plan',
            status: "todo",
            priority: "high",
            tags: isTurkish ? ['paydaşlar', 'iletişim'] : ['stakeholders', 'communication']
        },
        {
            id: `default_${Date.now()}_3`,
            title: isTurkish ? 'Başarı kriterlerini belirle' : 'Define success criteria',
            description: isTurkish ? 
                'Projenin başarısını nasıl ölçeceğini belirleyerek somut hedefler oluştur' :
                'Determine how to measure project success with concrete goals',
            status: "todo",
            priority: "medium",
            tags: isTurkish ? ['metrikler', 'hedefler'] : ['metrics', 'goals']
        },
        {
            id: `default_${Date.now()}_4`,
            title: isTurkish ? 'İlk adımları planla' : 'Plan initial steps',
            description: isTurkish ? 
                'Hemen başlayabileceğin ilk 3-5 adımı belirle' :
                'Identify the first 3-5 steps you can take immediately',
            status: "todo",
            priority: "medium",
            tags: isTurkish ? ['eylem', 'başlangıç'] : ['action', 'start']
        }
    ];
    
    // Add more tasks if needed
    if (isTurkish) {
        tasks.push({
            id: `default_${Date.now()}_5`,
            title: 'Riskleri değerlendir',
            description: 'Potansiyel riskleri belirleyerek azaltma stratejileri geliştir',
            status: "todo",
            priority: "medium",
            tags: ['risk', 'planlama']
        });
    } else {
        tasks.push({
            id: `default_${Date.now()}_5`,
            title: 'Assess risks',
            description: 'Identify potential risks and develop mitigation strategies',
            status: "todo",
            priority: "medium",
            tags: ['risk', 'planning']
        });
    }
    
    return tasks;
}

// Generate AI report
async function generateAIReport(answers, questions, tasks, language) {
    const isTurkish = language === 'tr';
    
    try {
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

RAPOR İÇERİĞİ:
1. **Proje Özeti** - Genel bakış ve temel bulgular
2. **Analiz** - Güçlü yönler ve gelişim alanları
3. **Riskler** - Potansiyel riskler ve öneriler
4. **Sonraki Adımlar** - Acil ve orta vadeli eylemler

GÖREVLER:
${tasks.slice(0, 8).map((t, i) => `${i+1}. ${t.title} (${t.priority} öncelik)`).join('\n')}

DETAYLI YANITLAR:
${Object.entries(answers)
    .filter(([_, a]) => a && a !== '[Skipped]' && a !== '[Not Applicable]')
    .slice(0, 3)
    .map(([i, a]) => `• Soru ${parseInt(i)+1}: ${a.substring(0, 80)}...`)
    .join('\n')}

TÜRKÇE olarak markdown formatında rapor oluştur:
` : `
CREATE A PROJECT REPORT:

PROJECT DATA:
• ${totalTasks} total tasks (${completedTasks} completed)
• ${highPriorityTasks} high-priority tasks
• ${answeredQuestions} detailed answers

REPORT CONTENT:
1. **Executive Summary** - Overview and key findings
2. **Analysis** - Strengths and areas for improvement
3. **Risks** - Potential risks and recommendations
4. **Next Steps** - Immediate and mid-term actions

TASKS:
${tasks.slice(0, 8).map((t, i) => `${i+1}. ${t.title} (${t.priority} priority)`).join('\n')}

SAMPLE ANSWERS:
${Object.entries(answers)
    .filter(([_, a]) => a && a !== '[Skipped]' && a !== '[Not Applicable]')
    .slice(0, 3)
    .map(([i, a]) => `• Question ${parseInt(i)+1}: ${a.substring(0, 80)}...`)
    .join('\n')}

Create the report in English using markdown format:
`;
        
        const reportResponse = await axios.post(DEEPSEEK_API_URL, {
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: `You are a senior management consultant creating executive project reports.
                    Create a comprehensive one-page project report with clear sections.
                    Use markdown formatting with **bold** for section headers.
                    Return only the report content, no additional text.` 
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
            timeout: 25000
        });

        return reportResponse.data.choices[0].message.content;
        
    } catch (error) {
        console.error('AI report generation failed:', error.message);
        return generateDefaultReport(tasks, answers, language);
    }
}

// Generate default report
function generateDefaultReport(tasks, answers, language) {
    const isTurkish = language === 'tr';
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'done').length;
    const answeredQuestions = Object.values(answers).filter(a => 
        a && a !== '[Skipped]' && a !== '[Not Applicable]'
    ).length;
    
    if (isTurkish) {
        return `
**Proje Özeti**
Bu rapor, ${answeredQuestions} soru yanıtına ve ${totalTasks} göreve dayanarak oluşturulmuştur. Proje başlangıç aşamasında olup temel çerçeve tanımlanmıştır.

**Analiz**
• **Mevcut Durum**: Proje yapısı temel seviyede tanımlanmış
• **İlerleme**: ${completedTasks} görev tamamlandı (${totalTasks > 0 ? Math.round((completedTasks/totalTasks)*100) : 0}%)
• **Öncelikler**: Yüksek öncelikli görevler belirlenmiş

**Risk Değerlendirmesi**
• **Orta Risk**: Kaynak planlaması ve zaman çizelgesi gerekiyor
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
`;
    } else {
        return `
**Executive Summary**
This report is based on ${answeredQuestions} answered questions and ${totalTasks} defined tasks. The project is in initial phase with basic framework established.

**Analysis**
• **Current Status**: Project structure defined at basic level
• **Progress**: ${completedTasks} tasks completed (${totalTasks > 0 ? Math.round((completedTasks/totalTasks)*100) : 0}%)
• **Priorities**: High-priority tasks identified

**Risk Assessment**
• **Medium Risk**: Need for resource planning and timeline
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
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Intuiva Backend v2.1 running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 DeepSeek API: ${DEEPSEEK_API_KEY ? 'Configured ✅' : 'Missing ❌'}`);
});
