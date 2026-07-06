import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./layout/AppLayout";
import { LoginPage } from "../features/auth/LoginPage";
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
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={isAuthenticated ? <AppLayout /> : <Navigate to="/login" replace />}>
        <Route index element={<DashboardPage />} />
        <Route path="/bookings" element={<BookingsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/completion" element={<CompletionPage />} />
        <Route path="/reviews" element={<ReviewsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
