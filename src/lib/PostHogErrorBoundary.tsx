import { Component, type ReactNode } from 'react'
import posthog from './posthog'

type PostHogErrorBoundaryProps = {
  children: ReactNode
}

type PostHogErrorBoundaryState = {
  hasError: boolean
}

export default class PostHogErrorBoundary extends Component<
  PostHogErrorBoundaryProps,
  PostHogErrorBoundaryState
> {
  state: PostHogErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): PostHogErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    posthog.captureException(error)
  }

  render() {
    if (this.state.hasError) {
      return null
    }

    return this.props.children
  }
}
