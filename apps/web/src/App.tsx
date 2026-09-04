import { Navigate, Route, Routes } from 'react-router'
import Banner from './components/Banner.tsx'
import ResultScreen from './pages/ResultScreen.tsx'
import RunScreen from './pages/RunScreen.tsx'
import TerminalScreen from './pages/TerminalScreen.tsx'

/** Data provenance is a line above every screen, not a footnote (M1). */
export const PROVENANCE =
  'Historical order books recorded by us from two public Solana RPC channels. Every run replays them; nothing is sent to any market.'

/**
 * The banner lives above the router, not inside a screen: a screen cannot forget it,
 * and there is no control to remove it.
 */
export const App = () => (
  <div className="flex min-h-full flex-col bg-[hsl(var(--qe-bg))]">
    <Banner text={PROVENANCE} />
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
