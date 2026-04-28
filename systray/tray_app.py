"""
YouTube Summary Service - System Tray Application
Provides easy control of the backend service from the system tray
"""

import pystray
from pystray import MenuItem as item
from PIL import Image, ImageDraw
import subprocess
import psutil
import webbrowser
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import threading
import time
import os
import sys
import json

class ServiceController:
    def __init__(self):
        self.process = None
        self.server_script = os.path.join(os.path.dirname(__file__), '..', 'backend', 'server.py')
        self.python_exe = sys.executable
        self.config_file = os.path.join(os.path.dirname(__file__), '..', 'backend', 'config.json')
        
    def is_running(self):
        """Check if the server is running"""
        if self.process and self.process.poll() is None:
            return True
        
        # Check if any process is listening on port 5000
        for conn in psutil.net_connections():
            if conn.laddr.port == 5000 and conn.status == 'LISTEN':
                return True
        return False
    
    def start(self):
        """Start the backend server"""
        if self.is_running():
            return True, "Server is already running"
        
        try:
            # Start the Flask server as a subprocess
            self.process = subprocess.Popen(
                [self.python_exe, self.server_script],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )
            
            # Wait a bit to see if it starts successfully
            time.sleep(2)
            
            if self.is_running():
                return True, "Server started successfully"
            else:
                return False, "Server failed to start"
                
        except Exception as e:
            return False, f"Error starting server: {str(e)}"
    
    def stop(self):
        """Stop the backend server"""
        if not self.is_running():
            return True, "Server is not running"
        
        try:
            if self.process:
                self.process.terminate()
                self.process.wait(timeout=5)
            
            # Kill any remaining processes on port 5000
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    for conn in proc.connections():
                        if conn.laddr.port == 5000:
                            proc.terminate()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            
            return True, "Server stopped successfully"
            
        except Exception as e:
            return False, f"Error stopping server: {str(e)}"
    
    def restart(self):
        """Restart the backend server"""
        success, msg = self.stop()
        if success:
            time.sleep(1)
            return self.start()
        return False, msg
    
    def load_config(self):
        """Load configuration"""
        if os.path.exists(self.config_file):
            with open(self.config_file, 'r') as f:
                return json.load(f)
        return {'anthropic_api_key': '', 'model': 'claude-sonnet-4-20250514'}
    
    def save_config(self, config):
        """Save configuration"""
        os.makedirs(os.path.dirname(self.config_file), exist_ok=True)
        with open(self.config_file, 'w') as f:
            json.dump(config, f, indent=2)

class ConfigWindow:
    def __init__(self, controller):
        self.controller = controller
        self.window = None
        
    def show(self):
        """Show configuration window"""
        if self.window:
            self.window.lift()
            self.window.focus_force()
            return
        
        self.window = tk.Tk()
        self.window.title("YouTube Summary Service - Configuration")
        self.window.geometry("600x400")
        
        # Bring window to front
        self.window.lift()
        self.window.attributes('-topmost', True)
        self.window.after(100, lambda: self.window.attributes('-topmost', False))
        self.window.focus_force()
        
        # Load current config
        config = self.controller.load_config()
        
        # API Key section
        tk.Label(self.window, text="Anthropic API Key:", font=('Arial', 10, 'bold')).pack(pady=(20,5))
        
        api_key_var = tk.StringVar(value=config.get('anthropic_api_key', ''))
        api_key_entry = tk.Entry(self.window, textvariable=api_key_var, width=70, show='*', 
                                 state='normal', font=('Arial', 10))
        api_key_entry.pack(pady=5)
        
        # Force focus after a short delay
        self.window.after(200, lambda: api_key_entry.focus_set())
        self.window.after(300, lambda: api_key_entry.icursor(tk.END))
        
        show_key_var = tk.BooleanVar()
        def toggle_key_visibility():
            api_key_entry.config(show='' if show_key_var.get() else '*')
            api_key_entry.focus_set()  # Refocus after toggle
        
        ttk.Checkbutton(self.window, text="Show API Key", variable=show_key_var, 
                       command=toggle_key_visibility).pack()
        
        # Model selection
        tk.Label(self.window, text="Claude Model:", font=('Arial', 10, 'bold')).pack(pady=(20,5))
        
        model_var = tk.StringVar(value=config.get('model', 'claude-sonnet-4-20250514'))
        models = [
            'claude-sonnet-4-20250514',
            'claude-opus-4-20250514',
            'claude-haiku-4-20250514'
        ]
        model_combo = ttk.Combobox(self.window, textvariable=model_var, values=models, 
                                   state='readonly', width=40)
        model_combo.pack(pady=5)
        
        # Info text
        info_frame = tk.Frame(self.window)
        info_frame.pack(pady=20, padx=20, fill='both', expand=True)
        
        info_text = scrolledtext.ScrolledText(info_frame, wrap=tk.WORD, height=8, 
                                             font=('Arial', 9))
        info_text.pack(fill='both', expand=True)
        info_text.insert('1.0', '''ℹ️ Configuration Guide:

• Anthropic API Key: Get yours at https://console.anthropic.com/
• The API key is stored locally and never sent anywhere except to Anthropic's API
• Recommended model: Claude Sonnet 4 (good balance of speed and quality)
• Cost: ~$0.003 per summary with Sonnet 4

Your Claude Pro subscription ($20/month) does NOT include API access.
API usage is separate and billed per-use (~$5-10/month for moderate use).
''')
        info_text.config(state='disabled')
        
        # Buttons
        button_frame = tk.Frame(self.window)
        button_frame.pack(pady=10)
        
        def save_and_close():
            config = {
                'anthropic_api_key': api_key_var.get(),
                'model': model_var.get()
            }
            self.controller.save_config(config)
            messagebox.showinfo("Success", "Configuration saved successfully!")
            self.window.destroy()
            self.window = None
        
        def test_api_key():
            import requests
            try:
                response = requests.post('http://localhost:5000/test-api-key', 
                                       json={'api_key': api_key_var.get()})
                if response.json().get('success'):
                    messagebox.showinfo("Success", "API key is valid!")
                else:
                    messagebox.showerror("Error", response.json().get('error'))
            except Exception as e:
                messagebox.showerror("Error", f"Could not test API key: {str(e)}")
        
        ttk.Button(button_frame, text="Test API Key", command=test_api_key).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Save", command=save_and_close).pack(side='left', padx=5)
        ttk.Button(button_frame, text="Cancel", command=lambda: self.window.destroy()).pack(side='left', padx=5)
        
        self.window.protocol("WM_DELETE_WINDOW", lambda: (self.window.destroy(), setattr(self, 'window', None)))
        self.window.mainloop()

class TrayApp:
    def __init__(self):
        self.controller = ServiceController()
        self.config_window = ConfigWindow(self.controller)
        self.icon = None
        self._watchdog_running = True

        # Start server on init
        self.controller.start()

        # Start watchdog thread to auto-restart crashed server
        self._watchdog_thread = threading.Thread(target=self._watchdog, daemon=True)
        self._watchdog_thread.start()

    def _watchdog(self):
        """Monitor server health and auto-restart if it crashes"""
        while self._watchdog_running:
            time.sleep(5)  # Check every 5 seconds
            if not self._watchdog_running:
                break
            if not self.controller.is_running():
                print('[Watchdog] Server not running, auto-restarting...')
                success, msg = self.controller.start()
                if success:
                    print('[Watchdog] Server restarted successfully')
                else:
                    print(f'[Watchdog] Failed to restart: {msg}')
                    # Wait a bit before retrying
                    time.sleep(5)
        
    def create_image(self):
        """Create tray icon image"""
        # Create a simple icon
        image = Image.new('RGB', (64, 64), color='white')
        dc = ImageDraw.Draw(image)
        dc.rectangle([16, 16, 48, 48], fill='blue')
        dc.text((20, 24), "YT", fill='white')
        return image
    
    def get_status_text(self, item):
        """Get current status text"""
        return "Running ✓" if self.controller.is_running() else "Stopped ✗"
    
    def on_start(self, icon, item):
        """Start server menu action"""
        success, msg = self.controller.start()
        icon.notify(msg)
        icon.update_menu()
    
    def on_stop(self, icon, item):
        """Stop server menu action"""
        success, msg = self.controller.stop()
        icon.notify(msg)
        icon.update_menu()
    
    def on_restart(self, icon, item):
        """Restart server menu action"""
        success, msg = self.controller.restart()
        icon.notify(msg)
        icon.update_menu()
    
    def on_configure(self, icon, item):
        """Show configuration window"""
        self.config_window.show()
    
    def on_view_logs(self, icon, item):
        """Open log file"""
        log_file = os.path.join(os.path.dirname(__file__), '..', 'backend', 
                               'youtube-summary-service.log')
        if os.path.exists(log_file):
            webbrowser.open(log_file)
        else:
            icon.notify("No log file found")
    
    def on_open_browser(self, icon, item):
        """Open service URL in browser"""
        webbrowser.open('http://localhost:5000/health')
    
    def on_quit(self, icon, item):
        """Quit application"""
        self._watchdog_running = False
        self.controller.stop()
        icon.stop()
    
    def run(self):
        """Run the tray application"""
        menu = (
            item(self.get_status_text, lambda: None, enabled=False),
            item('---', lambda: None),
            item('Start Service', self.on_start, enabled=lambda item: not self.controller.is_running()),
            item('Stop Service', self.on_stop, enabled=lambda item: self.controller.is_running()),
            item('Restart Service', self.on_restart),
            item('---', lambda: None),
            item('Configure...', self.on_configure),
            item('View Logs', self.on_view_logs),
            item('Open in Browser', self.on_open_browser),
            item('---', lambda: None),
            item('Quit', self.on_quit)
        )
        
        self.icon = pystray.Icon("youtube_summary", self.create_image(), 
                                "YouTube Summary Service", menu)
        self.icon.run()

if __name__ == '__main__':
    app = TrayApp()
    app.run()
