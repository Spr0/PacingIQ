import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Teachers from './pages/Teachers.jsx';
import TeacherDetail from './pages/TeacherDetail.jsx';
import Observations from './pages/Observations.jsx';
import Pacing from './pages/Pacing.jsx';
import Interventions from './pages/Interventions.jsx';
import Report from './pages/Report.jsx';
import AuditLog from './pages/AuditLog.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="teachers" element={<Teachers />} />
        <Route path="teachers/:id" element={<TeacherDetail />} />
        <Route path="observations" element={<Observations />} />
        <Route path="pacing" element={<Pacing />} />
        <Route path="interventions" element={<Interventions />} />
        <Route path="report" element={<Report />} />
        <Route path="audit" element={<AuditLog />} />
      </Route>
    </Routes>
  );
}
