import {
  Bell,
  Building2,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Settings,
  Star,
  Users,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { Button } from "../../shared/ui/Button";
import { workspaceScopeLabel } from "../../shared/utils/format";

const navItems = [
  { to: "/", label: "대시보드", icon: LayoutDashboard, end: true },
  { to: "/bookings", label: "앱 예약", icon: CalendarDays },
  { to: "/chat", label: "고객 대화", icon: MessageSquareText },
  { to: "/customers", label: "고객 리포트", icon: Users },
  { to: "/reviews", label: "리뷰", icon: Star },
  { to: "/profile", label: "파트너/전문가", icon: Building2 },
  { to: "/settings", label: "설정", icon: Settings },
];

const pageTitle: Record<string, string> = {
  "/": "파트너 운영 현황",
  "/bookings": "앱 예약 관리",
  "/chat": "고객 대화",
  "/customers": "고객 리포트 관리",
  "/completion": "상담 완료 및 처방 노트 전달",
  "/reviews": "리뷰 관리",
  "/profile": "파트너/전문가 관리",
  "/settings": "운영 설정",
};

export function AppLayout() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const title = pageTitle[location.pathname] ?? "AURA Partner Manager";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">C</div>
          <div className="brand-title">
            <strong>AURA Partner</strong>
            <span>뷰티 상담 운영툴</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="주 메뉴">
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
            <span>현재 워크스페이스</span>
            <strong>{user ? workspaceScopeLabel[user.workspaceScope] : "로그인 필요"}</strong>
            <span>{user?.role === "admin" ? "플랫폼 전체 검수 가능" : user?.role === "expert" ? "본인 예약/고객만 표시" : "업체 예약과 전문가 관리"}</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-title">
              <strong>{title}</strong>
              <span>앱 예약/AI 리포트/파트너 인증 mock service layer로 동작 중</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="topbar-meta">앱 상담 플로우 기준 동기화됨</span>
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
