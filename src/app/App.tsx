import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./layout/AdminLayout";
import { PartnerLayout } from "./layout/PartnerLayout";
import { ApplyPage } from "../features/applications/ApplyPage";
import { LoginPage } from "../features/auth/LoginPage";
import { useAuth } from "../features/auth/AuthContext";
import { LoadingState } from "../shared/ui/StateViews";

const AdminBookingsPage = lazy(() => import("../features/admin/AdminBookingsPage").then((module) => ({ default: module.AdminBookingsPage })));
const AdminDashboardPage = lazy(() => import("../features/admin/AdminDashboardPage").then((module) => ({ default: module.AdminDashboardPage })));
const AdminPartnersPage = lazy(() => import("../features/admin/AdminPartnersPage").then((module) => ({ default: module.AdminPartnersPage })));
const AdminProfileChangesPage = lazy(() => import("../features/admin/AdminProfileChangesPage").then((module) => ({ default: module.AdminProfileChangesPage })));
const AdminSummaryJobsPage = lazy(() => import("../features/admin/AdminSummaryJobsPage").then((module) => ({ default: module.AdminSummaryJobsPage })));
const ApplicationStatusPage = lazy(() => import("../features/applications/ApplicationStatusPage").then((module) => ({ default: module.ApplicationStatusPage })));
const ApplicationsPage = lazy(() => import("../features/applications/ApplicationsPage").then((module) => ({ default: module.ApplicationsPage })));
const PasswordChangePage = lazy(() => import("../features/auth/PasswordChangePage").then((module) => ({ default: module.PasswordChangePage })));
const BookingsPage = lazy(() => import("../features/bookings/BookingsPage").then((module) => ({ default: module.BookingsPage })));
const ChatPage = lazy(() => import("../features/chat/ChatPage").then((module) => ({ default: module.ChatPage })));
const CompletionPage = lazy(() => import("../features/completion/CompletionPage").then((module) => ({ default: module.CompletionPage })));
const CustomersPage = lazy(() => import("../features/customers/CustomersPage").then((module) => ({ default: module.CustomersPage })));
const DashboardPage = lazy(() => import("../features/dashboard/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const ProfilePage = lazy(() => import("../features/profile/ProfilePage").then((module) => ({ default: module.ProfilePage })));
const ReviewsPage = lazy(() => import("../features/reviews/ReviewsPage").then((module) => ({ default: module.ReviewsPage })));
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));

export function App() {
  const { isAuthenticated, user } = useAuth();
  const shouldShowApplicationStatus =
    isAuthenticated &&
    user?.role !== "admin" &&
    user?.role !== "operator" &&
    user?.applicationStatus &&
    user.applicationStatus !== "approved";
  const shouldRequirePasswordChange =
    isAuthenticated &&
    !shouldShowApplicationStatus &&
    !isAdminRole(user?.role) &&
    Boolean(user?.passwordChangeRequired);

  return (
    <Suspense fallback={<LoadingState label="화면을 불러오는 중입니다" />}>
      <Routes>
      <Route path="/apply" element={<ApplyPage />} />
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={getHomePath(user, shouldShowApplicationStatus, shouldRequirePasswordChange)} replace /> : <LoginPage />}
      />
      <Route path="/application-status" element={isAuthenticated ? <ApplicationStatusPage /> : <Navigate to="/login" replace />} />
      <Route
        path="/workspace/password"
        element={
          isAuthenticated && !shouldShowApplicationStatus && !isAdminRole(user?.role)
            ? <PasswordChangePage />
            : <Navigate to={isAuthenticated ? getHomePath(user, shouldShowApplicationStatus, shouldRequirePasswordChange) : "/login"} replace />
        }
      />

      <Route
        path="/admin"
        element={
          isAuthenticated && !shouldShowApplicationStatus && isAdminRole(user?.role)
            ? <AdminLayout />
            : <Navigate to={isAuthenticated ? getHomePath(user, shouldShowApplicationStatus) : "/login"} replace />
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="businesses" element={<AdminPartnersPage />} />
        <Route path="profile-changes" element={<AdminProfileChangesPage />} />
        <Route path="bookings" element={<AdminBookingsPage />} />
        <Route path="summary-jobs" element={<AdminSummaryJobsPage />} />
      </Route>

      <Route
        path="/workspace"
        element={
          isAuthenticated && !shouldShowApplicationStatus && !shouldRequirePasswordChange && !isAdminRole(user?.role)
            ? <PartnerLayout />
            : <Navigate to={isAuthenticated ? getHomePath(user, shouldShowApplicationStatus, shouldRequirePasswordChange) : "/login"} replace />
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="completion" element={<CompletionPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/" element={isAuthenticated ? <Navigate to={getHomePath(user, shouldShowApplicationStatus, shouldRequirePasswordChange)} replace /> : <Navigate to="/login" replace />} />
      <Route path="/applications" element={<Navigate to="/admin/applications" replace />} />
      <Route path="/bookings" element={<Navigate to="/workspace/bookings" replace />} />
      <Route path="/chat" element={<Navigate to="/workspace/chat" replace />} />
      <Route path="/customers" element={<Navigate to="/workspace/customers" replace />} />
      <Route path="/completion" element={<Navigate to="/workspace/completion" replace />} />
      <Route path="/reviews" element={<Navigate to="/workspace/reviews" replace />} />
      <Route path="/profile" element={<Navigate to="/workspace/profile" replace />} />
      <Route path="/settings" element={<Navigate to="/workspace/settings" replace />} />
      <Route path="*" element={<Navigate to={isAuthenticated ? getHomePath(user, shouldShowApplicationStatus, shouldRequirePasswordChange) : "/login"} replace />} />
      </Routes>
    </Suspense>
  );
}

function isAdminRole(role?: string) {
  return role === "admin" || role === "operator";
}

function getHomePath(user: ReturnType<typeof useAuth>["user"], shouldShowApplicationStatus?: boolean, shouldRequirePasswordChange?: boolean) {
  if (shouldShowApplicationStatus) return "/application-status";
  if (shouldRequirePasswordChange) return "/workspace/password";
  if (isAdminRole(user?.role)) return "/admin";
  return "/workspace";
}
