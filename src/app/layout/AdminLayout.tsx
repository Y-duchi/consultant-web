import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Sparkles,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { Button } from "../../shared/ui/Button";

const navItems = [
  { to: "/admin", label: "운영 대시보드", icon: LayoutDashboard, end: true },
  { to: "/admin/applications", label: "입점 심사", icon: FileCheck2 },
  { to: "/admin/businesses", label: "업체/전문가", icon: BriefcaseBusiness },
  { to: "/admin/bookings", label: "전체 예약", icon: CalendarDays },
  { to: "/admin/summary-jobs", label: "AI 요약 상태", icon: Sparkles },
];

const pageTitle: Record<string, string> = {
  "/admin": "플랫폼 운영 대시보드",
  "/admin/applications": "입점 심사",
  "/admin/businesses": "업체/전문가 목록",
  "/admin/bookings": "전체 예약 관리",
  "/admin/summary-jobs": "AI 요약 작업 상태",
};

export function AdminLayout() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const title = pageTitle[location.pathname] ?? "AURA Admin";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">A</div>
          <div className="brand-title">
            <strong>AURA Admin</strong>
            <span>플랫폼 운영자 콘솔</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="관리자 메뉴">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="scope-card">
            <span>현재 권한</span>
            <strong>플랫폼 운영자</strong>
            <span>입점 심사, 전체 예약, 업체 상태와 AI 요약 작업을 검수합니다.</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-title">
              <strong>{title}</strong>
              <span>업체 workspace 데이터와 분리된 운영자 전용 화면입니다.</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="topbar-meta">Admin API scope</span>
            <Button variant="ghost" icon={<Bell size={17} />}>
              알림
            </Button>
            <div className="person-cell">
              <img className="avatar" src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=160&q=80" alt="" />
              <div className="cell-main">
                <strong>{user?.name}</strong>
                <span>{user?.email}</span>
              </div>
            </div>
            <Button variant="ghost" icon={<LogOut size={17} />} onClick={logout}>
              로그아웃
            </Button>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
