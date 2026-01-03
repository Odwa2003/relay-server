'use client'

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignInButton, UserButton } from '@clerk/nextjs'
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Wifi, WifiOff, Loader2, Monitor, Smartphone, Brain, 
  Zap, MousePointer, Keyboard, Power, Lock, Moon,
  Chrome, Calculator, FolderOpen, FileText, AlertCircle,
  CheckCircle2, XCircle, Clock
} from 'lucide-react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Authenticated, Unauthenticated } from 'convex/react';

// Types
interface LogEntry {
  timestamp: string;
  message: string;
  data: any | null;
  id: number;
}

interface AIStatus {
  show: boolean;
  message: string;
  type: 'processing' | 'success' | 'error';
}

interface Command {
  type: string;
  text?: string;
  token?: string;
  x?: number;
  y?: number;
  duration?: number;
  button?: string;
  interval?: number;
  commandId?: number;
  timestamp?: string;
}

interface WebSocketMessage {
  type?: string;
  auth?: boolean;
  ok?: boolean;
  error?: string;
  pc_connected?: boolean;
  phone_connected?: boolean;
  ai_commands?: any[];
  command_count?: number;
  text?: string;
  results?: any[];
  parsed_command?: {
    original_text: string;
    type: string;
    confidence: number;
  };
}

const PCAgentInterface: React.FC = () => {
  const [wsUrl, setWsUrl] = useState<string>('wss://phone-controller-1.onrender.com');
  const [token, setToken] = useState<string>('');
  const [connected, setConnected] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [pcConnected, setPcConnected] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [aiStatus, setAiStatus] = useState<AIStatus>({ show: false, message: '', type: 'processing' });
  
  // Command states
  const [smartCommand, setSmartCommand] = useState<string>('');
  const [voiceCommand, setVoiceCommand] = useState<string>('');
  const [xCoord, setXCoord] = useState<string>('');
  const [yCoord, setYCoord] = useState<string>('');
  const [typeText, setTypeText] = useState<string>('');

  const ws = useRef<WebSocket | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  
  // Convex mutation to save user inputs into the messages collection
  const createMessage = useMutation(api.messages.createForCurrentUser);
  
  

  const addLog = (message: string, data: any = null): void => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry: LogEntry = {
      timestamp,
      message,
      data,
      id: Date.now() + Math.random()
    };
    setLogs(prev => [logEntry, ...prev].slice(0, 50));
  };

  const updateAIStatus = (message: string, type: AIStatus['type'] = 'processing'): void => {
    setAiStatus({ show: true, message, type });
    if (type !== 'processing') {
      setTimeout(() => setAiStatus(prev => ({ ...prev, show: false })), 5000);
    }
  };

  const connectWebSocket = async (): Promise<void> => {
    if (!wsUrl.trim()) {
      setError('Please enter a WebSocket URL');
      return;
    }

    setConnecting(true);
    setError('');
    
    let url: string;
    try {
      if (wsUrl.includes('?')) {
        url = `${wsUrl}&token=${encodeURIComponent(token)}&client=phone`;
      } else {
        url = `${wsUrl}?token=${encodeURIComponent(token)}&client=phone`;
      }
    } catch (e) {
      setError('Invalid URL format');
      setConnecting(false);
      return;
    }

    addLog('Connecting to relay...', { url: wsUrl });

    ws.current = new WebSocket(url);

    ws.current.onopen = async () => {
      addLog('WebSocket connected to relay');
      
      if (token) {
        ws.current?.send(JSON.stringify({ type: 'auth', token }));
        addLog('Authenticating...');
      }
    };

    ws.current.onmessage = (ev: MessageEvent) => {
      try {
        const data: WebSocketMessage = JSON.parse(ev.data);
        
        if (data.type === 'auth_response' || data.auth === true || data.ok === true) {
          addLog('Authenticated successfully');
          setConnected(true);
          setConnecting(false);
        }
        
        if (data.type === 'relay_status') {
          if (data.pc_connected && !pcConnected) {
            setPcConnected(true);
            addLog('PC connected to relay!');
          } else if (data.pc_connected === false && pcConnected) {
            setPcConnected(false);
            addLog('PC disconnected from relay');
          }
          return;
        }
        
        if (data.ai_commands) {
          addLog('AI Analysis Complete', {
            original: data.text,
            count: data.command_count,
            commands: data.ai_commands
          });
          
          if (data.ok) {
            updateAIStatus(`Successfully executed ${data.command_count} command(s)`, 'success');
          } else {
            updateAIStatus(`Execution failed: ${data.error || 'Unknown error'}`, 'error');
          }
          return;
        }
        
        if (data.parsed_command) {
          addLog('AI Response', {
            original: data.parsed_command.original_text,
            type: data.parsed_command.type,
            success: data.ok
          });
        } else {
          addLog('Response received', data);
        }
      } catch (e) {
        addLog('Message received', ev.data);
      }
    };

    ws.current.onclose = (ev: CloseEvent) => {
      setPcConnected(false);
      setConnected(false);
      setConnecting(false);
      
      if (ev.code === 1000) {
        addLog('Disconnected normally');
      } else {
        addLog(`Disconnected (code: ${ev.code})`, { reason: ev.reason });
      }
    };

    ws.current.onerror = () => {
      addLog('WebSocket error occurred');
      setError('Connection error');
      setConnecting(false);
    };
  };

  const disconnect = (): void => {
    if (ws.current) {
      addLog('Disconnecting...');
      ws.current.close(1000, 'User requested disconnect');
    }
  };

  const sendCommand = (cmd: Command): void => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      setError('Not connected to relay server');
      return;
    }
    
    if (!pcConnected && cmd.type !== 'auth') {
      setError('PC is not connected. Please wait for PC connection.');
      return;
    }
    
    // Save user input to Convex database if it's a text command
    if (cmd.text && cmd.type === 'ai_command') {
      createMessage({ text: cmd.text }).catch((e) => {
        console.error('Failed to save command to Convex', e);
        addLog('Warning: Failed to save command to database', null);
      });
    }
    
    addLog('Sending command', cmd);
    ws.current.send(JSON.stringify(cmd));
  };

  const handleSmartCommand = (): void => {
    if (!smartCommand.trim()) return;
    updateAIStatus('AI is processing your command...', 'processing');
    sendCommand({ type: 'ai_command', text: smartCommand });
    setSmartCommand('');
  };

  const handleVoiceCommand = (): void => {
    if (!voiceCommand.trim()) return;
    sendCommand({ type: 'ai_command', text: voiceCommand });
    setVoiceCommand('');
  };

  const getStatusBadge = () => {
    if (connected && pcConnected) {
      return <Badge className="bg-green-500"><CheckCircle2 className="w-3 h-3 mr-1" /> Connected</Badge>;
    }
    if (connected && !pcConnected) {
      return <Badge className="bg-yellow-500"><Clock className="w-3 h-3 mr-1" /> Waiting for PC</Badge>;
    }
    if (connecting) {
      return <Badge className="bg-blue-500"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Connecting</Badge>;
    }
    return <Badge variant="destructive"><WifiOff className="w-3 h-3 mr-1" /> Disconnected</Badge>;
  };

  

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Header Status */}
      <Card className="border-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="w-5 h-5" />
                Phone → PC Controller
              </CardTitle>
              <CardDescription>AI-powered cloud relay system</CardDescription>
            </div>
            {getStatusBadge()}
          </div>
        </CardHeader>
      </Card>

      {/* Connection Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="w-5 h-5" />
            Connection Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Relay Server URL</label>
            <Input
              type="text"
              placeholder="wss://your-relay-server.onrender.com"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              disabled={connected}
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Pairing Token</label>
            <Input
              type="password"
              placeholder="Enter your token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={connected}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button 
              onClick={connectWebSocket}
              disabled={connected || connecting}
              className="flex-1"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Wifi className="w-4 h-4 mr-2" />
                  Connect
                </>
              )}
            </Button>
            <Button 
              onClick={disconnect}
              disabled={!connected}
              variant="destructive"
              className="flex-1"
            >
              <WifiOff className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
          </div>

          {pcConnected && (
            <Alert>
              <Monitor className="h-4 w-4" />
              <AlertDescription className="font-medium">
                PC is online and ready to receive commands!
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Main Interface Tabs */}
      <Tabs defaultValue="smart" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="smart">
            <Brain className="w-4 h-4 mr-2" />
            Smart
          </TabsTrigger>
          <TabsTrigger value="ai">
            <Zap className="w-4 h-4 mr-2" />
            AI Voice
          </TabsTrigger>
          <TabsTrigger value="manual">
            <MousePointer className="w-4 h-4 mr-2" />
            Manual
          </TabsTrigger>
          <TabsTrigger value="system">
            <Power className="w-4 h-4 mr-2" />
            System
          </TabsTrigger>
        </TabsList>

        {/* Smart Commands Tab */}
        <TabsContent value="smart" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-500" />
                AI Smart Commands
              </CardTitle>
              <CardDescription>
                Execute complex multi-step commands with natural language
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Try: 'Open Chrome and go to YouTube then search for cats'"
                  value={smartCommand}
                  onChange={(e) => setSmartCommand(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSmartCommand()}
                />
                <Button onClick={handleSmartCommand} className="bg-orange-500 hover:bg-orange-600">
                  <Brain className="w-4 h-4 mr-2" />
                  Send
                </Button>
              </div>

              {aiStatus.show && (
                <Alert className={
                  aiStatus.type === 'success' ? 'bg-green-50 border-green-200' :
                  aiStatus.type === 'error' ? 'bg-red-50 border-red-200' :
                  'bg-yellow-50 border-yellow-200'
                }>
                  {aiStatus.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  {aiStatus.type === 'error' && <XCircle className="h-4 w-4 text-red-600" />}
                  {aiStatus.type === 'processing' && <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />}
                  <AlertDescription>{aiStatus.message}</AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => {
                  sendCommand({ type: 'ai_command', text: "Open Chrome and go to GitHub" });
                }}>
                  Open Chrome → GitHub
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  sendCommand({ type: 'ai_command', text: "Type hello and press enter" });
                }}>
                  Type & Enter
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  sendCommand({ type: 'ai_command', text: "Move to 100,200 and right click" });
                }}>
                  Move & Right Click
                </Button>
                <Button variant="outline" size="sm" onClick={() => {
                  sendCommand({ type: 'ai_command', text: "Open notepad and type my notes" });
                }}>
                  Notepad & Type
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Voice Commands Tab */}
        <TabsContent value="ai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-500" />
                AI Voice Commands
              </CardTitle>
              <CardDescription>
                Simple voice-like commands for quick actions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Try: 'open Chrome' or 'click at 100,200'"
                  value={voiceCommand}
                  onChange={(e) => setVoiceCommand(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleVoiceCommand()}
                />
                <Button onClick={handleVoiceCommand} className="bg-purple-500 hover:bg-purple-600">
                  <Zap className="w-4 h-4 mr-2" />
                  Send
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'open chrome' })}>
                  <Chrome className="w-4 h-4 mr-2" />
                  Chrome
                </Button>
                <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'open notepad' })}>
                  <FileText className="w-4 h-4 mr-2" />
                  Notepad
                </Button>
                <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'open calculator' })}>
                  <Calculator className="w-4 h-4 mr-2" />
                  Calculator
                </Button>
                <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'open file explorer' })}>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Explorer
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manual Controls Tab */}
        <TabsContent value="manual" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MousePointer className="w-5 h-5" />
                Mouse Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => sendCommand({ type: 'move', x: 100, y: 100, duration: 0.2 })}>
                  Move Center
                </Button>
                <Button variant="outline" onClick={() => sendCommand({ type: 'click', button: 'left' })}>
                  Left Click
                </Button>
                <Button variant="outline" onClick={() => sendCommand({ type: 'click', button: 'right' })}>
                  Right Click
                </Button>
                <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'double click' })}>
                  Double Click
                </Button>
                <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'scroll up' })}>
                  Scroll Up
                </Button>
                <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'scroll down' })}>
                  Scroll Down
                </Button>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Custom Position</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="X"
                    value={xCoord}
                    onChange={(e) => setXCoord(e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder="Y"
                    value={yCoord}
                    onChange={(e) => setYCoord(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => {
                    const x = parseInt(xCoord);
                    const y = parseInt(yCoord);
                    if (!isNaN(x) && !isNaN(y)) {
                      sendCommand({ type: 'move', x, y, duration: 0.2 });
                    }
                  }}>
                    Move to X,Y
                  </Button>
                  <Button onClick={() => {
                    const x = parseInt(xCoord);
                    const y = parseInt(yCoord);
                    if (!isNaN(x) && !isNaN(y)) {
                      sendCommand({ type: 'click', x, y, button: 'left' });
                    }
                  }}>
                    Click at X,Y
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Keyboard className="w-5 h-5" />
                Keyboard
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Text to type"
                  value={typeText}
                  onChange={(e) => setTypeText(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && typeText) {
                      sendCommand({ type: 'type', text: typeText, interval: 0.03 });
                      setTypeText('');
                    }
                  }}
                />
                <Button onClick={() => {
                  if (typeText) {
                    sendCommand({ type: 'type', text: typeText, interval: 0.03 });
                    setTypeText('');
                  }
                }}>
                  Type
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* System Commands Tab */}
        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Power className="w-5 h-5" />
                System Commands
              </CardTitle>
              <CardDescription className="text-amber-600">
                ⚠️ Use these commands with caution
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'lock computer' })}>
                <Lock className="w-4 h-4 mr-2" />
                Lock PC
              </Button>
              <Button variant="outline" onClick={() => sendCommand({ type: 'ai_command', text: 'sleep' })}>
                <Moon className="w-4 h-4 mr-2" />
                Sleep
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => {
                  if (window.confirm('Are you sure you want to SHUTDOWN the PC?')) {
                    sendCommand({ type: 'ai_command', text: 'shutdown' });
                  }
                }}
              >
                <Power className="w-4 h-4 mr-2" />
                Shutdown
              </Button>
              <Button 
                variant="destructive"
                onClick={() => {
                  if (window.confirm('Are you sure you want to RESTART the PC?')) {
                    sendCommand({ type: 'ai_command', text: 'restart' });
                  }
                }}
              >
                <Power className="w-4 h-4 mr-2" />
                Restart
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            📊 Activity Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div 
            ref={logContainerRef}
            className="h-64 overflow-y-auto bg-gray-900 rounded-lg p-4 font-mono text-sm text-green-400 space-y-1"
          >
            {logs.length === 0 ? (
              <div className="text-gray-500">Ready to connect...</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="text-xs">
                  <span className="text-gray-500">[{log.timestamp}]</span>{' '}
                  <span>{log.message}</span>
                  {log.data && (
                    <div className="text-gray-400 ml-4">
                      {JSON.stringify(log.data, null, 2)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default function Home() {
  return (
    <>
      <Authenticated>
        <UserButton />
        <Content />
      </Authenticated>
      <Unauthenticated>
        <SignInButton />
      </Unauthenticated>
    </>
  );
}

function Content() {
  const messages = useQuery(api.messages.getForCurrentUser);

  // Debug: Log messages to console
  useEffect(() => {
    console.log('Messages from Convex:', messages);
  }, [messages]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        <PCAgentInterface />

        {/* Debug: Show messages count */}
        <div className="mt-4 p-4 bg-white rounded-lg shadow">
          <h3 className="font-bold">Debug Info:</h3>
          <p>Total messages in DB: {messages?.length ?? 'Loading...'}</p>
          {messages && messages.length > 0 && (
            <div className="mt-2">
              <p className="font-semibold">Recent messages:</p>
              <ul className="list-disc pl-5">
                {messages.slice(-5).map((msg: any) => (
                  <li key={msg._id}>{msg.text} - {new Date(msg.timestamp).toLocaleString()}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}