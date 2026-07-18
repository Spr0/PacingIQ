import { Routes, Route } from 'react-router-dom';
import { useAuth } from './state/AuthContext.jsx';
import { AppProvider } from './state/AppContext.jsx';
import Layout from './components/Layout.jsx';
import SignIn from './components/SignIn.jsx';
import PendingApproval from './components/PendingApproval.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Teachers from './pages/Teachers.jsx';
import TeacherDetail from './pages/TeacherDetail.jsx';
import Observations from './pages/Observations.jsx';
import Pacing from './pages/Pacing.jsx';
import Interventions from './pages/Interventions.jsx';
import Report from './pages/Report.jsx';
import WeeklyEmail from './pages/WeeklyEmail.jsx';
import AuditLog from './pages/AuditLog.jsx';

export default function App() {
  const { session, profile, loading } = useAuth();

  if (loading) return null; // avoid a sign-in flash while the session check resolves
  if (!session) return <SignIn />;
  if (!profile || profile.role === 'pending') return <PendingApproval />;

  return (
    <AppProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="teachers" element={<Teachers />} />
          <Route path="teachers/:id" element={<TeacherDetail />} />
          <Route path="observations" element={<Observations />} />
          <Route path="pacing" element={<Pacing />} />
          <Route path="interventions" element={<Interventions />} />
          <Route path="report" element={<Report />} />
          <Route path="weekly" element={<WeeklyEmail />} />
          <Route path="audit" element={<AuditLog />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
