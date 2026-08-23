import React from 'react'
import ReactDOM from 'react-dom/client'
import { PostHogErrorBoundary, PostHogProvider } from '@posthog/react'
import App from './App'
import { AppCrash } from './components/AppCrash'
import { posthogKey, posthogOptions } from './lib/posthog'
import './styles/index.css'

// The boundary goes on regardless: catching a render crash and showing a way
// back is worth doing whether or not anyone is there to receive the report.
// Without a key `PostHogProvider` is skipped entirely rather than initialised
// with an empty token — see src/lib/posthog.ts.
const tree = (
  <PostHogErrorBoundary fallback={AppCrash}>
    <App />
  </PostHogErrorBoundary>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {posthogKey ? (
      <PostHogProvider apiKey={posthogKey} options={posthogOptions}>
        {tree}
      </PostHogProvider>
    ) : (
      tree
    )}
  </React.StrictMode>
)
