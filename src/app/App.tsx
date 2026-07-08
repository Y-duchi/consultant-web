import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./layout/AdminLayout";
import { PartnerLayout } from "./layout/PartnerLayout";
import { AdminBookingsPage } from "../features/admin/AdminBookingsPage";
import { AdminDashboardPage } from "../features/admin/AdminDashboardPage";
import { AdminPartnersPage } from "../features/admin/AdminPartnersPage";
import { AdminSummaryJobsPage } from "../features/admin/AdminSummaryJobsPage";
import { ApplicationStatusPage } from "../features/applications/ApplicationStatusPage";
import { ApplicationsPage } from "../features/applications/ApplicationsPage";
import { ApplyPage } from "../features/applications/ApplyPage";
import { LoginPage } from "../features/auth/LoginPage";
import { PasswordChangePage } from "../features/auth/PasswordChangePage";
import { BookingsPage } from "../features/bookings/BookingsPage";
import { ChatPage } from "../features/chat/ChatPage";
import { CompletionPage } from "../features/completion/CompletionPage";
import { CustomersPage } from "../features/customers/CustomersPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { ReviewsPage } from "../features/reviews/ReviewsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { useAuth } from "../features/auth/AuthContext";

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
