// Simple Logger for user-facing signals vs debug noise
export type LogType = 'info' | 'success' | 'process' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: LogType;
  message: string;
}

export class SignalLogger {
  private logs: LogEntry[] = [];
  
  log(type: LogType, message: string) {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      message
    };
    
    // Store in memory for SSE streaming
    this.logs.push(entry);
    
    // Also log to console for debugging
    if (type === 'error') {
      console.error(`[${type.toUpperCase()}] ${message}`);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
    
    // In a real app, you might emit this to a Durable Object or broadcast channel
    return entry;
  }
  
  getRecentLogs() {
    return this.logs.slice(-50); // Keep last 50
  }
}
