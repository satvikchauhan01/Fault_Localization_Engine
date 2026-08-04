import React from 'react';
import IncidentList from './components/IncidentList';
import { Activity, Shield, Map, Settings, Menu, Bell } from 'lucide-react';

export default function App() {
  return (
    <div className="flex h-screen w-full bg-slate-950 overflow-hidden text-slate-200">
      {/* Sidebar Placeholder */}
      <aside className="w-16 md:w-64 flex-shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col transition-all duration-300">
        <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-slate-800">
          <Shield className="w-8 h-8 text-blue-500" />
          <span className="ml-3 font-bold text-lg hidden md:block text-slate-100 tracking-tight">KSPDB Operator</span>
        </div>
        
        <nav className="flex-1 py-6 flex flex-col gap-2 px-3">
          <a href="#" className="flex items-center px-3 py-3 rounded-lg bg-blue-500/10 text-blue-400 group relative">
            <Activity className="w-5 h-5 flex-shrink-0" />
            <span className="ml-3 font-medium hidden md:block">Incidents</span>
            <div className="absolute left-0 w-1 h-8 bg-blue-500 rounded-r-full -ml-3"></div>
          </a>
          <a href="#" className="flex items-center px-3 py-3 rounded-lg text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 group transition-colors">
            <Map className="w-5 h-5 flex-shrink-0" />
            <span className="ml-3 font-medium hidden md:block">Live Map</span>
          </a>
          <a href="#" className="flex items-center px-3 py-3 rounded-lg text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 group transition-colors mt-auto">
            <Settings className="w-5 h-5 flex-shrink-0" />
            <span className="ml-3 font-medium hidden md:block">Settings</span>
          </a>
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        
        {/* Header */}
        <header className="h-16 flex-shrink-0 glass-panel border-b border-slate-800/80 px-6 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button className="md:hidden text-slate-400 hover:text-slate-200">
              <Menu className="w-6 h-6" />
            </button>
            <h1 className="text-xl font-semibold tracking-tight">System Status</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button className="relative p-2 text-slate-400 hover:text-slate-200 transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full"></span>
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 shadow-lg border border-slate-700"></div>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto">
            {/* Ambient Background Glow */}
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="relative z-0">
              <IncidentList />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
