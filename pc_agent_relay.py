# pc_agent_relay.py
import asyncio
import json
import logging
import os
import subprocess
import websockets
import urllib.parse
import argparse
import psutil
import secrets
from typing import Any, Dict, List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('pc_agent')

# Try to import pyautogui; skip if not available (e.g., in Docker without display)
try:
    import pyautogui
    HAS_PYGUI = True
except Exception as e:
    HAS_PYGUI = False
    logger.warning(f"pyautogui not available; GUI features disabled: {e}")

# ==========================================================
# Configuration
# ==========================================================
def generate_token(length: int = 5) -> str:
    return secrets.token_urlsafe(length)

RELAY_URL = os.environ.get('RELAY_URL', 'wss://phone-controller-1.onrender.com')
TOKEN = generate_token()
OLLAMA_MODEL = os.environ.get('OLLAMA_MODEL', "llama3.2")

# ==========================================================
# Application Manager
# ==========================================================

class ApplicationManager:
    def __init__(self):
        # Predefined apps that can be used when out of credits
        self.predefined_apps = {
            "notepad": "notepad.exe",
            "calculator": "calc.exe",
            "paint": "mspaint.exe",
            "browser": "chrome.exe",
            "file explorer": "explorer.exe",
            "command prompt": "cmd.exe",
            "task manager": "taskmgr.exe",
        }

    def open_application(self, app_name: str) -> dict:
        """Open any application on the computer"""
        try:
            app_name_lower = app_name.lower()
            
            # Check if it's a predefined app
            if app_name_lower in self.predefined_apps:
                command = self.predefined_apps[app_name_lower]
                subprocess.Popen(command, shell=True)
                return {"status": "success", "message": f"Opened {app_name}"}
            
            # Try direct executable
            if app_name_lower.endswith('.exe'):
                subprocess.Popen(app_name_lower, shell=True)
                return {"status": "success", "message": f"Opened {app_name}"}
            
            # Try with .exe extension
            try:
                subprocess.Popen(app_name_lower + ".exe", shell=True)
                return {"status": "success", "message": f"Opened {app_name}"}
            except:
                pass
            
            # Search in common program directories
            common_paths = [
                os.environ.get('PROGRAMFILES', ''),
                os.environ.get('PROGRAMFILES(X86)', ''),
                os.environ.get('APPDATA', ''),
                os.environ.get('LOCALAPPDATA', ''),
            ]
            
            for base_path in common_paths:
                # Try direct path
                path = os.path.join(base_path, app_name + ".exe")
                if os.path.exists(path):
                    subprocess.Popen(path, shell=True)
                    return {"status": "success", "message": f"Opened {app_name}"}
                
                # Try in subdirectory
                path = os.path.join(base_path, app_name, app_name + ".exe")
                if os.path.exists(path):
                    subprocess.Popen(path, shell=True)
                    return {"status": "success", "message": f"Opened {app_name}"}
            
            return {"status": "error", "message": f"Application '{app_name}' not found"}
            
        except Exception as e:
            return {"status": "error", "message": f"Failed to open {app_name}: {str(e)}"}

    def close_application(self, app_name: str) -> dict:
        """Close specific application by name"""
        try:
            app_name_lower = app_name.lower()
            closed_count = 0
            
            # Build list of process names to search for
            process_names = []
            if app_name_lower in self.predefined_apps:
                process_names.append(self.predefined_apps[app_name_lower])
            
            if app_name_lower.endswith('.exe'):
                process_names.append(app_name_lower)
            else:
                process_names.append(app_name_lower + ".exe")
            
            # Find and terminate matching processes
            for process in psutil.process_iter(['pid', 'name']):
                try:
                    process_name_lower = process.info['name'].lower()
                    for target_name in process_names:
                        if target_name.lower() in process_name_lower or app_name_lower in process_name_lower:
                            process.terminate()
                            closed_count += 1
                            break
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            
            if closed_count > 0:
                return {"status": "success", "message": f"Closed {closed_count} instance(s) of {app_name}"}
            else:
                return {"status": "error", "message": f"No running instances of '{app_name}' found"}
                
        except Exception as e:
            return {"status": "error", "message": f"Failed to close {app_name}: {str(e)}"}

    def type_text(self, text: str, interval: float = 0.1) -> dict:
        """Type text using keyboard automation"""
        try:
            logger.info(f'⌨️ Typing text: {text[:50]}...' if len(text) > 50 else f'⌨️ Typing text: {text}')
            
            import time
            import keyboard
            
            # Add delay before typing to ensure focus
            time.sleep(1.5)
            
            # Use keyboard library instead - more reliable
            keyboard.write(text, delay=interval)
            
            return {"status": "success", "message": f"Typed: {text[:50]}..." if len(text) > 50 else f"Typed: {text}"}
            
        except ImportError:
            # Fallback to pyautogui if keyboard library not available
            if not HAS_PYGUI:
                return {"status": "error", "message": "Keyboard automation not available (pyautogui disabled)"}
            try:
                import time
                time.sleep(1.5)
                
                # Disable pyautogui failsafe
                pyautogui.FAILSAFE = False
                
                # Try typing with pyautogui
                for char in text:
                    pyautogui.write(char, interval=interval)
                
                return {"status": "success", "message": f"Typed (pyautogui): {text[:50]}..." if len(text) > 50 else f"Typed: {text}"}
            except Exception as e:
                return {"status": "error", "message": f"Failed to type with pyautogui: {str(e)}"}
                
        except Exception as e:
            return {"status": "error", "message": f"Failed to type text: {str(e)}"}

    def press_key(self, key: str) -> dict:
        """Press a keyboard key"""
        try:
            logger.info(f'⌨️ Pressing key: {key}')
            
            import time
            import keyboard
            
            # Add small delay before pressing
            time.sleep(0.5)
            
            # Normalize key name
            key = key.lower().strip()
            
            # Map common key aliases
            key_mapping = {
                'return': 'enter',
                'esc': 'escape',
                'del': 'delete',
                'ctrl': 'control',
                'win': 'windows',
                'cmd': 'command',
                'alt': 'alt',
                'shift': 'shift',
                'space': 'space',
                'spacebar': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'caps': 'caps lock',
                'capslock': 'caps lock',
                'pageup': 'page up',
                'pagedown': 'page down',
                'home': 'home',
                'end': 'end',
                'insert': 'insert',
                'up': 'up',
                'down': 'down',
                'left': 'left',
                'right': 'right',
                'f1': 'f1', 'f2': 'f2', 'f3': 'f3', 'f4': 'f4',
                'f5': 'f5', 'f6': 'f6', 'f7': 'f7', 'f8': 'f8',
                'f9': 'f9', 'f10': 'f10', 'f11': 'f11', 'f12': 'f12',
            }
            
            # Apply mapping if exists
            mapped_key = key_mapping.get(key, key)
            
            # Handle key combinations (e.g., "ctrl+c", "alt+tab")
            if '+' in mapped_key:
                keys = mapped_key.split('+')
                keyboard.press_and_release('+'.join(keys))
                return {"status": "success", "message": f"Pressed key combination: {mapped_key}"}
            else:
                # Single key press
                keyboard.press_and_release(mapped_key)
                return {"status": "success", "message": f"Pressed key: {mapped_key}"}
            
        except ImportError:
            # Fallback to pyautogui if keyboard library not available
            if not HAS_PYGUI:
                return {"status": "error", "message": "Keyboard automation not available (pyautogui disabled)"}
            try:
                import time
                time.sleep(0.5)
                
                pyautogui.FAILSAFE = False
                
                # Handle key combinations
                if '+' in key:
                    keys = key.lower().split('+')
                    pyautogui.hotkey(*keys)
                    return {"status": "success", "message": f"Pressed key combination (pyautogui): {key}"}
                else:
                    pyautogui.press(key.lower())
                    return {"status": "success", "message": f"Pressed key (pyautogui): {key}"}
                    
            except Exception as e:
                return {"status": "error", "message": f"Failed to press key with pyautogui: {str(e)}"}
                
        except Exception as e:
            return {"status": "error", "message": f"Failed to press key: {str(e)}"}

# ==========================================================
# AI Processor with Ollama (Local AI)
# ==========================================================

class AIProcessor:
    def __init__(self, ollama_model: str = "llama3.2"):
        self.app_manager = ApplicationManager()
        self.credits = 100  # Starting credits
        self.credit_cost = 5  # Cost per AI request
        self.ollama_model = ollama_model
        
        # Predefined websites for fallback
        self.predefined_websites = {
            "google": "https://www.google.com",
            "youtube": "https://www.youtube.com",
            "facebook": "https://www.facebook.com",
            "twitter": "https://www.twitter.com",
            "instagram": "https://www.instagram.com",
            "reddit": "https://www.reddit.com",
            "gmail": "https://mail.google.com",
            "github": "https://www.github.com",
        }
        
        # Try to use Ollama (local AI)
        if os.environ.get('DOCKER_CONTAINER'):
            logger.info("🐳 Running in Docker; AI disabled")
            self.ai_enabled = False
        else:
            try:
                import ollama
                self.ollama_client = ollama
                self.ai_enabled = True
                logger.info(f"✅ Ollama enabled with model: {ollama_model}")
            except ImportError:
                logger.error("❌ Ollama not installed. Install with: pip install ollama")
                self.ai_enabled = False
        
        self.system_prompt = """You are a PC control assistant. Convert natural language to JSON commands.

Available commands:
- open_app: Launch applications (e.g., "open notepad")
- close_app: Close applications (e.g., "close chrome")
- open_website: Open websites in browser (e.g., "open youtube", "go to google.com")
- type_text: Type text using keyboard (e.g., "type hello world", "write this is a test")
- press_key: Press keyboard keys (e.g., "press enter", "press ctrl+c", "press f5")

Respond with valid JSON only:

Examples:
User: "open calculator"
{"intent": "open_app", "app_name": "calculator"}

User: "close notepad"
{"intent": "close_app", "app_name": "notepad"}

User: "open youtube"
{"intent": "open_website", "url": "youtube.com"}

User: "type hello world"
{"intent": "type_text", "text": "hello world"}

User: "press enter"
{"intent": "press_key", "key": "enter"}

User: "press ctrl+c"
{"intent": "press_key", "key": "ctrl+c"}

User: "press escape"
{"intent": "press_key", "key": "escape"}

Extract the app name, website URL, text to type, or key to press and return the appropriate command."""

    async def process_command(self, text: str) -> dict:
        """Process user command - uses AI if available and has credits, otherwise fallback"""
        # Check if we can use AI
        if self.ai_enabled and self.credits >= self.credit_cost:
            try:
                logger.info(f"🤖 Processing with Ollama: '{text}'")
                
                # Use Ollama (local AI)
                response = self.ollama_client.chat(
                    model=self.ollama_model,
                    messages=[
                        {"role": "system", "content": self.system_prompt},
                        {"role": "user", "content": text}
                    ]
                )
                ai_response = response['message']['content'].strip()
                
                logger.info(f"AI Response: {ai_response}")
                
                # Parse JSON and deduct credits
                command = json.loads(ai_response.replace('```json', '').replace('```', '').strip())
                self.credits -= self.credit_cost
                
                return await self._execute_command(command, ai_used=True)
                
            except Exception as e:
                logger.error(f"AI failed: {e}, falling back to predefined apps")
                return await self._fallback_command(text)
        else:
            # No AI available or out of credits
            if self.ai_enabled and self.credits < self.credit_cost:
                logger.info(f"⚠️ Out of credits ({self.credits} remaining), using predefined apps only")
            return await self._fallback_command(text)
    
    def open_website(self, url: str) -> dict:
        """Open website in default browser"""
        try:
            # Ensure URL has protocol
            if not url.startswith(('http://', 'https://')):
                url = f'https://{url}'
            
            logger.info(f'🌐 Opening website: {url}')
            
            # Platform-specific browser opening
            if os.name == 'nt':  # Windows
                subprocess.Popen(f'start {url}', shell=True)
            elif os.name == 'posix':  # macOS/Linux
                if os.uname().sysname == 'Darwin':  # macOS
                    subprocess.Popen(['open', url])
                else:  # Linux
                    subprocess.Popen(['xdg-open', url])
            
            return {"status": "success", "message": f"Opened {url}"}
            
        except Exception as e:
            return {"status": "error", "message": f"Failed to open {url}: {str(e)}"}
    
    async def _execute_command(self, command: dict, ai_used: bool = False) -> dict:
        """Execute a parsed command"""
        intent = command.get('intent')
        
        if intent == 'open_app':
            app_name = command.get('app_name', '')
            result = self.app_manager.open_application(app_name)
        elif intent == 'close_app':
            app_name = command.get('app_name', '')
            result = self.app_manager.close_application(app_name)
        elif intent == 'open_website':
            url = command.get('url', '')
            result = self.open_website(url)
        elif intent == 'type_text':
            text = command.get('text', '')
            result = self.app_manager.type_text(text)
        elif intent == 'press_key':
            key = command.get('key', '')
            result = self.app_manager.press_key(key)
        else:
            result = {"status": "error", "message": f"Unknown intent: {intent}"}
        
        # Add metadata
        result['ai_used'] = ai_used
        result['credits_remaining'] = self.credits
        return result
    
    async def _fallback_command(self, text: str) -> dict:
        """Fallback for when AI is unavailable - only predefined apps and websites"""
        text_lower = text.lower()
        
        # Check for press key commands
        if text_lower.startswith('press '):
            key = text[6:].strip()
            result = self.app_manager.press_key(key)
            result['ai_used'] = False
            result['credits_remaining'] = self.credits
            return result
        
        # Check for type commands
        if any(keyword in text_lower for keyword in ['type ', 'write ']):
            # Extract text to type (everything after the keyword)
            for keyword in ['type ', 'write ']:
                if keyword in text_lower:
                    text_to_type = text[text_lower.index(keyword) + len(keyword):].strip()
                    result = self.app_manager.type_text(text_to_type)
                    result['ai_used'] = False
                    result['credits_remaining'] = self.credits
                    return result
        
        # Check for website commands
        if any(keyword in text_lower for keyword in ['open', 'go to', 'visit', 'browse']):
            # Check if it's a predefined website
            for site_name, site_url in self.predefined_websites.items():
                if site_name in text_lower:
                    result = self.open_website(site_url)
                    result['ai_used'] = False
                    result['credits_remaining'] = self.credits
                    return result
        
        # Check for open app commands
        if any(keyword in text_lower for keyword in ['open', 'launch', 'start', 'run']):
            # Check if it's a predefined app
            for app_name in self.app_manager.predefined_apps.keys():
                if app_name in text_lower:
                    result = self.app_manager.open_application(app_name)
                    result['ai_used'] = False
                    result['credits_remaining'] = self.credits
                    return result
            
            return {
                "status": "error",
                "message": f"AI credits exhausted. Only predefined apps/websites available. Apps: {', '.join(self.app_manager.predefined_apps.keys())}. Sites: {', '.join(self.predefined_websites.keys())}",
                "ai_used": False,
                "credits_remaining": self.credits
            }
        
        # Check for close commands
        elif any(keyword in text_lower for keyword in ['close', 'exit', 'stop', 'quit', 'kill']):
            # Check if it's a predefined app
            for app_name in self.app_manager.predefined_apps.keys():
                if app_name in text_lower:
                    result = self.app_manager.close_application(app_name)
                    result['ai_used'] = False
                    result['credits_remaining'] = self.credits
                    return result
            
            return {
                "status": "error",
                "message": f"AI credits exhausted. Only predefined apps available: {', '.join(self.app_manager.predefined_apps.keys())}",
                "ai_used": False,
                "credits_remaining": self.credits
            }
        
        return {
            "status": "error",
            "message": "Could not understand command. Try 'open [app/website]', 'close [app]', 'type [text]', or 'press [key]'",
            "ai_used": False,
            "credits_remaining": self.credits
        }
    
    def get_credits(self) -> int:
        """Get current credit balance"""
        return self.credits
    
    def add_credits(self, amount: int):
        """Add credits"""
        self.credits += amount
        logger.info(f"💳 Added {amount} credits. New balance: {self.credits}")

# ==========================================================
# Command Handlers
# ==========================================================

ai_processor = None  # Will be initialized in main()

async def handle_ai_command(payload: Dict[str, Any]) -> dict:
    """Handle natural language command from user"""
    text = payload.get('text', '')
    if not text:
        return {'ok': False, 'error': 'No text provided'}
    
    try:
        result = await ai_processor.process_command(text)
        
        return {
            'ok': result.get('status') == 'success',
            'message': result.get('message', ''),
            'ai_used': result.get('ai_used', False),
            'credits_remaining': result.get('credits_remaining', 0)
        }
        
    except Exception as e:
        logger.error(f'Command processing failed: {e}')
        return {'ok': False, 'error': str(e)}

async def handle_check_credits(payload: Dict[str, Any]) -> dict:
    """Check credit balance"""
    credits = ai_processor.get_credits()
    return {
        'ok': True,
        'message': f'You have {credits} credits remaining',
        'credits': credits,
        'ai_enabled': ai_processor.ai_enabled
    }

async def handle_add_credits(payload: Dict[str, Any]) -> dict:
    """Add credits to the AI"""
    amount = payload.get('amount', 0)
    if amount <= 0:
        return {'ok': False, 'error': 'Invalid credit amount'}
    
    ai_processor.add_credits(amount)
    return {
        'ok': True,
        'message': f'Added {amount} credits',
        'credits': ai_processor.get_credits()
    }

# Command handler mapping
HANDLERS = {
    'ai_command': handle_ai_command,
    'check_credits': handle_check_credits,
    'add_credits': handle_add_credits,
}

# ==========================================================
# Relay Connection
# ==========================================================

async def handle_relay_message(websocket, message):
    """Handle messages received from relay server"""
    try:
        data = json.loads(message)
        logger.info('📨 Received: %s', data)
        
        # Handle relay status messages
        if data.get('type') == 'relay_status':
            if data.get('phone_connected'):
                logger.info('📱 Phone connected')
            elif data.get('phone_connected') is False:
                logger.info('📱 Phone disconnected')
            return
        
        # Handle authentication
        if data.get('type') == 'auth':
            response = {'ok': True, 'auth': True, 'type': 'auth_response'}
            await websocket.send(json.dumps(response))
            return
        
        # Process commands
        cmd_type = data.get('type')
        if cmd_type in HANDLERS:
            result = await HANDLERS[cmd_type](data)
            await websocket.send(json.dumps(result))
            logger.info('✅ Command executed: %s', cmd_type)
        else:
            logger.warning('❌ Unknown command: %s', cmd_type)
            response = {'ok': False, 'error': f'Unknown command: {cmd_type}'}
            await websocket.send(json.dumps(response))
            
    except Exception as e:
        logger.error('❌ Error: %s', e)
        try:
            await websocket.send(json.dumps({'ok': False, 'error': str(e)}))
        except:
            pass

async def connect_to_relay():
    """Connect to relay server"""
    params = {'token': TOKEN, 'client': 'pc'}
    query_string = urllib.parse.urlencode(params)
    ws_url = f"{RELAY_URL}?{query_string}"
    
    logger.info('🔗 Connecting to: %s', RELAY_URL)
    
    try:
        websocket = await websockets.connect(ws_url, ping_interval=20, ping_timeout=10)
        logger.info('✅ Connected to relay server')
        
        # Authenticate
        await websocket.send(json.dumps({'type': 'auth', 'token': TOKEN}))
        
        # Listen for messages
        async for message in websocket:
            await handle_relay_message(websocket, message)
            
    except websockets.exceptions.ConnectionClosed:
        logger.warning('🔌 Connection closed')
    except Exception as e:
        logger.error('❌ Connection error: %s', e)
    finally:
        if 'websocket' in locals():
            await websocket.close()

async def main():
    """Main function"""
    global ai_processor
    
    # Initialize AI processor with Ollama only
    ai_processor = AIProcessor(ollama_model=OLLAMA_MODEL)
    
    logger.info('🚀 Starting PC Agent')
    logger.info('🔑 Token: %s', '***' + TOKEN[0:] if TOKEN else 'None')
    logger.info('🌐 Relay: %s', RELAY_URL)
    logger.info('🦙 AI Mode: Ollama (Local)')
    logger.info('🦙 Ollama Model: %s', OLLAMA_MODEL)
    logger.info('🤖 AI Enabled: %s', ai_processor.ai_enabled)
    logger.info('💳 Credits: %d', ai_processor.get_credits())
    logger.info('📱 Predefined Apps: %s', ', '.join(ai_processor.app_manager.predefined_apps.keys()))
    logger.info('🌐 Predefined Websites: %s', ', '.join(ai_processor.predefined_websites.keys()))
    
    # Reconnection loop
    reconnect_delay = 5
    while True:
        try:
            await connect_to_relay()
        except KeyboardInterrupt:
            logger.info('👋 Shutting down...')
            break
        except Exception as e:
            logger.error('Unexpected error: %s', e)
        
        logger.info('🔄 Reconnecting in %d seconds...', reconnect_delay)
        await asyncio.sleep(reconnect_delay)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='PC Agent with Ollama (Local AI)')
    parser.add_argument('--relay-url', help='Relay server URL')
    parser.add_argument('--token', help='Authentication token')
    parser.add_argument('--ollama-model', default='llama3.2', help='Ollama model to use (default: llama3.2)')
    args = parser.parse_args()
    
    if args.relay_url:
        RELAY_URL = args.relay_url
    if args.token:
        TOKEN = args.token
    if args.ollama_model:
        OLLAMA_MODEL = args.ollama_model
    
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info('👋 Goodbye!')