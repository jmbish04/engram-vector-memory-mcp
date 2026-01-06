import React, { useState, useEffect, useRef } from 'react';
import { 
  Brain, 
  Search, 
  Send, 
  Activity, 
  Database, 
  Sparkles, 
  Terminal, 
  Cpu, 
  Clock, 
  Tag, 
  Zap,
  MessageSquare,
  Wand2,
  Bot
} from 'lucide-react';
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// --- Utility: Class Name Merger ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// --- Sanitizer API Helper ---
// Uses the Worker's sanitize endpoint

const callSanitize = async (text: string): Promise<string> => {
  try {
    const res = await fetch('/api/ai/sanitize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!res.ok) {
        // Fallback to local regex if server fails
        return text.replace(/[[\]"{}]/g, '');
    }

    const data = await res.json();
    return data.result || text;
  } catch (error) {
    console.error("Sanitizer API Error:", error);
    return text.replace(/[[\]"{}]/g, '');
  }
};

// --- AI API Helper ---
// Uses the Worker's AIProvider.generateText endpoint
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callAI = async (prompt: string, system?: string, provider: string = "worker-ai", options?: any) => {
  try {
    const res = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt,
        system,
        provider,
        ...options
      })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'AI request failed');
    }

    const data = await res.json();
    return data.response || "No response from AI.";
  } catch (error) {
    console.error("AI API Error:", error);
    throw error;
  }
};

// --- TYPES ---
interface Memory {
  id: string;
  text: string;
  tags: string[];
  score?: number;
  created_at: string;
  source_app: string;
}

// Interface for raw API response items
interface ApiMemory {
    id: string;
    text: string;
    tags?: string; // Often comes as stringified JSON from DB
    score?: number;
    created_at: string;
    source_app?: string;
}

interface RewrittenSearchResult {
  originalQuery: string;
  rewrittenQuery: string;
  vectorResults?: {
    matches: Array<{
      id: string;
      score: number;
      metadata?: Record<string, unknown>; // Fixed: Replaced 'any' with 'unknown'
    }>;
  };
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'process' | 'error';
  message: string;
}

// --- COMPONENTS ---

const Card = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <div className={cn("rounded-xl border border-zinc-800 bg-zinc-950/50 text-zinc-100 shadow-sm backdrop-blur-sm", className)}>
    {children}
  </div>
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "default" | "outline" | "ghost" | "secondary";
    size?: "default" | "sm" | "icon";
}

const Button = ({ className, variant = "default", size = "default", ...props }: ButtonProps) => {
  const variants = {
    default: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 shadow-[0_0_15px_-3px_rgba(255,255,255,0.2)]",
    outline: "border border-zinc-800 bg-transparent hover:bg-zinc-800 text-zinc-100",
    ghost: "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100",
    secondary: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
  };
  const sizes = {
    default: "h-10 px-4 py-2",
    sm: "h-8 rounded-md px-3 text-xs",
    icon: "h-10 w-10",
  };
  return (
    <button 
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
};

// Fixed: Changed empty interface to type alias
type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = ({ className, ...props }: InputProps) => (
  <input
    className={cn(
      "flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm ring-offset-zinc-950 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 text-zinc-100",
      className
    )}
    {...props}
  />
);

interface BadgeProps {
    children: React.ReactNode;
    className?: string;
    variant?: "default" | "outline" | "success";
}

const Badge = ({ children, className, variant = "default" }: BadgeProps) => {
  const variants = {
    default: "border-transparent bg-zinc-800 text-zinc-100 hover:bg-zinc-800/80",
    outline: "text-zinc-400 border-zinc-700",
    success: "border-transparent bg-emerald-900/30 text-emerald-400 border border-emerald-800",
  };
  return (
    <div className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", variants[variant], className)}>
      {children}
    </div>
  );
};

// --- Rewritten Search API Helper ---
// Uses the Worker's rewritten vector search endpoint
const callRewrittenSearch = async (
  queries: string[],
  context?: Record<string, unknown>, // Fixed: Replaced 'any' with 'Record<string, unknown>'
  topK: number = 5,
  provider: string = "worker-ai"
): Promise<RewrittenSearchResult[]> => {
  try {
    const res = await fetch('/api/search/rewritten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries,
        context,
        topK,
        provider
      })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Rewritten search failed');
    }

    const data = await res.json();
    return data.results || [];
  } catch (error) {
    console.error("Rewritten search API Error:", error);
    throw error;
  }
};

// --- MAIN APPLICATION ---

export default function MemoryCommandCenter() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<'capture' | 'recall' | 'ask'>('capture');
  const [searchMode, setSearchMode] = useState<'basic' | 'smart'>('basic');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 'init', timestamp: new Date().toLocaleTimeString(), type: 'info', message: 'System initialized. Connected to Worker.' }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // AI States
  const [suggestedTags, setSuggestedTags] = useState<string[]>(['coding', 'architecture', 'refactor', 'todo']);
  const [isTagging, setIsTagging] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatResponse, setChatResponse] = useState("");
  const [isChatting, setIsChatting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Connect to SSE Logs
  useEffect(() => {
    const eventSource = new EventSource('/api/sse/logs');
    
    eventSource.onmessage = (e) => {
        try {
            const logData = JSON.parse(e.data);
            setLogs(prev => [...prev, logData]);
        } catch (err) {
            console.error("Failed to parse log", err);
        }
    };

    eventSource.onerror = () => {
        eventSource.close();
    };

    return () => eventSource.close();
  }, []);

  // Add a new log
  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36),
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    }]);
  };

  // Action: Save Memory
  const handleSave = async () => {
    if (!input.trim()) return;
    
    setIsProcessing(true);
    
    try {
        const res = await fetch('/api/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              text: input, 
              source_app: 'web-client',
              session_id: 'browser-session-1'
            })
        });

        if (res.ok) {
            setInput("");
        }
    } catch {
        // Ignored to satisfy no-unused-vars, logging handled by UI state
    } finally {
        setIsProcessing(false);
    }
  };

  // Action: Auto Tag with AI
  const handleAutoTag = async () => {
    if (!input.trim()) return;
    setIsTagging(true);

    try {
        const prompt = `Analyze the following text and generate 5 concise, relevant, lowercase tags (kebab-case if needed).\nText: "${input}"`;

        const schema = {
          type: "object",
          properties: {
            tags: {
              type: "array",
              items: { type: "string" },
              description: "List of relevant tags"
            }
          },
          required: ["tags"]
        };

        const systemPrompt = "You are a tagging system. Output strictly valid JSON.";
        
        // Pass schema as options to callAI, which sends it to backend
        const response = await callAI(prompt, systemPrompt, "worker-ai", { schema });
        
        // Parse JSON response - backend should now return valid JSON string matching schema
        let tags: string[] = [];
        try {
             // If backend used generateStructured, response might already be an object if callAI parsed it
             // But callAI currently returns data.response which is usually string from generateText.
             // If we update backend to handle schema in generateText or call generateStructured, 
             // we need to know what to expect.
             // Assuming backend generateText with schema returns a JSON string.
             const parsed = typeof response === 'string' ? JSON.parse(response) : response;
             if (parsed.tags && Array.isArray(parsed.tags)) {
                 tags = parsed.tags;
             }
        } catch {
             // Fallback
             console.warn("Structured tag parsing failed, trying text fallback");
             const cleanJson = typeof response === 'string' ? await callSanitize(response) : "";
             tags = typeof cleanJson === 'string' ? cleanJson.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
        }

        if (tags.length > 0) {
            setSuggestedTags(tags);
        } else {
            setSuggestedTags(['general']);
        }
    } catch (e) {
        console.error("Auto-tag failed:", e);
        setSuggestedTags(['general']);
    } finally {
        setIsTagging(false);
    }
  };

  // Action: Ask AI
  const handleAskAI = async () => {
    if (!chatInput.trim()) return;
    setIsChatting(true);
    setChatResponse("");
    
    try {
        const context = JSON.stringify(memories.map(m => ({ text: m.text, tags: m.tags, created: m.created_at })));
        const systemPrompt = `You are a professional ADHD coach, a smart memory assistant. You have access to the user's recent memories: ${context}. Answer the user's question using this context if applicable, or general knowledge if not. Be concise, helpful, and friendly.`;
        
        const response = await callAI(chatInput, systemPrompt, "worker-ai");
        setChatResponse(response);
    } catch {
        setChatResponse("AI unavailable. Please try again.");
    } finally {
        setIsChatting(false);
    }
  };

  // Action: Search
  useEffect(() => {
      const doSearch = async () => {
          if (!query.trim()) {
              setMemories([]);
              return;
          }

          try {
              if (searchMode === 'smart') {
                  // Smart search: split by commas and use rewritten search
                  const queries = query.split(',').map(q => q.trim()).filter(q => q.length > 0);
                  if (queries.length === 0) return;

                  addLog('process', `AI rewriting ${queries.length} queries for smart search...`);

                  const results = await callRewrittenSearch(
                      queries,
                      { tags: suggestedTags }, // Use available context
                      5,
                      "worker-ai"
                  );

                  // Flatten results from multiple queries
                  const allMemories: Memory[] = [];
                  results.forEach((result: RewrittenSearchResult) => {
                      if (result.vectorResults?.matches) {
                          const memories = result.vectorResults.matches.map((match) => ({
                              id: match.id,
                              text: `Query: "${result.originalQuery}" → "${result.rewrittenQuery}"`,
                              tags: ['smart-search'],
                              score: match.score,
                              created_at: 'Just searched',
                              source_app: 'ai-enhanced'
                          }));
                          allMemories.push(...memories);
                      }
                  });

                  // Remove duplicates and sort by score
                  const uniqueMemories = allMemories
                      .filter((mem, index, self) => index === self.findIndex(m => m.id === mem.id))
                      .sort((a, b) => (b.score || 0) - (a.score || 0));

                  setMemories(uniqueMemories);
                  addLog('success', `Smart search found ${uniqueMemories.length} results`);

              } else {
                  // Basic search: single query
                  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
                  const data = await res.json();
                  if (Array.isArray(data)) {
                      // Fixed: Cast m to ApiMemory instead of any
                      setMemories(data.map((m: ApiMemory) => ({
                          id: m.id,
                          text: m.text,
                          tags: m.tags ? JSON.parse(m.tags) : [],
                          score: m.score,
                          created_at: new Date(m.created_at).toLocaleTimeString(),
                          source_app: m.source_app || 'unknown'
                      })));
                  }
              }
          } catch (error) {
              console.error(error);
              addLog('error', 'Search failed');
          }
      };

      const debounce = setTimeout(doSearch, 500);
      return () => clearTimeout(debounce);
      // Fixed: Added suggestedTags to dependency array
  }, [query, searchMode, suggestedTags]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 font-sans selection:bg-zinc-800">
      
      {/* HEADER */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
        <div className="container mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-zinc-100 flex items-center justify-center">
              <Brain className="h-5 w-5 text-zinc-900" />
            </div>
            <span className="font-bold tracking-tight text-zinc-100">Colby<span className="text-zinc-500 font-normal">MemoryNode</span></span>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center px-3 py-1 rounded-full bg-emerald-950/30 border border-emerald-900/50">
              <span className="relative flex h-2 w-2 mr-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-medium text-emerald-500">System Online</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl p-4 grid grid-cols-1 md:grid-cols-12 gap-6 mt-6">
        
        {/* LEFT COLUMN: MAIN INTERFACE (8 cols) */}
        <div className="md:col-span-8 space-y-6">
          
          {/* TABS */}
          <div className="flex items-center gap-1 p-1 bg-zinc-900/50 rounded-lg border border-zinc-800 w-fit">
            <button 
              onClick={() => setActiveTab('capture')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                activeTab === 'capture' ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Zap className="h-4 w-4" /> Quick Capture
            </button>
            <button 
              onClick={() => setActiveTab('recall')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                activeTab === 'recall' ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Database className="h-4 w-4" /> Recall
            </button>
            <button 
              onClick={() => setActiveTab('ask')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                activeTab === 'ask' ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <MessageSquare className="h-4 w-4" /> Ask AI
            </button>
          </div>

          {/* CAPTURE MODE */}
          {activeTab === 'capture' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Card className="p-1 shadow-2xl shadow-zinc-950/50">
                <div className="relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        handleSave();
                      }
                    }}
                    placeholder="What are you thinking? (CMD+Enter to save)"
                    className="w-full h-40 bg-zinc-950 p-4 rounded-lg resize-none focus:outline-none text-lg placeholder:text-zinc-600 text-zinc-100"
                  />
                  <div className="absolute bottom-3 right-3 flex items-center gap-2">
                    <Button 
                      size="sm"
                      variant="ghost"
                      onClick={handleAutoTag}
                      disabled={isTagging || !input}
                      className="text-purple-400 hover:text-purple-300 hover:bg-purple-950/30"
                    >
                      {isTagging ? (
                         <Activity className="h-4 w-4 animate-spin" />
                      ) : (
                         <><Wand2 className="h-4 w-4 mr-1" /> ✨ Auto-Tag</>
                      )}
                    </Button>
                    <span className="w-px h-4 bg-zinc-800 mx-1 hidden sm:inline-block"></span>
                    <span className="text-xs text-zinc-600 hidden sm:inline-block">CMD + Enter to save</span>
                    <Button 
                      size="sm" 
                      onClick={handleSave} 
                      disabled={isProcessing}
                      className={cn("transition-all", isProcessing ? "w-32" : "w-auto")}
                    >
                      {isProcessing ? (
                        <>
                          <Activity className="h-4 w-4 mr-2 animate-spin" /> Processing
                        </>
                      ) : (
                        <>
                          Save Memory <Send className="h-3 w-3 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Suggestions / Recent Context */}
              <div className="mt-6">
                <h3 className="text-sm font-medium text-zinc-500 mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-500" /> Suggested Tags
                </h3>
                <div className="flex flex-wrap gap-2">
                  {suggestedTags.map((tag, idx) => (
                    <Badge key={idx} variant="outline" className="cursor-pointer hover:border-zinc-500 hover:text-zinc-300 transition-colors">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* RECALL MODE */}
          {activeTab === 'recall' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* SEARCH MODE TOGGLE */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-500">Search Mode:</span>
                <div className="flex items-center gap-1 p-1 bg-zinc-900/50 rounded-lg border border-zinc-800">
                  <button
                    onClick={() => setSearchMode('basic')}
                    className={cn(
                      "px-3 py-1 rounded-md text-sm font-medium transition-all",
                      searchMode === 'basic' ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    Basic
                  </button>
                  <button
                    onClick={() => setSearchMode('smart')}
                    className={cn(
                      "px-3 py-1 rounded-md text-sm font-medium transition-all flex items-center gap-1",
                      searchMode === 'smart' ? "bg-zinc-800 text-zinc-100 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    <Wand2 className="h-3 w-3" /> Smart
                  </button>
                </div>
              </div>

              <div className="relative group">
                <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-500 group-focus-within:text-zinc-200 transition-colors" />
                <Input 
                  value={query}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                  placeholder="Search semantic memory..." 
                  className="pl-10 h-12 text-base bg-zinc-900/50 border-zinc-800 focus:bg-zinc-950 transition-colors" 
                />
              </div>
              
              <div className="space-y-3">
                {memories.length === 0 ? (
                  <div className="text-center py-12 text-zinc-600">
                    <Search className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p>No memories found matching your query.</p>
                  </div>
                ) : (
                  memories.map((mem) => (
                    <Card key={mem.id} className="p-4 hover:border-zinc-700 transition-colors cursor-pointer group">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-zinc-900/50 text-zinc-500 border-zinc-800">
                            {mem.source_app}
                          </Badge>
                          <span className="text-xs text-zinc-600 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {mem.created_at}
                          </span>
                          {searchMode === 'smart' && mem.tags.includes('smart-search') && (
                            <Badge variant="success" className="text-xs">
                              AI Rewritten
                            </Badge>
                          )}
                        </div>
                        {mem.score && (
                          <span className="text-xs font-mono text-emerald-500">
                            {Math.round(mem.score * 100)}% match
                          </span>
                        )}
                      </div>
                      <p className="text-zinc-300 text-sm leading-relaxed group-hover:text-zinc-100 transition-colors">
                        {mem.text}
                      </p>
                      <div className="mt-3 flex gap-2">
                        {mem.tags.map(tag => (
                          <span key={tag} className="text-xs text-zinc-600 flex items-center gap-0.5">
                            <Tag className="h-3 w-3" /> {tag}
                          </span>
                        ))}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ASK AI MODE */}
          {activeTab === 'ask' && (
             <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <Card className="p-4 min-h-[400px] flex flex-col relative">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-800/50">
                        <div className="h-8 w-8 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                            <Bot className="h-5 w-5 text-purple-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-medium text-zinc-100">Colby AI Agent</h3>
                            <p className="text-xs text-zinc-500">Has access to {memories.length} memory fragments</p>
                        </div>
                    </div>

                    <div className="flex-1 space-y-4 overflow-y-auto mb-4">
                        {chatResponse ? (
                             <div className="flex gap-3">
                                <div className="h-8 w-8 rounded-full bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shrink-0">
                                    <Bot className="h-5 w-5 text-purple-400" />
                                </div>
                                <div className="p-3 rounded-lg bg-zinc-800/50 text-sm text-zinc-200 leading-relaxed border border-zinc-800">
                                    {chatResponse}
                                </div>
                             </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-zinc-600 opacity-50">
                                <Bot className="h-12 w-12 mb-2" />
                                <p className="text-sm">Ask me anything about your saved memories...</p>
                            </div>
                        )}
                    </div>

                    <div className="relative mt-auto">
                        <Input 
                            value={chatInput}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChatInput(e.target.value)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleAskAI()}
                            placeholder="Ask a question..."
                            className="pr-12"
                            disabled={isChatting}
                        />
                        <button 
                            onClick={handleAskAI}
                            disabled={isChatting || !chatInput}
                            className="absolute right-2 top-2 p-1.5 bg-zinc-100 rounded text-zinc-900 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isChatting ? <Activity className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        </button>
                    </div>
                </Card>
             </div>
          )}
        </div>

        {/* RIGHT COLUMN: SIGNAL STREAM (4 cols) */}
        <div className="md:col-span-4 space-y-4">
          <Card className="h-[calc(100vh-8rem)] flex flex-col overflow-hidden border-zinc-800/50 bg-zinc-950/30">
            <div className="p-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/20">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <Terminal className="h-3 w-3" /> Live Signal
              </h3>
              <div className="flex items-center gap-2">
                <Cpu className="h-3 w-3 text-zinc-600" />
                <span className="text-[10px] text-zinc-600 font-mono">MEM: 128MB</span>
              </div>
            </div>
            
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs scrollbar-hide"
            >
              {logs.map((log) => (
                <div key={log.id} className="animate-in fade-in slide-in-from-left-2 duration-300">
                  <div className="flex items-center gap-2 mb-1 opacity-50">
                    <span className="text-zinc-500">[{log.timestamp}]</span>
                  </div>
                  <div className={cn(
                    "p-2 rounded border-l-2",
                    log.type === 'info' && "border-blue-500/50 bg-blue-500/5 text-blue-200",
                    log.type === 'success' && "border-emerald-500/50 bg-emerald-500/5 text-emerald-200",
                    log.type === 'error' && "border-red-500/50 bg-red-500/5 text-red-200",
                    log.type === 'process' && "border-amber-500/50 bg-amber-500/5 text-amber-200"
                  )}>
                    {log.message}
                  </div>
                </div>
              ))}
              
              {isProcessing && (
                <div className="flex items-center gap-2 text-zinc-500 p-2">
                  <span className="h-1.5 w-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="h-1.5 w-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="h-1.5 w-1.5 bg-zinc-500 rounded-full animate-bounce"></span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}