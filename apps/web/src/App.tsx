import { Navigate, Route, Routes } from 'react-router'
import Banner from './components/Banner'
import ResultScreen from './pages/ResultScreen'
import RunScreen from './pages/RunScreen'
import TerminalScreen from './pages/TerminalScreen'

/**
 * The "figures are fictional" banner lives above the router, not inside a
 * screen: a screen cannot forget it, and there is no control to dismiss it.
 */
export const App = () => (
  <div className="flex min-h-full flex-col bg-[hsl(var(--qe-bg))]">
    <Banner />
    <div className="flex-1">
      <Routes>
        <Route path="/" element={<RunScreen />} />
        <Route path="/runs/:runId" element={<ResultScreen />} />
        <Route path="/markets/sol-usdc" element={<TerminalScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  </div>
)
