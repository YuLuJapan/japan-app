import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PostHogErrorBoundary from './lib/PostHogErrorBoundary'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PostHogErrorBoundary>
      <App />
    </PostHogErrorBoundary>
  </React.StrictMode>
)
