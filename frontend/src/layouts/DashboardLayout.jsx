import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Heart, LayoutDashboard, Brain, Smile, BookOpen, CalendarDays, Users, Library,
  ShieldAlert, BarChart3, LogOut, Menu, X, Moon, Sun, ClipboardList, Flag, UserCog,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import NotificationBell from '../components/dashboard/NotificationBell';

const NAV_BY_ROLE = {
  student: [
    { to: '/dashboard/student', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/dashboard/student/chat', label: 'AI Assistant', icon: Brain },
    { to: '/dashboard/student/assessments', label: 'Assessments', icon: ClipboardList },
    { to: '/dashboard/student/mood', label: 'Mood Tracker', icon: Smile },
    { to: '/dashboard/student/journal', label: 'Journal', icon: BookOpen },
    { to: '/dashboard/student/appointments', label: 'Appointments', icon: CalendarDays },
    { to: '/dashboard/student/forum', label: 'Community', icon: Users },
    { to: '/dashboard/student/resources', label: 'Resources', icon: Library },
  ],
  volunteer: [
    { to: '/dashboard/volunteer', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/dashboard/volunteer/moderation', label: 'Moderation Queue', icon: Flag },
    { to: '/dashboard/volunteer/activity', label: 'My Activity', icon: ClipboardList },
  ],
  counselor: [
    { to: '/dashboard/counselor', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/dashboard/counselor/appointments', label: 'Appointments', icon: CalendarDays },
    { to: '/dashboard/counselor/students', label: 'Student History', icon: Users },
    { to: '/dashboard/counselor/profile', label: 'My Profile', icon: UserCog },
  ],
  admin: [
    { to: '/dashboard/admin', label: 'Analytics', icon: BarChart3, end: true },
    { to: '/dashboard/admin/users', label: 'Manage Users', icon: UserCog },
    { to: '/dashboard/admin/resources', label: 'Resources', icon: Library },
    { to: '/dashboard/admin/emergency', label: 'Emergency Alerts', icon: ShieldAlert },
    { to: '/dashboard/admin/reports', label: 'Reports & Feedback', icon: ClipboardList },
  ],
};

const DashboardLayout = () => {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = NAV_BY_ROLE[user?.role] || [];

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-sand-100 dark:bg-teal-900">
      {/* Sidebar */}
      <aside
        className={`fixed z-40 inset-y-0 left-0 w-64 bg-teal-600 text-white transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
      >
        <div className="flex items-center gap-2 px-6 py-5 font-display text-xl font-semibold border-b border-white/10">
          <Heart className="w-6 h-6 fill-amber-400 text-amber-400" strokeWidth={1.5} />
          MindMitra
        </div>
        <nav className="px-3 py-4 flex flex-col gap-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-white/10">
          <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="md:ml-64 flex flex-col min-w-0 min-h-screen">
        <header className="flex items-center justify-between px-6 py-4 bg-sand-50 dark:bg-teal-800 border-b border-teal-600/10">
          <button className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu className="w-6 h-6 text-teal-700 dark:text-white" />
          </button>
          <div className="hidden md:block" />
          <div className="flex items-center gap-4">
            <NotificationBell />
            <button onClick={toggleTheme} className="focus-ring p-2 rounded-full hover:bg-teal-600/10" aria-label="Toggle dark mode">
              {isDark ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-teal-700" />}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-amber-400 text-teal-900 flex items-center justify-center font-semibold text-sm">
                {user?.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="hidden sm:block text-sm">
                <p className="font-semibold text-teal-800 dark:text-white leading-tight">{user?.name}</p>
                <p className="text-teal-600/70 dark:text-white/60 capitalize text-xs">{user?.role}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;