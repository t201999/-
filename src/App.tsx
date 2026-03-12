/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Calendar, 
  Download, 
  FileText, 
  Plus, 
  Trash2, 
  AlertCircle, 
  CheckCircle2,
  Loader2,
  Settings,
  Table as TableIcon
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { 
  Document, 
  Packer, 
  Paragraph, 
  Table, 
  TableCell, 
  TableRow, 
  WidthType, 
  AlignmentType,
  HeadingLevel,
  TextRun
} from 'docx';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface CalendarEvent {
  date: string; // YYYY-MM-DD
  type: 'holiday' | 'exam' | 'other';
  description: string;
}

interface ScheduleRow {
  week: number;
  date: string;
  topic: string;
  description: string;
  note: string;
  isHoliday: boolean;
  isExam: boolean;
}

// --- Constants ---

const WEEKDAYS = [
  { label: '星期一', value: 1 },
  { label: '星期二', value: 2 },
  { label: '星期三', value: 3 },
  { label: '星期四', value: 4 },
  { label: '星期五', value: 5 },
  { label: '星期六', value: 6 },
  { label: '星期日', value: 0 },
];

export default function App() {
  const [ocrText, setOcrText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [startDate, setStartDate] = useState('2026-02-11');
  const [selectedWeekday, setSelectedWeekday] = useState(1); // Monday
  const [totalWeeks, setTotalWeeks] = useState(18);
  const [courseName, setCourseName] = useState('新課程');
  const [selectedGrade, setSelectedGrade] = useState('高一');
  const [ruleExamTriangle, setRuleExamTriangle] = useState(true);
  const [ruleHolidayColor, setRuleHolidayColor] = useState(true);
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [manualEdits, setManualEdits] = useState<Record<number, { topic?: string, description?: string }>>({});

  // --- File Handling ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // --- Gemini Parsing Logic ---

  const parseCalendar = async () => {
    if (!ocrText.trim() && !file) return;
    
    setIsParsing(true);
    try {
      const apiKey = userApiKey || process.env.GEMINI_API_KEY || '';
      if (!apiKey) {
        alert("請先在設定中輸入 Gemini API Key");
        setIsParsing(false);
        return;
      }
      const ai = new GoogleGenAI({ apiKey });
      
      let contents: any;

      if (file) {
        const base64Data = await fileToBase64(file);
        contents = {
          parts: [
            {
              inlineData: {
                mimeType: file.type,
                data: base64Data
              }
            },
            {
              text: `
                請解析這份行事曆 PDF，並提取出與「${selectedGrade}」學生相關的所有重要日程。
                包含：
                1. 國定假日、校定放假日（通常為橘色儲存格）。
                2. 考試日期：期中考、期末考、學測、分科測驗、模擬考等（三角符號 △ 通常代表考試）。
                3. 重要典禮與活動：開學日、休業式、畢業典禮（特別是高三）、校外教學。
                
                請特別注意：
                - 如果某個事件註明了特定年級，請判斷是否與目前選擇的「${selectedGrade}」相關。
                - 請輸出為 JSON 格式，包含一個 events 陣列，每個物件有 date (YYYY-MM-DD), type ('holiday' | 'exam' | 'other'), description。
                - description 欄位請務必包含具體的活動名稱（例如：「第一次期中考」、「休業式」、「畢業典禮」、「校外教學」）。
                - 如果有開學日資訊，也請一併提取。
              `
            }
          ]
        };
      } else {
        contents = `
          請解析以下校園行事曆文本，並提取出與「${selectedGrade}」學生相關的所有重要日程。
          包含：
          1. 國定假日、校定放假日。
          2. 考試日期：期中考、期末考、學測、分科測驗、模擬考等。
          3. 重要典禮與活動：開學日、休業式、畢業典禮（特別是高三）、校外教學。
          
          請特別注意：
          - 如果某個事件註明了特定年級，請判斷是否與目前選擇的「${selectedGrade}」相關。
          - 請輸出為 JSON 格式，包含一個 events 陣列，每個物件有 date (YYYY-MM-DD), type ('holiday' | 'exam' | 'other'), description。
          - description 欄位請務必包含具體的活動名稱（例如：「第一次期中考」、「休業式」、「畢業典禮」、「校外教學」）。
          - 如果有開學日資訊，也請一併提取。
          
          行事曆文本：
          ${ocrText}
        `;
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              events: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING, description: "日期，格式 YYYY-MM-DD" },
                    type: { type: Type.STRING, enum: ["holiday", "exam", "other"] },
                    description: { type: Type.STRING }
                  },
                  required: ["date", "type", "description"]
                }
              },
              suggestedStartDate: { type: Type.STRING, description: "建議的開學日期 YYYY-MM-DD" }
            }
          }
        }
      });

      const result = JSON.parse(response.text);
      if (result.events) setEvents(result.events);
      if (result.suggestedStartDate) setStartDate(result.suggestedStartDate);
    } catch (error) {
      console.error("Parsing error:", error);
      alert("解析失敗，請檢查輸入內容或稍後再試。");
    } finally {
      setIsParsing(false);
    }
  };

  // --- Schedule Generation ---

  const schedule = useMemo(() => {
    const rows: ScheduleRow[] = [];
    const start = new Date(startDate);
    
    // Adjust start date to the first occurrence of the selected weekday
    let current = new Date(start);
    while (current.getDay() !== selectedWeekday) {
      current.setDate(current.getDate() + 1);
    }

    for (let i = 1; i <= totalWeeks; i++) {
      const dateObj = new Date(current);
      const displayDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
      
      // Get all events for the entire week (7 days starting from current)
      const weekEvents: CalendarEvent[] = [];
      const weekStart = new Date(current);
      const weekEnd = new Date(current);
      weekEnd.setDate(weekEnd.getDate() + 6);

      events.forEach(e => {
        const eventDate = new Date(e.date);
        if (eventDate >= weekStart && eventDate <= weekEnd) {
          weekEvents.push(e);
        }
      });
      
      const dateStr = dateObj.toISOString().split('T')[0];
      const dayEvents = events.filter(e => e.date === dateStr);
      
      let isHoliday = dayEvents.some(e => e.type === 'holiday');
      let isExam = weekEvents.some(e => e.type === 'exam');
      
      // Filter notes to ensure requested keywords are prioritized/included
      const note = weekEvents
        .map(e => {
          const d = new Date(e.date);
          const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
          // Include date for exams as requested
          if (e.description.includes('考') || e.type === 'exam') {
            return `${dateLabel} ${e.description}`;
          }
          return e.description;
        })
        .join(', ');

      // Apply predefined rules if enabled
      if (ruleExamTriangle && note.includes('△')) isExam = true;
      if (ruleHolidayColor && (note.includes('橘色') || note.includes('假日'))) isHoliday = true;

      const edits = manualEdits[i] || {};

      rows.push({
        week: i,
        date: displayDate,
        topic: edits.topic !== undefined ? edits.topic : (isHoliday ? '放假' : (isExam ? '考試週' : '')),
        description: edits.description || '',
        note: note,
        isHoliday,
        isExam
      });

      current.setDate(current.getDate() + 7);
    }
    return rows;
  }, [startDate, selectedWeekday, totalWeeks, events, ruleExamTriangle, ruleHolidayColor, manualEdits]);

  // --- Word Export ---

  const exportToWord = async () => {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            text: `${courseName} 教學進度表`,
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({ text: "" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ 
                    shading: { fill: "F2F2F2" },
                    children: [new Paragraph({ text: "週次", alignment: AlignmentType.CENTER, style: "Heading2" })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "F2F2F2" },
                    children: [new Paragraph({ text: "日期", alignment: AlignmentType.CENTER, style: "Heading2" })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "F2F2F2" },
                    children: [new Paragraph({ text: "課程進度", alignment: AlignmentType.CENTER, style: "Heading2" })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "F2F2F2" },
                    children: [new Paragraph({ text: "說明", alignment: AlignmentType.CENTER, style: "Heading2" })] 
                  }),
                  new TableCell({ 
                    shading: { fill: "F2F2F2" },
                    children: [new Paragraph({ text: "備註", alignment: AlignmentType.CENTER, style: "Heading2" })] 
                  }),
                ],
              }),
              ...schedule.map(row => new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ text: row.week.toString(), alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ text: row.date, alignment: AlignmentType.CENTER })] }),
                  new TableCell({ children: [new Paragraph({ text: row.topic })] }),
                  new TableCell({ children: [new Paragraph({ text: row.description })] }),
                  new TableCell({ children: [new Paragraph({ text: row.note })] }),
                ],
              })),
            ],
          }),
        ],
      }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${courseName}_教學進度表.docx`);
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#2D2926] font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#2D2926]/10 pb-6">
          <div>
            <h1 className="text-4xl font-serif italic tracking-tight">教學時程產生器</h1>
            <p className="text-sm uppercase tracking-widest opacity-60 mt-2 font-mono">Syllabus Generator v1.0</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-white border border-[#2D2926]/10 rounded-full px-4 py-2 shadow-sm">
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">API Key</span>
              <input 
                type="password"
                value={userApiKey}
                onChange={(e) => {
                  setUserApiKey(e.target.value);
                  localStorage.setItem('gemini_api_key', e.target.value);
                }}
                placeholder="輸入 Gemini API Key..."
                className="bg-transparent border-none p-0 text-xs w-32 focus:ring-0"
              />
            </div>
            <button 
              onClick={exportToWord}
              className="flex items-center gap-2 px-6 py-3 bg-[#2D2926] text-white rounded-full hover:bg-opacity-90 transition-all shadow-lg shadow-black/10"
            >
              <Download size={18} />
              匯出 Word
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Inputs */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Step 1: Calendar Input */}
            <section className="bg-white p-6 rounded-3xl border border-[#2D2926]/5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText size={20} className="text-[#F27D26]" />
                <h2 className="font-serif text-xl italic">1. 解析行事曆</h2>
              </div>
              
              <div className="space-y-4">
                <div className="relative group">
                  <input 
                    type="file" 
                    accept="application/pdf"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className={cn(
                    "border-2 border-dashed rounded-2xl p-6 text-center transition-all",
                    file ? "border-[#F27D26] bg-[#F27D26]/5" : "border-[#2D2926]/10 group-hover:border-[#F27D26]/50"
                  )}>
                    {file ? (
                      <div className="flex flex-col items-center gap-2">
                        <CheckCircle2 className="text-[#F27D26]" size={24} />
                        <p className="text-sm font-medium truncate max-w-full">{file.name}</p>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setFile(null); }}
                          className="text-[10px] uppercase tracking-widest text-red-500 font-bold"
                        >
                          移除檔案
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 opacity-40">
                        <Plus size={24} />
                        <p className="text-xs font-bold uppercase tracking-widest">上傳行事曆 PDF</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-[#2D2926]/5"></span>
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold opacity-30">
                    <span className="bg-white px-2">或貼上文字</span>
                  </div>
                </div>

                <textarea 
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  placeholder="請貼上行事曆的 OCR 文字內容..."
                  className="w-full h-32 p-4 bg-[#F5F5F0] rounded-2xl border-none focus:ring-2 focus:ring-[#F27D26]/20 resize-none text-sm"
                />
              </div>

              <button 
                onClick={parseCalendar}
                disabled={isParsing || (!ocrText && !file)}
                className="w-full py-3 bg-[#F27D26] text-white rounded-2xl font-medium hover:bg-opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isParsing ? <Loader2 className="animate-spin" size={18} /> : <Calendar size={18} />}
                {isParsing ? '解析中...' : 'AI 自動解析'}
              </button>
            </section>

            {/* Step 2: Course Settings */}
            <section className="bg-white p-6 rounded-3xl border border-[#2D2926]/5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings size={20} className="text-[#5A5A40]" />
                <h2 className="font-serif text-xl italic">2. 課程設定</h2>
              </div>
              
              <div className="space-y-3">
                <label className="block text-xs uppercase tracking-wider font-bold opacity-50">課程名稱</label>
                <input 
                  type="text" 
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  className="w-full p-3 bg-[#F5F5F0] rounded-xl border-none text-sm"
                />
              </div>

              <div className="space-y-3">
                <label className="block text-xs uppercase tracking-wider font-bold opacity-50">適用年級</label>
                <select 
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  className="w-full p-3 bg-[#F5F5F0] rounded-xl border-none text-sm appearance-none"
                >
                  <option value="高一">高一</option>
                  <option value="高二">高二</option>
                  <option value="高三">高三</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="block text-xs uppercase tracking-wider font-bold opacity-50">上課星期</label>
                  <select 
                    value={selectedWeekday}
                    onChange={(e) => setSelectedWeekday(Number(e.target.value))}
                    className="w-full p-3 bg-[#F5F5F0] rounded-xl border-none text-sm appearance-none"
                  >
                    {WEEKDAYS.map(day => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="block text-xs uppercase tracking-wider font-bold opacity-50">總週次</label>
                  <input 
                    type="number" 
                    value={totalWeeks}
                    onChange={(e) => setTotalWeeks(Number(e.target.value))}
                    className="w-full p-3 bg-[#F5F5F0] rounded-xl border-none text-sm"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-xs uppercase tracking-wider font-bold opacity-50">開學日期</label>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full p-3 bg-[#F5F5F0] rounded-xl border-none text-sm"
                />
              </div>
            </section>

            {/* Step 3: Event List */}
            <section className="bg-white p-6 rounded-3xl border border-[#2D2926]/5 shadow-sm space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AlertCircle size={20} className="text-red-500" />
                  <h2 className="font-serif text-xl italic">3. 例外日期</h2>
                </div>
                <button 
                  onClick={() => setEvents([...events, { date: '', type: 'holiday', description: '新事件' }])}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>

              {/* Predefined Rules */}
              <div className="p-4 bg-[#F5F5F0] rounded-2xl space-y-3">
                <p className="text-[10px] uppercase tracking-widest font-bold opacity-50 mb-1">自動識別規則</p>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={ruleExamTriangle}
                    onChange={(e) => setRuleExamTriangle(e.target.checked)}
                    className="w-4 h-4 rounded border-[#2D2926]/20 text-[#F27D26] focus:ring-[#F27D26]/20"
                  />
                  <span className="text-sm group-hover:opacity-80 transition-opacity">△ 符號自動標記為考試</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={ruleHolidayColor}
                    onChange={(e) => setRuleHolidayColor(e.target.checked)}
                    className="w-4 h-4 rounded border-[#2D2926]/20 text-[#F27D26] focus:ring-[#F27D26]/20"
                  />
                  <span className="text-sm group-hover:opacity-80 transition-opacity">橘色/假日標記為放假</span>
                </label>
              </div>
              
              <div className="max-h-60 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {events.length === 0 && (
                  <p className="text-sm text-center py-8 opacity-40 italic">尚未解析或新增任何日期</p>
                )}
                {events.map((event, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-3 bg-[#F5F5F0] rounded-xl group">
                    <input 
                      type="date" 
                      value={event.date}
                      onChange={(e) => {
                        const newEvents = [...events];
                        newEvents[idx].date = e.target.value;
                        setEvents(newEvents);
                      }}
                      className="bg-transparent border-none p-0 text-xs w-28"
                    />
                    <select 
                      value={event.type}
                      onChange={(e) => {
                        const newEvents = [...events];
                        newEvents[idx].type = e.target.value as any;
                        setEvents(newEvents);
                      }}
                      className="bg-transparent border-none p-0 text-xs w-20"
                    >
                      <option value="holiday">假日</option>
                      <option value="exam">考試</option>
                      <option value="other">其他</option>
                    </select>
                    <input 
                      type="text" 
                      value={event.description}
                      onChange={(e) => {
                        const newEvents = [...events];
                        newEvents[idx].description = e.target.value;
                        setEvents(newEvents);
                      }}
                      className="bg-transparent border-none p-0 text-xs flex-1"
                    />
                    <button 
                      onClick={() => setEvents(events.filter((_, i) => i !== idx))}
                      className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column: Preview Table */}
          <div className="lg:col-span-8">
            <div className="bg-white rounded-[2rem] border border-[#2D2926]/5 shadow-xl overflow-hidden min-h-[600px] flex flex-col">
              <div className="p-8 border-b border-[#2D2926]/5 flex items-center justify-between bg-[#FDFCFB]">
                <div className="flex items-center gap-3">
                  <TableIcon size={24} className="text-[#2D2926]" />
                  <h2 className="font-serif text-2xl italic">預覽進度表</h2>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono opacity-50">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400"></span> 假日</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"></span> 考試</span>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-8">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-[#2D2926]">
                      <th className="py-4 px-4 text-left font-serif italic text-sm uppercase tracking-widest opacity-50 w-16">週次</th>
                      <th className="py-4 px-4 text-left font-serif italic text-sm uppercase tracking-widest opacity-50 w-24">日期</th>
                      <th className="py-4 px-4 text-left font-serif italic text-sm uppercase tracking-widest opacity-50">課程進度</th>
                      <th className="py-4 px-4 text-left font-serif italic text-sm uppercase tracking-widest opacity-50">說明</th>
                      <th className="py-4 px-4 text-left font-serif italic text-sm uppercase tracking-widest opacity-50">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2D2926]/5">
                    {schedule.map((row, rowIndex) => (
                      <tr 
                        key={row.week} 
                        className={cn(
                          "transition-colors hover:bg-[#F5F5F0]/50",
                          row.isHoliday && "bg-orange-50/50",
                          row.isExam && "bg-blue-50/50"
                        )}
                      >
                        <td className="py-5 px-4 font-mono text-sm">{row.week}</td>
                        <td className="py-5 px-4 font-mono text-sm">{row.date}</td>
                        <td className="py-5 px-4">
                          <input 
                            type="text"
                            value={row.topic}
                            onChange={(e) => {
                              setManualEdits(prev => ({
                                ...prev,
                                [row.week]: { ...prev[row.week], topic: e.target.value }
                              }));
                            }}
                            className="w-full bg-transparent border-none p-0 focus:ring-0 text-sm font-medium"
                            placeholder="進度..."
                          />
                        </td>
                        <td className="py-5 px-4">
                          <input 
                            type="text"
                            value={row.description}
                            onChange={(e) => {
                              setManualEdits(prev => ({
                                ...prev,
                                [row.week]: { ...prev[row.week], description: e.target.value }
                              }));
                            }}
                            className="w-full bg-transparent border-none p-0 focus:ring-0 text-sm"
                            placeholder="說明..."
                          />
                        </td>
                        <td className="py-5 px-4">
                          <div className="flex items-center gap-2">
                            {row.isHoliday && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-[10px] rounded-full font-bold uppercase">Holiday</span>}
                            {row.isExam && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] rounded-full font-bold uppercase">Exam</span>}
                            <span className="text-xs opacity-60">{row.note}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              <div className="p-6 bg-[#F5F5F0]/30 border-t border-[#2D2926]/5 text-center">
                <p className="text-xs opacity-40 font-mono italic">
                  * 點擊主題欄位可直接編輯內容 (預覽模式)
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(45, 41, 38, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(45, 41, 38, 0.2);
        }
      `}} />
    </div>
  );
}
