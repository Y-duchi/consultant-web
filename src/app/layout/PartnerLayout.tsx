import {
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Settings,
  Star,
  Users,
} from "lucide-react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext";
import { connectPartnerEventStream, getPartnerEventFallbackRefetchRoots, getPartnerEventInvalidationRoots, isPartnerEventInScope } from "../../services/partnerEvents";
import { Button } from "../../shared/ui/Button";
import { workspaceScopeLabel } from "../../shared/utils/format";

const navItems = [
  { to: "/workspace", label: "내 대시보드", icon: LayoutDashboard, end: true },
  { to: "/workspace/bookings", label: "내 예약", icon: CalendarDays },
  { to: "/workspace/customers", label: "내 고객", icon: Users },
  { to: "/workspace/chat", label: "내 채팅", icon: MessageSquareText },
  { to: "/workspace/completion", label: "상담 요약", icon: CheckCircle2 },
  { to: "/workspace/reviews", label: "내 리뷰", icon: Star },
  { to: "/workspace/profile", label: "프로필/가격", icon: Building2 },
  { to: "/workspace/settings", label: "설정", icon: Settings },
];

const pageTitle: Record<string, string> = {
  "/workspace": "내 업체 운영 현황",
  "/workspace/bookings": "내 예약 관리",
  "/workspace/customers": "내 고객 관리",
  "/workspace/chat": "내 고객 대화",
  "/workspace/completion": "상담 요약 및 처방 노트",
  "/workspace/reviews": "내 리뷰 관리",
  "/workspace/profile": "프로필/영업 정보",
  "/workspace/settings": "워크스페이스 설정",
};

export function PartnerLayout() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const title = pageTitle[location.pathname] ?? "AURA Workspace";

  useEffect(() => {
    if (!user?.businessId) return undefined;
    const connection = connectPartnerEventStream({
      accountId: user.id,
      businessId: user.businessId,
      expertId: user.expertId,
      onEvent: (event) => {
        if (!isPartnerEventInScope(event, { businessId: user.businessId, expertId: user.expertId })) return;
        getPartnerEventInvalidationRoots(event).forEach((queryKey) => {
          queryClient.invalidateQueries({ queryKey: [queryKey] });
        });
      },
    });
    return () => connection.close();
  }, [queryClient, user?.businessId, user?.expertId]);

  useEffect(() => {
    if (!user?.businessId) return undefined;
    const timer = window.setInterval(() => {
      getPartnerEventFallbackRefetchRoots().forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey: [queryKey] });
      });
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [queryClient, user?.businessId, user?.expertId]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">P</div>
          <div className="brand-title">
            <strong>AURA Workspace</strong>
            <span>업체/전문가 운영툴</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="워크스페이스 메뉴">
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
            <span>{user?.role === "expert" ? "본인 예약/고객만 표시" : "소속 업체의 예약과 고객만 표시"}</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-title">
              <strong>{title}</strong>
              <span>서버 scope 기준으로 내 업체/전문가 데이터만 조회합니다.</span>
            </div>
          </div>
          <div className="topbar-right">
            <span className="topbar-meta">Partner API scope</span>
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
